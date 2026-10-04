// The background worker that runs INSIDE the E2B computer as a detached Node process.
// It is a self-contained agent loop (LLM calls + tools), so it keeps working when the browser tab is closed.
// NOTE: the source below must not contain backticks or dollar-brace sequences (it lives in a template string).

export const RUNNER_VERSION = "1";

export const RUNNER_SOURCE = String.raw`import fs from "node:fs";
import path from "node:path";
import {spawn, spawnSync} from "node:child_process";

const id = process.argv[2];
const BASE = "/home/user/runner/jobs/" + id;
const job = JSON.parse(fs.readFileSync(BASE + "/job.json", "utf8"));
const KEY = fs.readFileSync(BASE + "/key", "utf8").trim();
try { fs.unlinkSync(BASE + "/key"); } catch (e) {}
const ROOT = "/home/user/work/" + String(job.ws).replace(/[^A-Za-z0-9_-]/g, "");
const EV = BASE + "/events.jsonl";
const SH = BASE + "/sh";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const q = (s) => "'" + String(s).replace(/'/g, "'\\''") + "'";
const stopped = () => fs.existsSync(BASE + "/stop");

let state = {status: "running", step: 0, summary: "", startedAt: Date.now()};
function save(o) {
  state = Object.assign(state, o, {updatedAt: Date.now()});
  fs.writeFileSync(BASE + "/state.tmp", JSON.stringify(state));
  fs.renameSync(BASE + "/state.tmp", BASE + "/state.json");
}
function emit(k, text, extra) {
  const t = String(text == null ? "" : text).slice(0, k === "term" ? 1200 : 800);
  fs.appendFileSync(EV, JSON.stringify(Object.assign({k: k, text: t}, extra || {})) + "\n");
}
function end(status, summary, memories) {
  if (status === "error") emit("error", summary);
  save({status: status, summary: String(summary).slice(0, 6000), memories: memories || []});
}

// ---------------- LLM ----------------
const OPENAI_URLS = {
  openai: "https://api.openai.com/v1/chat/completions",
  grok: "https://api.x.ai/v1/chat/completions",
  openrouter: "https://openrouter.ai/api/v1/chat/completions",
  mistral: "https://api.mistral.ai/v1/chat/completions",
  perplexity: "https://api.perplexity.ai/chat/completions",
  groq: "https://api.groq.com/openai/v1/chat/completions",
  deepseek: "https://api.deepseek.com/chat/completions",
  apinex: "https://apinex.bond/v1/chat/completions"
};

async function post(url, headers, body) {
  const res = await fetch(url, {method: "POST", headers: Object.assign({"Content-Type": "application/json"}, headers), body: JSON.stringify(body), signal: AbortSignal.timeout(240000)});
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const m = (data && data.error && (data.error.message || data.error)) || data.message || "request failed";
    throw new Error(job.provider + " " + res.status + ": " + (typeof m === "string" ? m : JSON.stringify(m)).slice(0, 300));
  }
  return data;
}

async function callOnce(messages) {
  const p = job.provider;
  const model = job.model;
  if (p === "anthropic") {
    const msgs = messages.map((m) => ({role: m.role, content: m.image ? [{type: "image", source: {type: "base64", media_type: m.image.mediaType, data: m.image.data}}, {type: "text", text: m.content}] : m.content}));
    const d = await post("https://api.anthropic.com/v1/messages", {"x-api-key": KEY, "anthropic-version": "2023-06-01"}, {model: model, max_tokens: 8192, messages: msgs});
    return (d.content || []).map((b) => b.text || "").join("");
  }
  if (p === "gemini") {
    const contents = messages.map((m) => ({role: m.role === "assistant" ? "model" : "user", parts: m.image ? [{inline_data: {mime_type: m.image.mediaType, data: m.image.data}}, {text: m.content}] : [{text: m.content}]}));
    const d = await post("https://generativelanguage.googleapis.com/v1beta/models/" + model + ":generateContent", {"x-goog-api-key": KEY}, {contents: contents, generationConfig: {maxOutputTokens: 8192}});
    const parts = (d.candidates && d.candidates[0] && d.candidates[0].content && d.candidates[0].content.parts) || [];
    return parts.map((x) => x.text || "").join("");
  }
  const oa = (m) => ({role: m.role, content: m.image ? [{type: "text", text: m.content}, {type: "image_url", image_url: {url: "data:" + m.image.mediaType + ";base64," + m.image.data}}] : m.content});
  if (p === "cohere") {
    const d = await post("https://api.cohere.com/v2/chat", {Authorization: "Bearer " + KEY}, {model: model, messages: messages.map(oa)});
    const parts = d.message && d.message.content;
    return Array.isArray(parts) ? parts.map((x) => x.text || "").join("") : "";
  }
  const url = OPENAI_URLS[p];
  if (!url) throw new Error("Unsupported provider: " + p);
  const d = await post(url, {Authorization: "Bearer " + KEY}, {model: model, messages: messages.map(oa)});
  return (d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content) || "";
}

async function llm(messages) {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await callOnce(messages);
    } catch (e) {
      const m = String(e && e.message ? e.message : e);
      const retry = /( 429| 5\d\d|overloaded|rate limit|timeout|timed out|fetch failed|ECONN|socket)/i.test(m);
      if (attempt === 4 || !retry) throw e;
      emit("info", "Model busy, retrying in " + 2 * Math.pow(2, attempt) + "s...");
      await sleep(2000 * Math.pow(2, attempt));
    }
  }
  return "";
}

// ---------------- tool parsing ----------------
const TOOLS = ["read", "ls", "glob", "grep", "write", "edit", "bash_output", "bash", "todo", "web_search", "web_fetch", "ask", "skill", "remember", "task", "look", "finish"];

function parseTools(text) {
  const calls = [];
  const re = new RegExp("<(" + TOOLS.join("|") + ")((?:\\s+[a-z_]+=\"[^\"]*\")*)\\s*(/?)>", "g");
  let m;
  let firstIdx = -1;
  let cursor = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index < cursor) continue;
    if (firstIdx < 0) firstIdx = m.index;
    const name = m[1];
    const attrs = {};
    for (const a of m[2].matchAll(/([a-z_]+)="([^"]*)"/g)) attrs[a[1]] = a[2];
    let body = "";
    if (m[3] !== "/") {
      const close = text.indexOf("</" + name + ">", re.lastIndex);
      body = close >= 0 ? text.slice(re.lastIndex, close) : text.slice(re.lastIndex);
      cursor = close >= 0 ? close + name.length + 3 : text.length;
      re.lastIndex = cursor;
    }
    const call = {name: name, attrs: attrs, body: body};
    if (name === "edit") {
      const o = /<old>\n?([\s\S]*?)\n?<\/old>/.exec(body);
      const n = /<new>\n?([\s\S]*?)\n?<\/new>/.exec(body);
      call.old = o ? o[1] : "";
      call.new = n ? n[1] : "";
    }
    calls.push(call);
  }
  return {calls: calls, thought: (firstIdx >= 0 ? text.slice(0, firstIdx) : text).trim()};
}

// ---------------- helpers ----------------
function resolveP(p) {
  let rel = String(p || "").trim();
  if (rel.startsWith(ROOT + "/")) rel = rel.slice(ROOT.length + 1);
  else if (rel === ROOT) rel = ".";
  rel = rel.replace(/^\/+/, "");
  const parts = rel.split("/").filter((x) => x && x !== ".");
  if (parts.some((x) => x === "..")) throw new Error("Paths may not contain '..'.");
  if (parts[0] === ".git") throw new Error("The .git directory is off limits.");
  return parts.length ? ROOT + "/" + parts.join("/") : ROOT;
}

function globToRegex(g) {
  let re = "";
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === "*") {
      if (g[i + 1] === "*") { re += g[i + 2] === "/" ? "(?:.*/)?" : ".*"; i += g[i + 2] === "/" ? 2 : 1; }
      else re += "[^/]*";
    } else if (c === "?") re += "[^/]";
    else re += c.replace(/[.+^$\{\}()|[\]\\]/g, "\\$&");
  }
  return new RegExp("^" + re + "$");
}

let jobN = 0;
function startShell(cmd) {
  fs.mkdirSync(SH, {recursive: true});
  const jid = "j" + (++jobN);
  const script = "cd " + q(ROOT) + "\nexport PATH=\"$HOME/.local/bin:$HOME/.npm-global/bin:$PATH\"\nexport CI=1 DEBIAN_FRONTEND=noninteractive\n" + cmd + "\n";
  fs.writeFileSync(SH + "/" + jid + ".sh", script);
  const child = spawn("bash", ["-lc", "bash " + q(SH + "/" + jid + ".sh") + " > " + q(SH + "/" + jid + ".log") + " 2>&1; echo $? > " + q(SH + "/" + jid + ".exit")], {detached: true, stdio: "ignore"});
  child.unref();
  return jid;
}
function readShell(jid) {
  const base = SH + "/" + jid;
  let log = "";
  let ex = null;
  try { log = fs.readFileSync(base + ".log", "utf8"); } catch (e) {}
  try { ex = fs.readFileSync(base + ".exit", "utf8").trim(); } catch (e) {}
  return {done: ex !== null && ex !== "", exitCode: ex === null || ex === "" ? undefined : Number(ex), log: log.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "").replace(/\r/g, "").trim()};
}

const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
function strip(s) {
  return s.replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();
}
async function webFetch(url) {
  const res = await fetch(url, {headers: {"User-Agent": UA}, redirect: "follow", signal: AbortSignal.timeout(20000)});
  if (!res.ok) throw new Error("HTTP " + res.status);
  const raw = (await res.text()).slice(0, 600000);
  const type = res.headers.get("content-type") || "";
  return (type.includes("html") ? strip(raw) : raw).slice(0, 6000);
}
async function webSearch(query) {
  const res = await fetch("https://html.duckduckgo.com/html/?q=" + encodeURIComponent(query), {headers: {"User-Agent": UA}, signal: AbortSignal.timeout(20000)});
  if (!res.ok) throw new Error("HTTP " + res.status);
  const html = await res.text();
  const links = [...html.matchAll(/<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)];
  const snips = [...html.matchAll(/<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g)];
  const lines = [];
  links.slice(0, 8).forEach((m, i) => {
    let href = m[1].replace(/&amp;/g, "&");
    const u = /[?&]uddg=([^&]+)/.exec(href);
    if (u) href = decodeURIComponent(u[1]);
    if (href.startsWith("//")) href = "https:" + href;
    lines.push((i + 1) + ". " + strip(m[2]) + "\n   " + href + "\n   " + (snips[i] ? strip(snips[i][1]) : ""));
  });
  if (!lines.length) throw new Error("no results");
  return lines.join("\n");
}

function checkpoint(msg) {
  const r = spawnSync("bash", ["-lc", "cd " + q(ROOT) + " && git add -A >/dev/null 2>&1; if git diff --cached --quiet; then echo NOCHANGE; else git -c user.name=Venus -c user.email=venus@local commit -qm " + q(msg.slice(0, 100)) + " >/dev/null 2>&1; git rev-parse --short HEAD; fi"], {encoding: "utf8", timeout: 25000});
  const out = String(r.stdout || "").trim();
  return out && out !== "NOCHANGE" ? out : null;
}

function parseTodo(body) {
  return body.split("\n").map((l) => /^\s*[-*]\s*\[(.)\]\s*(.+)$/.exec(l)).filter(Boolean).map((m) => (m[1] === "x" ? "✓" : m[1] === "~" ? "…" : "○") + " " + m[2].trim()).join("\n");
}
function diffOf(c) {
  if (c.name === "write") return c.body.replace(/^\n/, "").replace(/\n$/, "").split("\n").slice(0, 40).map((l, i) => ({t: "+", n: i + 1, text: l.slice(0, 200)}));
  return (c.old || "").split("\n").slice(0, 20).map((l) => ({t: "-", text: l.slice(0, 200)})).concat((c.new || "").split("\n").slice(0, 20).map((l) => ({t: "+", text: l.slice(0, 200)})));
}
function label(c) {
  const a = c.attrs;
  if (c.name === "bash") return "$ " + c.body.trim().slice(0, 140) + (a.background === "true" ? "  (background)" : "");
  if (c.name === "grep") return "grep " + (a.pattern || "") + " " + (a.path || "");
  if (c.name === "glob") return "glob " + (a.pattern || "");
  if (c.name === "web_search" || c.name === "web_fetch" || c.name === "remember") return c.name + " " + c.body.trim().slice(0, 100);
  return (c.name + " " + (a.path || a.url || a.name || "")).trim();
}

// ---------------- tools ----------------
async function runTool(c, ctx) {
  const a = c.attrs;
  switch (c.name) {
    case "read": {
      const abs = resolveP(a.path);
      if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return {text: "ERROR: file not found: " + a.path};
      const size = fs.statSync(abs).size;
      if (size > 1500000) return {text: "ERROR: " + a.path + " is " + size + " bytes - too large; use grep or offset/limit."};
      const off = Math.max(1, parseInt(a.offset || "1", 10) || 1);
      const lim = Math.min(2000, Math.max(1, parseInt(a.limit || "400", 10) || 400));
      const lines = fs.readFileSync(abs, "utf8").split("\n").slice(off - 1, off - 1 + lim);
      const body = lines.map((l, i) => String(off + i).padStart(6, " ") + "\t" + l).join("\n");
      return {text: a.path + " (" + size + " bytes, lines " + off + "-" + (off + lim - 1) + ")\n" + body.slice(0, 24000) + (body.length > 24000 ? "\n... (truncated; use offset/limit)" : "")};
    }
    case "ls": {
      const abs = resolveP(a.path || ".");
      if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) return {text: "ERROR: not a directory: " + a.path};
      const names = fs.readdirSync(abs, {withFileTypes: true}).map((d) => d.name + (d.isDirectory() ? "/" : "")).sort().slice(0, 300);
      return {text: names.join("\n") || "(empty)"};
    }
    case "glob": {
      const re = globToRegex(a.pattern || "**/*");
      const r = spawnSync("bash", ["-lc", "cd " + q(ROOT) + " && find . -type f -not -path './node_modules/*' -not -path './.git/*' -not -path './.next/*' -not -path './dist/*' | sed 's|^\\./||' | head -6000"], {encoding: "utf8", maxBuffer: 20000000, timeout: 20000});
      const hits = String(r.stdout || "").split("\n").filter((f) => f && re.test(f)).sort().slice(0, 200);
      return {text: hits.length ? hits.join("\n") : "(no matches)"};
    }
    case "grep": {
      const target = a.path ? q(resolveP(a.path)) : ".";
      const g = a.glob ? "-g " + q(a.glob) : "";
      const inc = a.glob ? "--include=" + q(a.glob) : "";
      const r = spawnSync("bash", ["-lc", "cd " + q(ROOT) + " && if command -v rg >/dev/null 2>&1; then rg -n --no-heading -S --max-columns 200 " + g + " -e \"$P\" " + target + " 2>&1 | head -200; else grep -rnE --exclude-dir=node_modules --exclude-dir=.git " + inc + " -e \"$P\" " + target + " 2>&1 | head -200; fi"], {encoding: "utf8", maxBuffer: 20000000, timeout: 25000, env: Object.assign({}, process.env, {P: a.pattern || ""})});
      return {text: String(r.stdout || "").trim() || "(no matches)"};
    }
    case "write": {
      const abs = resolveP(a.path);
      let t = c.body;
      if (t.startsWith("\n")) t = t.slice(1);
      if (t.endsWith("\n")) t = t.slice(0, -1);
      t += "\n";
      if (t.length > 800000) return {text: "ERROR: file too large."};
      fs.mkdirSync(path.dirname(abs), {recursive: true});
      fs.writeFileSync(abs, t);
      return {text: "Wrote " + a.path + " (" + (t.split("\n").length - 1) + " lines, " + t.length + " bytes).", mutated: true};
    }
    case "edit": {
      const abs = resolveP(a.path);
      const oldS = c.old || "";
      const newS = c.new || "";
      if (!oldS) return {text: "ERROR: <old> is empty."};
      if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return {text: "ERROR: file not found: " + a.path};
      const cur = fs.readFileSync(abs, "utf8");
      const count = cur.split(oldS).length - 1;
      if (count === 0) return {text: "ERROR: the <old> text was not found in " + a.path + ". Read the file again and copy the exact text (including whitespace)."};
      const all = a.replace_all === "true";
      if (count > 1 && !all) return {text: "ERROR: the <old> text appears " + count + " times in " + a.path + ". Add more surrounding lines to make it unique, or set replace_all=\"true\"."};
      const next = all ? cur.split(oldS).join(newS) : cur.replace(oldS, () => newS);
      fs.writeFileSync(abs, next);
      return {text: "Edited " + a.path + " (" + count + " replacement" + (count > 1 ? "s" : "") + ").", mutated: true};
    }
    case "bash": {
      const cmd = c.body.trim();
      if (!cmd) return {text: "ERROR: empty command."};
      const bg = a.background === "true";
      const wait = bg ? 4000 : Math.min(Math.max(5, parseInt(a.timeout || "120", 10) || 120), 900) * 1000;
      const jid = startShell(cmd);
      const deadline = Date.now() + wait;
      for (;;) {
        await sleep(1000);
        const s = readShell(jid);
        if (s.done) return {text: "exit code: " + s.exitCode + "\n" + s.log.slice(-8000), mutated: true};
        if (stopped()) return {text: "Stopped by the user.", mutated: true};
        if (Date.now() >= deadline) return {text: "STILL RUNNING (job " + jid + ") - read more with <bash_output job=\"" + jid + "\"/>.\n" + s.log.slice(-4000), mutated: true};
      }
    }
    case "bash_output": {
      const jid = (a.job || "").replace(/[^a-z0-9]/g, "");
      if (!jid) return {text: "ERROR: job id missing."};
      const s = readShell(jid);
      return {text: (s.done ? "exit code: " + s.exitCode : "STILL RUNNING") + "\n" + s.log.slice(-8000)};
    }
    case "look": {
      let target;
      if (a.url) {
        if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i.test(a.url)) return {text: "ERROR: look only opens localhost URLs or workspace files."};
        target = a.url;
      } else {
        const abs = resolveP(a.path || "index.html");
        if (!fs.existsSync(abs)) return {text: "ERROR: " + (a.path || "index.html") + " does not exist yet."};
        target = "file://" + abs;
      }
      const out = "/tmp/look-" + Date.now() + ".png";
      spawnSync("bash", ["-lc", "(google-chrome --headless=new --no-sandbox --disable-gpu --hide-scrollbars --window-size=1280,900 --virtual-time-budget=5000 --screenshot=" + q(out) + " " + q(target) + ") >/dev/null 2>&1"], {timeout: 45000});
      if (!fs.existsSync(out)) return {text: "Could not take a screenshot (Chrome is not ready yet). Verify with bash/curl instead."};
      const data = fs.readFileSync(out).toString("base64");
      try { fs.unlinkSync(out); } catch (e) {}
      return {text: "Screenshot of " + target + " attached (look at it).", image: {mediaType: "image/png", data: data}};
    }
    case "todo":
      emit("todo", parseTodo(c.body));
      return {text: "Todo list updated."};
    case "web_search":
      try { return {text: (await webSearch(c.body.trim())).slice(0, 6000)}; } catch (e) { return {text: "ERROR: " + (e && e.message ? e.message : "failed")}; }
    case "web_fetch":
      try { return {text: await webFetch(c.body.trim())}; } catch (e) { return {text: "ERROR: " + (e && e.message ? e.message : "failed")}; }
    case "skill": {
      const s = (ctx.skills || []).find((x) => String(x.name).toLowerCase() === String(a.name || "").toLowerCase());
      if (s) return {text: "# Skill: " + s.name + "\n" + String(s.instructions).slice(0, 12000)};
      return {text: "ERROR: no skill named \"" + a.name + "\". Available: " + ((ctx.skills || []).map((x) => x.name).join(", ") || "none")};
    }
    case "remember":
      ctx.memories.push(c.body.trim().slice(0, 300));
      return {text: "Saved to memory (stored when the job ends)."};
    case "ask":
      return {text: "The user is away (background mode). Proceed with your best judgment and mention the assumption in <finish>."};
    case "task":
      return {text: "ERROR: sub-agents are not available in background mode. Do the work yourself."};
    default:
      return {text: "ERROR: unknown tool " + c.name};
  }
}

// ---------------- main loop ----------------
async function main() {
  emit("info", "Background runner started - it keeps working even if you close the browser.");
  const ctx = {skills: job.skills || [], memories: []};
  let messages = [{role: "user", content: job.system + "\n\n# TASK\n" + job.instruction}];
  const maxSteps = job.maxSteps || 120;
  const deadline = Date.now() + (job.maxMinutes || 120) * 60000;
  let noTool = 0;
  const sigs = [];

  for (let step = 0; step < maxSteps; step++) {
    if (stopped()) return end("stopped", "Stopped by the user.", ctx.memories);
    if (Date.now() > deadline) return end("error", "Time limit reached before the task was finished.", ctx.memories);
    save({step: step + 1});

    const size = messages.reduce((n, m) => n + m.content.length, 0);
    if (size > 90000 && messages.length > 4) {
      let summary = "";
      try { summary = await llm(messages.concat([{role: "user", content: "Summarize the progress so far in under 400 words: goal, what is done, files changed, current state, open problems, next steps. No tool calls."}])); } catch (e) {}
      messages = [messages[0], {role: "assistant", content: "Progress summary so far:\n" + (summary || "(summary unavailable)")}, {role: "user", content: "Continue from the summary. Re-read files before editing them."}];
      emit("info", "Context compacted.");
    }

    const reply = await llm(messages);
    const parsed = parseTools(reply);
    if (parsed.thought) emit("thought", parsed.thought.slice(0, 700));
    messages.push({role: "assistant", content: reply});

    if (parsed.calls.length === 0) {
      if (++noTool >= 2) return end("done", parsed.thought || reply.slice(0, 2000), ctx.memories);
      messages.push({role: "user", content: "Use a tool, or call <finish>...</finish> if you are done."});
      continue;
    }
    noTool = 0;

    const sig = parsed.calls.map((c) => c.name + JSON.stringify(c.attrs) + c.body.slice(0, 60)).join("|");
    sigs.push(sig);
    if (sigs.length >= 3 && new Set(sigs.slice(-3)).size === 1) {
      messages.push({role: "user", content: "You repeated the same tool calls 3 times. Change your approach."});
      continue;
    }

    const out = [];
    let image = null;
    let fin = null;
    let mutated = false;
    for (const c of parsed.calls) {
      if (fin !== null) break;
      emit("tool", label(c));
      if (c.name === "finish") { fin = c.body.trim() || "Done."; out.push(""); continue; }
      if (c.name === "write" || c.name === "edit") emit("diff", c.name, {path: c.attrs.path, lines: diffOf(c)});
      let res;
      try { res = await runTool(c, ctx); } catch (e) { res = {text: "ERROR: " + (e && e.message ? e.message : "tool failed")}; }
      out.push(res.text);
      if (res.image) image = res.image;
      if (res.mutated) mutated = true;
      emit(c.name === "bash" ? "term" : "result", c.name === "bash" ? "$ " + c.body.trim() + "\n" + res.text : res.text.slice(0, 300));
    }
    if (mutated) {
      const sha = checkpoint("Step: " + parsed.calls.map((c) => c.name + (c.attrs.path ? " " + c.attrs.path : "")).join(", "));
      if (sha) emit("checkpoint", sha);
    }
    if (fin !== null) return end("done", fin, ctx.memories);

    const results = parsed.calls.map((c, i) => "<result tool=\"" + c.name + "\"" + (c.attrs.path ? " path=\"" + c.attrs.path + "\"" : "") + ">\n" + String(out[i] || "").slice(0, 14000) + "\n</result>").join("\n");
    const next = {role: "user", content: "<results>\n" + results.slice(0, 40000) + "\n</results>\nContinue. Call <finish> when the task is complete and verified."};
    if (image) next.image = image;
    messages.push(next);
  }
  return end("done", "Reached the step limit before finishing - see the todo list and files for progress.", ctx.memories);
}

process.on("uncaughtException", (e) => {
  try { end("error", "Runner crashed: " + (e && e.message ? e.message : String(e)), []); } catch (x) {}
  process.exit(1);
});
main().catch((e) => {
  try { end("error", e && e.message ? e.message : String(e), []); } catch (x) {}
  process.exit(1);
});
`;