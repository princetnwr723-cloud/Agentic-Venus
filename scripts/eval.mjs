#!/usr/bin/env node
// Venus Code eval harness: runs the REAL runner (lib/runner-script.ts) on a set of coding tasks and checks the result
// with a script. It runs anywhere with Node 20+ and git (your laptop, GitHub Actions), not only inside the E2B computer.
//
//   node scripts/eval.mjs --provider anthropic --model claude-opus-5-5
//   node scripts/eval.mjs --provider gemini --model gemini-3.5-flash --only slugify,fix-lru
//   node scripts/eval.mjs --oracle        (no model: checks that every task fails before and passes with its reference solution)
//   add --keep to keep the temp folder (job events and workspaces) for debugging a failing task
//
// The API key comes from the environment: ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY, XAI_API_KEY,
// OPENROUTER_API_KEY, MISTRAL_API_KEY, GROQ_API_KEY or DEEPSEEK_API_KEY (or --key-env NAME).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf("--" + name); return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : def; };
const flag = (name) => args.includes("--" + name);

const provider = opt("provider", "anthropic");
const model = opt("model", "claude-opus-5-5");
const only = opt("only", "").split(",").map((x) => x.trim()).filter(Boolean);
const maxSteps = Number(opt("max-steps", "60"));
const timeoutMin = Number(opt("timeout-min", "10"));
const minPass = Number(opt("min-pass", "0"));
const outDir = path.resolve(root, opt("out", "evals/results"));
const oracle = flag("oracle");
const keep = flag("keep"); // keep the temp folder (job events, workspaces) to debug a failing task
const KEY_ENV = { anthropic: "ANTHROPIC_API_KEY", openai: "OPENAI_API_KEY", gemini: "GEMINI_API_KEY", grok: "XAI_API_KEY", openrouter: "OPENROUTER_API_KEY", mistral: "MISTRAL_API_KEY", groq: "GROQ_API_KEY", deepseek: "DEEPSEEK_API_KEY" };
const keyEnv = opt("key-env", KEY_ENV[provider] || "API_KEY");
const apiKey = process.env[keyEnv] || process.env.EVAL_FAKE_KEY || "";
if (!oracle && !apiKey) { console.error("Missing API key: set " + keyEnv + " in the environment."); process.exit(2); }

const tasks = JSON.parse(fs.readFileSync(path.join(root, "evals/tasks.json"), "utf8")).tasks.filter((t) => !only.length || only.includes(t.id));
if (!tasks.length) { console.error("No tasks selected."); process.exit(2); }

const home = fs.mkdtempSync(path.join(os.tmpdir(), "venus-eval-"));
const rs = fs.readFileSync(path.join(root, "lib/runner-script.ts"), "utf8");
const runnerFile = path.join(home, "runner.mjs");
fs.writeFileSync(runnerFile, rs.slice(rs.indexOf("String.raw`") + "String.raw`".length, rs.lastIndexOf("`;")));

const gitEnv = { GIT_AUTHOR_NAME: "eval", GIT_AUTHOR_EMAIL: "eval@example.com", GIT_COMMITTER_NAME: "eval", GIT_COMMITTER_EMAIL: "eval@example.com" };
const git = (cwd, cmd) => spawnSync("bash", ["-lc", cmd], { cwd, encoding: "utf8", env: { ...process.env, ...gitEnv } });

// The same system prompt the product uses (needs the `typescript` package that Next.js already installs).
async function systemPrompt(ws) {
  try {
    const ts = (await import("typescript")).default;
    const src = fs.readFileSync(path.join(root, "lib/code-prompts.ts"), "utf8");
    const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
    const m = { exports: {} };
    vm.runInNewContext("(function (module, exports) {" + js + "\n})", {})(m, m.exports);
    return m.exports.codeSystemPrompt({ readOnly: false, ws, memory: "", skills: "", venusMd: "", tree: "" });
  } catch {
    return "You are Venus Code, an expert software engineer working in a Linux workspace through tools. Explore before you change, make complete working files, verify them by running them, then finish with a short report.";
  }
}

function writeFiles(dir, files) {
  for (const [rel, content] of Object.entries(files || {})) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
}

