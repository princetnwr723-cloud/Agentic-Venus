// Background computer agent. Runs INSIDE the E2B desktop as a detached Node process,
// so it keeps working when the browser tab is closed.
// NOTE: the source below must not contain backticks or dollar-brace sequences (it lives in a template string).

export const PC_RUNNER_VERSION = "1";

export const PC_RUNNER_SOURCE = String.raw`import fs from "node:fs";
import {spawn, spawnSync} from "node:child_process";

process.env.DISPLAY = process.env.DISPLAY || ":0";
const id = process.argv[2];
const BASE = "/home/user/runner/jobs/" + id;
const job = JSON.parse(fs.readFileSync(BASE + "/job.json", "utf8"));
const KEY = fs.readFileSync(BASE + "/key", "utf8").trim();
try { fs.unlinkSync(BASE + "/key"); } catch (e) {}
const APP = String(job.appUrl || "").replace(/\/+$/, "");
const EV = BASE + "/events.jsonl";
const ANS = BASE + "/answers";
const SH = BASE + "/sh";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const q = (s) => "'" + String(s).replace(/'/g, "'\\''") + "'";
const stopped = () => fs.existsSync(BASE + "/stop");

let state = {status: "running", step: 0, summary: "", startedAt: Date.now(), pending: null};
function save(o) {
  state = Object.assign(state, o, {updatedAt: Date.now()});
  fs.writeFileSync(BASE + "/state.tmp", JSON.stringify(state));
  fs.renameSync(BASE + "/state.tmp", BASE + "/state.json");
}
function emit(k, text, extra) {
  fs.appendFileSync(EV, JSON.stringify(Object.assign({k: k, text: String(text == null ? "" : text).slice(0, 900)}, extra || {})) + "\n");
}

// ---------------- LLM ----------------
const OPENAI_URLS = {
  openai: "https://api.openai.com/v1/chat/completions", grok: "https://api.x.ai/v1/chat/completions",
  openrouter: "https://openrouter.ai/api/v1/chat/completions", mistral: "https://api.mistral.ai/v1/chat/completions",
  perplexity: "https://api.perplexity.ai/chat/completions", groq: "https://api.groq.com/openai/v1/chat/completions",
  deepseek: "https://api.deepseek.com/chat/completions", apinex: "https://apinex.bond/v1/chat/completions"
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
  const p = job.provider, model = job.model;
  if (p === "anthropic") {
    const msgs = messages.map((m) => ({role: m.role, content: m.image ? [{type: "image", source: {type: "base64", media_type: m.image.mediaType, data: m.image.data}}, {type: "text", text: m.content}] : m.content}));
    const d = await post("https://api.anthropic.com/v1/messages", {"x-api-key": KEY, "anthropic-version": "2023-06-01"}, {model: model, max_tokens: 4096, messages: msgs});
    return (d.content || []).map((b) => b.text || "").join("");
  }
  if (p === "gemini") {
    const contents = messages.map((m) => ({role: m.role === "assistant" ? "model" : "user", parts: m.image ? [{inline_data: {mime_type: m.image.mediaType, data: m.image.data}}, {text: m.content}] : [{text: m.content}]}));
    const d = await post("https://generativelanguage.googleapis.com/v1beta/models/" + model + ":generateContent", {"x-goog-api-key": KEY}, {contents: contents, generationConfig: {maxOutputTokens: 4096}});
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
    try { return await callOnce(messages); }
    catch (e) {
      const m = String(e && e.message ? e.message : e);
      if (attempt === 4 || !/( 429| 5\d\d|overloaded|rate limit|timeout|timed out|fetch failed|ECONN|socket)/i.test(m)) throw e;
      emit("info", "Model busy, retrying in " + 2 * Math.pow(2, attempt) + "s...");
      await sleep(2000 * Math.pow(2, attempt));
    }
  }
  return "";
}

// ---------------- server calls (job token: the sandbox never holds your connector tokens) ----------------
async function api(path, body) {
  try {
    const res = await fetch(APP + path, {method: "POST", headers: {"Content-Type": "application/json", Authorization: "Bearer " + job.token}, body: JSON.stringify(body), signal: AbortSignal.timeout(95000)});
    const d = await res.json().catch(() => ({}));
    return {ok: res.ok, d: d};
  } catch (e) { return {ok: false, d: {error: String(e && e.message ? e.message : e)}}; }
}

// ---------------- asking the human (login / approval / question) ----------------
let askN = 0;
async function ask(req) {
  const pid = "q" + (++askN);
  save({pending: Object.assign({id: pid, at: Date.now()}, req)});
  emit("info", "Waiting for you: " + String(req.question || req.site || req.message || req.kind).slice(0, 120));
  fs.mkdirSync(ANS, {recursive: true});
  const file = ANS + "/" + pid + ".json";
  const deadline = Date.now() + 30 * 60000;
  for (;;) {
    if (stopped()) { save({pending: null}); throw new Error("STOPPED"); }
    if (fs.existsSync(file)) {
      let a = {type: "answer", text: ""};
      try { a = JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) {}
      save({pending: null});
      return a;
    }
    if (Date.now() > deadline) { save({pending: null}); return {type: "answer", text: req.kind === "choice" ? "Cancel" : ""}; }
    await sleep(1500);
  }
}

// ---------------- screen ----------------
function screenshot() {
  const out = "/tmp/pc-" + id + ".png";
  try { fs.unlinkSync(out); } catch (e) {}
  spawnSync("bash", ["-lc", "scrot -o " + out + " 2>/dev/null || import -window root " + out + " 2>/dev/null"], {timeout: 20000});
  if (!fs.existsSync(out)) throw new Error("Could not take a screenshot (is the desktop running?)");
  const buf = fs.readFileSync(out);
  return {data: buf.toString("base64"), mediaType: "image/png", width: buf.readUInt32BE(16), height: buf.readUInt32BE(20)};
}
function xdo(args) {
  const r = spawnSync("xdotool", args.map(String), {timeout: 15000, encoding: "utf8"});
  if (r.error || r.status !== 0) throw new Error("xdotool: " + String((r.stderr || (r.error && r.error.message)) || "failed").slice(0, 120));
}
function bg(cmd) { spawn("bash", ["-lc", "nohup " + cmd + " >/dev/null 2>&1 &"], {detached: true, stdio: "ignore"}).unref(); }
const KEYS = {enter: "Return", return: "Return", esc: "Escape", escape: "Escape", backspace: "BackSpace", delete: "Delete", del: "Delete", tab: "Tab", space: "space", control: "ctrl", ctrl: "ctrl", alt: "alt", shift: "shift", left: "Left", right: "Right", up: "Up", down: "Down", pageup: "Prior", pagedown: "Next", home: "Home", end: "End"};
const nk = (k) => KEYS[String(k).trim().toLowerCase()] || String(k).trim();
const CHROME = "google-chrome --no-sandbox --no-first-run --no-default-browser-check";
const APPS = {chrome: CHROME, "google-chrome": CHROME, firefox: "firefox", terminal: "xfce4-terminal", code: "code --no-sandbox --user-data-dir=/home/user/.vscode-agent", vscode: "code --no-sandbox --user-data-dir=/home/user/.vscode-agent", files: "thunar"};

function screenAction(a, shot) {
  let x = Number(a.x) || 0, y = Number(a.y) || 0;
  if (x <= 1 && y <= 1 && (!Number.isInteger(x) || !Number.isInteger(y))) { x *= shot.width; y *= shot.height; }
  x = Math.round(Math.min(Math.max(x, 0), shot.width - 1));
  y = Math.round(Math.min(Math.max(y, 0), shot.height - 1));
  switch (a.type) {
    case "click": xdo(["mousemove", x, y, "click", 1]); return "click (" + x + ", " + y + ")";
    case "double_click": xdo(["mousemove", x, y, "click", "--repeat", 2, "--delay", 80, 1]); return "double-click (" + x + ", " + y + ")";
    case "right_click": xdo(["mousemove", x, y, "click", 3]); return "right-click (" + x + ", " + y + ")";
    case "type": xdo(["type", "--delay", 25, "--clearmodifiers", "--", String(a.text || "")]); return "type " + JSON.stringify(String(a.text || "").slice(0, 60));
    case "key": xdo(["key", "--clearmodifiers", String(a.keys || "").split("+").map(nk).join("+")]); return "press " + a.keys;
    case "scroll": xdo(["mousemove", x, y, "click", "--repeat", Math.min(Math.max(Number(a.amount) || 3, 1), 15), a.direction === "up" ? 4 : 5]); return "scroll " + (a.direction === "up" ? "up" : "down");
    default: throw new Error("Unknown screen action " + a.type);
  }
}

// ---------------- shell ----------------
let shN = 0;
function startShell(cmd) {
  fs.mkdirSync(SH, {recursive: true});
  const jid = "j" + (++shN);
  fs.writeFileSync(SH + "/" + jid + ".sh", "cd ~\nexport PATH=\"$HOME/.local/bin:$HOME/.npm-global/bin:$PATH\"\nexport CI=1 DEBIAN_FRONTEND=noninteractive\n" + cmd + "\n");
  spawn("bash", ["-lc", "bash " + q(SH + "/" + jid + ".sh") + " > " + q(SH + "/" + jid + ".log") + " 2>&1; echo $? > " + q(SH + "/" + jid + ".exit")], {detached: true, stdio: "ignore"}).unref();
  return jid;
}
function readShell(jid) {
  let log = "", ex = null;
  try { log = fs.readFileSync(SH + "/" + jid + ".log", "utf8"); } catch (e) {}
  try { ex = fs.readFileSync(SH + "/" + jid + ".exit", "utf8").trim(); } catch (e) {}
  return {done: ex !== null && ex !== "", exitCode: ex ? Number(ex) : undefined, log: log.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "").replace(/\r/g, "").trim()};
}
async function doShell(a, check) {
  let jid;
  if (check) jid = String(a.job || "").replace(/[^a-z0-9]/g, "");
  else {
    const cmd = String(a.command || "").trim();
    if (!cmd) return {text: "FAILED shell: empty command", output: "ERROR: empty command"};
    jid = startShell(cmd);
  }
  const wait = a.background === true ? 4000 : Math.min(Math.max(5, Number(a.timeout) || 120), 900) * 1000;
  const deadline = Date.now() + wait;
  for (;;) {
    await sleep(1200);
    const s = readShell(jid);
    if (s.done) return {text: "$ " + String(a.command || ("check " + jid)).slice(0, 80) + " -> exit " + s.exitCode, output: "exit code: " + s.exitCode + "\n" + s.log.slice(-3500), shellOk: s.exitCode === 0};
    if (stopped()) throw new Error("STOPPED");
    if (Date.now() >= deadline) return {text: "shell still running (" + jid + ")", output: "STILL RUNNING (job " + jid + "). Use shell_check with this job id to wait for it. NEVER start the same command again.\n" + s.log.slice(-2500)};
  }
}

// ---------------- web (local, no server needed) ----------------
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const strip = (s) => s.replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();
async function webRead(url) {
  const res = await fetch(url, {headers: {"User-Agent": UA}, redirect: "follow", signal: AbortSignal.timeout(20000)});
  if (!res.ok) throw new Error("HTTP " + res.status);
  const raw = (await res.text()).slice(0, 600000);
  return ((res.headers.get("content-type") || "").includes("html") ? strip(raw) : raw).slice(0, 4500);
}
async function webSearch(query) {
  const res = await fetch("https://html.duckduckgo.com/html/?q=" + encodeURIComponent(query), {headers: {"User-Agent": UA}, signal: AbortSignal.timeout(20000)});
  if (!res.ok) throw new Error("HTTP " + res.status);
  const html = await res.text();
  const links = Array.from(html.matchAll(/<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g));
  const snips = Array.from(html.matchAll(/<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g));
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

// ---------------- recipes: label-based steps (same idea as the in-app recorder) ----------------
function parseEls(snap) {
  const s = snap.indexOf("ELEMENTS"), e = snap.indexOf("PAGE TEXT:");
  const block = s >= 0 ? snap.slice(s, e > s ? e : undefined) : snap;
  const out = [];
  for (const line of block.split("\n")) {
    const m = /^\[(\d+)\] ([a-z0-9]+)(?:\([^)]*\))? "([^"]*)"/.exec(line);
    if (m) out.push({id: Number(m[1]), tag: m[2], label: m[3]});
  }
  return out;
}
function labelOps(ops, prev) {
  const els = parseEls(prev || "");
  const out = [];
  for (const o of ops) {
    if (o.op === "press") { out.push({op: "press", key: String(o.key || "Enter")}); continue; }
    if (o.op === "scroll") { out.push({op: "scroll", dir: o.dir === "up" ? "up" : "down"}); continue; }
    if (o.op === "wait") { out.push({op: "wait", ms: Number(o.ms) || 1000}); continue; }
    if (o.op !== "click" && o.op !== "type" && o.op !== "secret") return null;
    const el = els.find((x) => x.id === Number(o.id));
    if (!el || !el.label) return null;
    const nth = Math.max(0, els.filter((x) => x.label === el.label && x.tag === el.tag).findIndex((x) => x.id === el.id));
    const t = {label: el.label, tag: el.tag, nth: nth};
    if (o.op === "click") out.push(Object.assign({op: "click_label"}, t));
    else if (o.op === "type") out.push(Object.assign({op: "type_label", text: String(o.text || "")}, t));
    else out.push(Object.assign({op: "secret_label", field: o.field === "password" ? "password" : "email"}, t));
  }
  return out;
}

// ---------------- screen recording (proof of work) ----------------
const proof = {proc: null, file: "/tmp/proof-" + id + ".mp4"};
function startProof(w, h) {
  if (!job.proof) return;
  try {
    const W = w - (w % 2), H = h - (h % 2);
    proof.proc = spawn("ffmpeg", ["-y", "-loglevel", "error", "-f", "x11grab", "-framerate", "4", "-video_size", W + "x" + H, "-i", ":0", "-c:v", "libx264", "-preset", "ultrafast", "-crf", "34", "-pix_fmt", "yuv420p", "-t", "3300", proof.file], {stdio: ["pipe", "ignore", "ignore"]});
    proof.proc.on("error", () => { proof.proc = null; });
    emit("info", "Screen recording started (proof of work).");
  } catch (e) { proof.proc = null; }
}
async function uploadProof() {
  if (!fs.existsSync(proof.file) || fs.statSync(proof.file).size < 2000) return null;
  if (fs.statSync(proof.file).size > 60000000) { emit("info", "Recording too large to upload."); return null; }
  const r = await api("/api/proof", {action: "upload"});
  if (!r.ok || !r.d.uploadUrl) return null;
  const c = spawnSync("curl", ["-sS", "-o", "/dev/null", "-w", "%{http_code}", "--max-time", "180", "-X", "PUT", r.d.uploadUrl, "-H", "Content-Type: video/mp4", "-H", "x-upsert: true", "--data-binary", "@" + proof.file], {encoding: "utf8", timeout: 200000});
  return String(c.stdout).trim() === "200" ? r.d.path : null;
}
function stopProof() {
  return new Promise((resolve) => {
    const p = proof.proc;
    if (!p) return resolve(null);
    let done = false;
    const fin = async () => {
      if (done) return;
      done = true;
      try { resolve(await uploadProof()); } catch (e) { resolve(null); }
    };
    p.once("exit", fin);
    try { p.stdin.write("q\n"); } catch (e) {}
    setTimeout(() => { try { p.kill("SIGINT"); } catch (e) {} }, 8000);
    setTimeout(fin, 22000);
  });
}

// ---------------- prompt ----------------
function systemPrompt(w, h, tools) {
  return [
    "You are an AI agent that works on a Linux computer the way a capable person would. You see the screen (screenshot " + w + "x" + h + " px; coordinates are ABSOLUTE PIXELS, (0,0) top-left). The computer is already on.",
    "You run in the BACKGROUND: the user may be away. Do not wait for the user unless a login, an approval or a one-time code is really needed.",
    'Reply with ONE JSON object only, no prose, no fences: {"observation":"what you see / what the last output said","thought":"next step, one sentence","action":{...}}',
    "TOOLS",
    '{"type":"web_search","query":"..."}   {"type":"web_read","url":"https://..."}   fast web research as text',
    '{"type":"browse","url":"https://...","ops":[{"op":"click","id":5},{"op":"type","id":3,"text":"..."},{"op":"secret","id":3,"field":"email"},{"op":"press","key":"Enter"},{"op":"scroll","dir":"down"}]}   FAST DOM browser: returns a NUMBERED list of buttons/links/inputs; act by number. Omit url to stay on the page. Do a whole form in ONE call.',
    '{"type":"shell","command":"...","timeout":120}   run a command (non-interactive: -y, CI=1). {"type":"shell_check","job":"j1"} waits for a command that was still running.',
    '{"type":"tool","name":"<tool name>","args":{...}}   use a connected service (list below). Write actions ask the user for approval automatically.',
    '{"type":"note","text":"..."}   save a short finding for the whole task',
    'Screen actions (only when the GUI is really needed): {"type":"click","x":N,"y":N} {"type":"double_click","x":N,"y":N} {"type":"right_click","x":N,"y":N} {"type":"type","text":"..."} {"type":"key","keys":"Return"} {"type":"scroll","x":N,"y":N,"direction":"down","amount":3} {"type":"wait","seconds":2} {"type":"open_url","url":"https://..."} {"type":"launch","app":"chrome|firefox|terminal|code|files"}',
    'Asking the user: {"type":"need_login","site":"Gmail"} {"type":"ask_user","question":"...","options":["A","B"]}',
    'Finishing: {"type":"done","summary":"the REAL results: findings, versions, paths, links"}',
    tools ? "CONNECTED TOOLS:\n" + tools : "No connected tools in this chat.",
    "RULES",
    "1. Pick the tool a person would: research = web_search/web_read; websites, forms, logins = browse (numbers beat pixel clicks); terminal work = shell; connected services = tool; other apps = screen actions.",
    "2. If a tool fails, read the error, fix the cause, try another tool. Never repeat the same action more than twice. Stay strictly on the task.",
    "3. NEVER invent credentials. If a site needs a login use need_login ONCE, then use browse with op secret (field email, then password). For OTPs and captchas use ask_user.",
    "4. Before an irreversible outward action done through the screen (sending, posting, buying, deleting) call ask_user with options Approve and Cancel and continue only on Approve. Tools ask by themselves.",
    "5. Call done as soon as the task is complete, with real results in the summary."
  ].join("\n");
}
const ALLOWED = ["web_search", "web_read", "browse", "tool", "shell", "shell_check", "click", "double_click", "right_click", "type", "key", "scroll", "wait", "open_url", "launch", "note", "need_login", "ask_user", "done"];
function parseStep(text) {
  const a = text.indexOf("{"), b = text.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  try {
    const p = JSON.parse(text.slice(a, b + 1));
    if (!p.action || ALLOWED.indexOf(p.action.type) < 0) return null;
    return {thought: String(p.thought || ""), action: p.action};
  } catch (e) { return null; }
}

// ---------------- main ----------------
let rec = [], recOk = true, finished = false;
async function finishUp(status, summary) {
  if (finished) return;
  finished = true;
  let proofPath = null;
  try { proofPath = await stopProof(); } catch (e) {}
  const s = String(summary).slice(0, 6000);
  if (status === "error") emit("error", s);
  save({status: status, summary: s, recipe: recOk && rec.length ? rec : null, proof: proofPath, pending: null});
}

async function main() {
  emit("info", "Background computer agent started. It keeps working if you close the browser.");
  const need = ["xdotool", "scrot", "ffmpeg"].filter((b) => spawnSync("bash", ["-lc", "command -v " + b]).status !== 0);
  if (need.length) {
    emit("info", "Installing screen tools (" + need.join(", ") + ")...");
    spawnSync("bash", ["-lc", "sudo apt-get -o DPkg::Lock::Timeout=600 update -y; sudo DEBIAN_FRONTEND=noninteractive apt-get -o DPkg::Lock::Timeout=600 install -y " + need.join(" ")], {timeout: 900000});
  }
  let tools = "";
  const tl = await api("/api/tools", {action: "list"});
  if (tl.ok && Array.isArray(tl.d.specs)) tools = tl.d.specs.filter((s) => s.name.indexOf("web.") !== 0).slice(0, 40).map((s) => "- " + s.name + "(" + s.params + ")" + (s.risk === "write" ? " (write) " : " ") + "- " + s.description).join("\n");

  let session = job.session || null, lastBrowse = job.healSnapshot || "", credSite = "";
  const history = [], notes = [];
  let lastOutput = job.healSnapshot ? "The browser is already open on " + (job.startUrl || "the page") + ". Current page:\n" + job.healSnapshot.slice(0, 3500) : "";
  let invalid = 0, actions = 0, runningJob = null, first = true;
  const max = job.maxSteps || 90;
  const deadline = Date.now() + 120 * 60000;

  for (let step = 0; step < max * 2 && actions < max; step++) {
    if (stopped()) return finishUp("stopped", "Stopped by the user.");
    if (Date.now() > deadline) return finishUp("error", "Time limit reached before the task was finished.");
    save({step: actions + 1});
    const shot = screenshot();
    if (first) { first = false; startProof(shot.width, shot.height); }

    const last3 = history.slice(-3).map((l) => l.split("->").pop().trim());
    const hint = last3.length === 3 && last3[0] && last3[0] === last3[1] && last3[1] === last3[2] ? "IMPORTANT: you repeated the same action 3 times with no progress. Use a different tool or approach." : "";
    const left = max - actions;
    const content = [
      systemPrompt(shot.width, shot.height, tools),
      "TASK: " + job.instruction,
      job.context ? "WHAT YOU KNOW ABOUT THE USER:" + job.context : "",
      "Action " + (actions + 1) + " of " + max + ". " + (left <= 3 ? "IMPORTANT: almost out of steps - call done NOW with what you have." : ""),
      "Notes saved so far:\n" + (notes.length ? notes.slice(-20).map((n) => "- " + n).join("\n") : "(none)"),
      "Steps so far:\n" + (history.length ? history.slice(-14).join("\n") : "(none yet)"),
      runningJob ? "A command is STILL RUNNING: job " + runningJob + ". Call shell_check with this job id. Do NOT start it again." : "",
      lastOutput ? "Output of your previous action:\n" + lastOutput : "",
      hint,
      "Here is the current screen. Reply with the JSON for the next action."
    ].filter(Boolean).join("\n\n");

    const reply = await llm([{role: "user", content: content, image: {mediaType: shot.mediaType, data: shot.data}}]);
    const parsed = parseStep(reply);
    if (!parsed) {
      if (++invalid >= 4) return finishUp("error", "The model keeps answering in the wrong format. Pick a stronger vision model.");
      continue;
    }
    invalid = 0;
    const a = parsed.action;
    if (a.type === "done") return finishUp("done", a.summary || "Done.");

    let text = "", out = "";
    try {
      if (a.type === "note") { notes.push(String(a.text || "").slice(0, 500)); text = "noted: " + String(a.text || "").slice(0, 80); }
      else if (a.type === "web_search") { out = await webSearch(String(a.query || "")); text = 'web search "' + String(a.query || "").slice(0, 60) + '"'; }
      else if (a.type === "web_read") { out = await webRead(String(a.url || "")); text = "read " + String(a.url || "").slice(0, 70); }
      else if (a.type === "shell" || a.type === "shell_check") {
        const r = await doShell(a, a.type === "shell_check");
        text = r.text; out = r.output || "";
        runningJob = out.indexOf("STILL RUNNING") === 0 ? (/job (j\d+)/.exec(out) || [])[1] || null : null;
        if (a.type === "shell" && r.shellOk === true) rec.push({kind: "shell", command: String(a.command)});
        else if (r.shellOk !== true) recOk = recOk && !(a.type === "shell" && r.output && r.output.indexOf("STILL RUNNING") !== 0);
      }
      else if (a.type === "browse") {
        const ops = Array.isArray(a.ops) ? a.ops.slice(0, 12) : [];
        const r = await api("/api/browser", {url: a.url || undefined, ops: ops, session: session, credSite: credSite || undefined});
        if (!r.ok || r.d.error) { out = "ERROR: " + (r.d.error || "browse failed") + " - try again or use the screen browser."; recOk = false; }
        else {
          session = r.d.session; out = String(r.d.snapshot);
          if (/^FAILED /m.test(out)) recOk = false;
          else {
            const lab = labelOps(ops, lastBrowse);
            if (!lab) recOk = false;
            else if (lab.length || a.url) rec.push({kind: "browse", url: a.url || undefined, ops: lab});
          }
          lastBrowse = out;
        }
        text = "browse " + String(a.url || "(same page)").slice(0, 70) + " - " + ops.length + " op(s)";
      }
      else if (a.type === "tool") {
        const name = String(a.name || ""), args = a.args && typeof a.args === "object" ? a.args : {};
        let r = await api("/api/tools", {action: "call", name: name, args: args});
        if (r.d.needsApproval) {
          const ans = await ask({kind: "choice", question: "Approve this action?\n" + r.d.needsApproval.summary, options: ["Approve", "Cancel"]});
          if (ans.type === "answer" && ans.text === "Approve") r = await api("/api/tools", {action: "call", name: name, args: args, approved: true});
          else { out = "The user declined this action. Do not retry it."; r = null; }
        }
        if (r) { out = String(r.d.text || r.d.error || ""); if (r.d.ok) rec.push({kind: "tool", name: name, args: args}); else recOk = false; }
        text = "tool " + name;
      }
      else if (a.type === "need_login") {
        const site = String(a.site || "this site");
        const rep = await ask({kind: "login", site: site});
        if (rep.type === "login_saved") { credSite = site; out = "Login details for " + site + " are saved on the server. Use browse with op secret (field email, then password) on the login inputs."; }
        else { await ask({kind: "handoff", message: "Log in to " + site + " on the computer (you have control now), then press Continue."}); out = "The user logged in to " + site + " themselves. Continue the task."; }
        recOk = recOk && rep.type === "login_saved";
        text = "login " + site;
      }
      else if (a.type === "ask_user") {
        const options = Array.isArray(a.options) ? a.options.filter((o) => typeof o === "string" && o.trim()).slice(0, 8) : [];
        const rep = await ask(options.length ? {kind: "choice", question: String(a.question || "The agent needs your input."), options: options} : {kind: "text", question: String(a.question || "The agent needs your input.")});
        out = 'Asked the user: "' + a.question + '" -> the user answered: "' + (rep.text || "") + '"';
        text = "asked: " + String(a.question || "").slice(0, 70);
        recOk = false;
      }
      else if (a.type === "wait") { const s = Math.min(Math.max(Number(a.seconds) || 2, 1), 5); await sleep(s * 1000); text = "wait " + s + "s"; recOk = false; }
      else if (a.type === "open_url") {
        const u = /^https?:\/\//i.test(String(a.url)) ? String(a.url) : "https://" + a.url;
        bg(CHROME + " " + q(u)); await sleep(4000); text = "open " + u; recOk = false;
      }
      else if (a.type === "launch") {
        const c = APPS[String(a.app || "").toLowerCase()];
        if (!c) throw new Error("Unknown app. Use chrome, firefox, terminal, code or files.");
        bg(c); await sleep(3500); text = "launch " + a.app; recOk = false;
      }
      else { text = screenAction(a, shot); await sleep(1200); recOk = false; }
    } catch (e) {
      if (String(e && e.message) === "STOPPED") return finishUp("stopped", "Stopped by the user.");
      text = "FAILED " + a.type + ": " + String(e && e.message ? e.message : e).slice(0, 160);
      out = "ERROR: " + text;
      recOk = false;
    }
    actions++;
    lastOutput = out.slice(0, 4500);
    const line = actions + ". " + (parsed.thought ? parsed.thought + " -> " : "") + text;
    history.push(line);
    emit("step", line);
  }
  return finishUp("done", "Reached the step limit - only partial work may be done.");
}

process.on("uncaughtException", (e) => { try { finishUp("error", "Runner crashed: " + (e && e.message ? e.message : String(e))); } catch (x) {} });
main().then(() => process.exit(0)).catch(async (e) => {
  const m = String(e && e.message ? e.message : e);
  await finishUp(m === "STOPPED" ? "stopped" : "error", m === "STOPPED" ? "Stopped by the user." : m);
  process.exit(0);
});
`;