function runCheck(task, dir, base) {
  const r = spawnSync("bash", ["-lc", task.check], { cwd: dir, encoding: "utf8", timeout: 60000, env: { ...process.env, ...gitEnv, EVAL_BASE: base } });
  return { ok: r.status === 0, out: (String(r.stdout || "") + String(r.stderr || "")).trim().slice(-300) };
}

function runRunner(id, dir, timeoutMs) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [runnerFile, id], { env: { ...process.env, ...gitEnv, VENUS_HOME: home }, stdio: "ignore" });
    const timer = setTimeout(() => { fs.writeFileSync(path.join(home, "runner/jobs", id, "stop"), "1"); setTimeout(() => child.kill("SIGKILL"), 15000); }, timeoutMs);
    child.on("exit", () => { clearTimeout(timer); resolve(); });
  });
}

const results = [];
for (const task of tasks) {
  const ws = "eval-" + task.id;
  const dir = path.join(home, "work", ws);
  fs.mkdirSync(dir, { recursive: true });
  writeFiles(dir, task.seed);
  git(dir, "git init -q && git add -A && git commit -q --allow-empty -m base");
  const base = String(git(dir, "git rev-parse HEAD").stdout).trim();
  const t0 = Date.now();
  const row = { id: task.id, title: task.title, pass: false, status: "", steps: 0, seconds: 0, note: "" };

  if (oracle) {
    const before = runCheck(task, dir, base);
    writeFiles(dir, task.solution);
    git(dir, "git add -A && git commit -q -m solution");
    const after = runCheck(task, dir, base);
    row.pass = !before.ok && after.ok;
    row.status = before.ok ? "check passes WITHOUT a solution (too weak)" : after.ok ? "ok" : "reference solution fails the check";
    row.note = after.ok ? "" : after.out;
  } else {
    const jobDir = path.join(home, "runner/jobs", task.id);
    fs.mkdirSync(jobDir, { recursive: true });
    fs.writeFileSync(path.join(jobDir, "job.json"), JSON.stringify({
      id: task.id, ws, provider, model, instruction: task.prompt, system: await systemPrompt(ws),
      appUrl: "", skills: [], maxSteps, maxMinutes: timeoutMin,
    }));
    fs.writeFileSync(path.join(jobDir, "key"), apiKey);
    await runRunner(task.id, dir, timeoutMin * 60000);
    let state = {};
    try { state = JSON.parse(fs.readFileSync(path.join(jobDir, "state.json"), "utf8")); } catch { /* runner never started */ }
    const check = runCheck(task, dir, base);
    row.pass = check.ok;
    row.status = String(state.status || "no result");
    row.steps = Number(state.step || 0);
    row.note = check.ok ? "" : (String(state.summary || "") + " " + check.out).trim().replace(/\s+/g, " ").slice(0, 160);
  }
  row.seconds = Math.round((Date.now() - t0) / 1000);
  results.push(row);
  console.log((row.pass ? "PASS " : "FAIL ") + task.id + "  (" + row.status + ", " + row.steps + " steps, " + row.seconds + "s)" + (row.note ? "\n      " + row.note : ""));
}

const passed = results.filter((r) => r.pass).length;
const pct = Math.round((passed / results.length) * 100);
const label = oracle ? "oracle (suite self-check)" : provider + " / " + model;
const md = ["# Venus Code eval: " + label, "", "**" + passed + " / " + results.length + " passed (" + pct + "%)**", "",
  "| Task | Result | Status | Steps | Seconds |", "|---|---|---|---|---|",
  ...results.map((r) => "| " + r.id + " | " + (r.pass ? "PASS" : "FAIL") + " | " + r.status + " | " + r.steps + " | " + r.seconds + " |")].join("\n");
fs.mkdirSync(outDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
fs.writeFileSync(path.join(outDir, "summary.md"), md + "\n");
fs.writeFileSync(path.join(outDir, (oracle ? "oracle" : provider + "-" + model.replace(/[^A-Za-z0-9._-]/g, "_")) + "-" + stamp + ".json"), JSON.stringify({ provider, model, oracle, passed, total: results.length, results }, null, 2));
console.log("\n" + md);
if (keep) console.log("Kept: " + home); else { try { fs.rmSync(home, { recursive: true, force: true }); } catch { /* temp dir */ } }
process.exit(oracle ? (passed === results.length ? 0 : 1) : (pct >= minPass ? 0 : 1));
