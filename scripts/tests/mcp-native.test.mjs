// MCP v2: chat picker, per-chat tools, write gate, Claude-written video storyboard, image results. Server actions are faked.
import test from "node:test";
import assert from "node:assert/strict";
import { NATIVE_SPECS, runNative, isNative, WRITE_OFF } from "../../lib/mcp/native.ts";
import { planClaudeVideo } from "../../lib/mcp/video-core.ts";
import { handleRpc } from "../../lib/mcp/rpc.ts";
import { listable, toNative, fromNative } from "../../lib/mcp/names.ts";

const chatInfo = (id, extra = {}) => ({ id, name: "Sales bot", provider: "openai", model: "gpt-x", messages: 3, lastAt: 1700000000000, lastText: "hi", pc: "on", code: true, repo: "a/b", connected: ["google"], team: ["chief"], ...extra });
function deps(log = []) {
  const rec = (n) => async (...a) => { log.push([n, ...a.slice(1)]); return n === "screenshot" ? { mediaType: "image/png", data: "AAAA" } : n === "code" ? { text: "ok code" } : n === "startVideo" ? "v123" : n === "groupMembers" ? [{ id: "chief", name: "Chief", title: "Lead", tool: "think" }, { id: "hunter", name: "Hunter", title: "Leads", tool: "pc" }] : n === "groupMsgs" ? [{ id: "1", at: 1, from: "you", text: "find leads", kind: "say" }] : n === "groupState" ? { pins: ["launch 5 Dec"], memory: { chief: ["likes short"] }, working: { hunter: "scraping" }, running: [] } : n === "chatDetail" ? { ...chatInfo(a[1]), recent: [{ role: "user", content: "yo" }] } : n === "listChats" ? [chatInfo("c1"), chatInfo("c2", { name: "Other", pc: "none" })] : `done ${n}`; };
  return Object.fromEntries(["groupMembers", "groupMsgs", "groupState", "groupPost", "groupSave", "groupWorking", "listChats", "chatDetail", "screenshot", "pcAction", "shell", "shellOutput", "code", "browser", "roster", "startVideo"].map((n) => [n, rec(n)]));
}
const run = (name, args, write = true, log = []) => runNative(name, args, { uid: "u1", write, deps: deps(log) });

test("every native tool name survives the MCP name round trip", () => {
  for (const s of NATIVE_SPECS) { assert.equal(listable(s.name), true, s.name); assert.equal(fromNative(toNative(s.name)), s.name); assert.equal(isNative(s.name), true); }
  assert.equal(runNative("web.search", {}, { uid: "u", write: true, deps: deps() }) instanceof Promise, true);
});

test("venus.chats lists every chat with its id; needs no chat argument", async () => {
  const r = await run("venus.chats", {});
  assert.equal(r.isError, false);
  assert.match(r.text, /c1/); assert.match(r.text, /c2/); assert.match(r.text, /Sales bot/); assert.match(r.text, /computer none/);
});

test("a chat-bound tool without a valid chat tells Claude to pick one", async () => {
  for (const bad of [undefined, "", "mcp", "../x", "a b", "x".repeat(65)]) {
    const r = await run("computer.screenshot", bad === undefined ? {} : { chat: bad });
    assert.equal(r.isError, true, String(bad));
    assert.match(r.text, /venus__chats/);
  }
});

test("venus.chat, screenshot (image result), shell, action", async () => {
  const log = [];
  assert.match((await run("venus.chat", { chat: "c1" }, false, log)).text, /Selected chat/);
  const shot = await run("computer.screenshot", { chat: "c1" }, false, log);
  assert.equal(shot.image.mediaType, "image/png");
  assert.equal((await run("computer.shell", { chat: "c1", command: "ls" }, true, log)).text, "done shell");
  const a = await run("computer.act", { chat: "c1", type: "click", x: 10, y: "20", text: "t", bogus: 1 }, true, log);
  assert.equal(a.isError, false);
  const act = log.find((l) => l[0] === "pcAction");
  assert.deepEqual(act[2], { type: "click", text: "t", x: 10, y: 20 });
  assert.equal((await run("computer.act", { chat: "c1", type: "format_disk" })).isError, true);
});

test("write tools are refused when Actions is OFF; read tools still work", async () => {
  for (const [n, a] of [["computer.shell", { command: "ls" }], ["computer.act", { type: "key", keys: "a" }], ["code.write", { path: "a", content: "x" }], ["code.edit", { path: "a", old: "x", new: "y" }], ["code.bash", { command: "ls" }], ["venus.make_video", { title: "t", scenes: [{ type: "title", seconds: 4, headline: "x" }] }]]) {
    const r = await run(n, { chat: "c1", ...a }, false);
    assert.equal(r.isError, true, n); assert.equal(r.text, WRITE_OFF);
  }
  assert.equal((await run("code.read", { chat: "c1", path: "a.ts" }, false)).isError, false);
  assert.equal((await run("team.roster", { chat: "c1" }, false)).isError, false);
});

test("code tools become the right Venus Code calls", async () => {
  const log = [];
  await run("code.write", { chat: "c1", path: "src/a.ts", content: "const a=1;\n" }, true, log);
  await run("code.edit", { chat: "c1", path: "src/a.ts", old: "a=1", new: "a=2", replace_all: true }, true, log);
  await run("code.bash", { chat: "c1", command: "npm test", timeout: 20, background: true }, true, log);
  await run("code.grep", { chat: "c1", pattern: "foo", glob: "*.ts" }, true, log);
  const calls = log.filter((l) => l[0] === "code").map((l) => l[2]);
  assert.deepEqual(calls[0], { name: "write", attrs: { path: "src/a.ts" }, body: "const a=1;\n" });
  assert.deepEqual(calls[1], { name: "edit", attrs: { path: "src/a.ts", replace_all: "true" }, body: "", old: "a=1", new: "a=2" });
  assert.deepEqual(calls[2], { name: "bash", attrs: { timeout: "20", background: "true" }, body: "npm test" });
  assert.deepEqual(calls[3], { name: "grep", attrs: { pattern: "foo", glob: "*.ts" }, body: "" });
  assert.equal((await run("code.read", { chat: "c1" })).isError, true);
  assert.equal((await run("code.edit", { chat: "c1", path: "a", old: "" })).isError, true);
});

test("browser.run needs no chat and drops unsafe ops (no secret/login ops)", async () => {
  const log = [];
  await run("browser.run", { url: "https://example.com", ops: [{ op: "click_label", label: "x" }, { op: "secret", id: 1, field: "password" }, "x"] }, false, log);
  assert.deepEqual(log.find((l) => l[0] === "browser")[1], [{ op: "click_label", label: "x" }]);
  assert.equal((await run("browser.run", {}, false)).isError, true);
});

test("Claude-written video: scenes are cleaned, custom without code becomes text, bad code is refused", () => {
  const p = planClaudeVideo({ title: "Launch", aspect: "9:16", theme: "neon", scenes: [
    { type: "title", seconds: 4, headline: "Hello" }, { type: "bullets", seconds: 5, headline: "Why", items: ["a", "b"] },
    { type: "custom", seconds: 4, headline: "Big", brief: "x" },
    { type: "custom", seconds: 4, code: "export default function S(){ return fetch('x') }  // aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
    { type: "nonsense", seconds: 999 },
  ] });
  assert.equal(p.error, undefined);
  assert.equal(p.aspect, "9:16"); assert.equal(p.theme, "neon"); assert.equal(p.scenes, 5); assert.equal(p.voice, false);
  const sb = JSON.parse(p.storyboardJson);
  assert.equal(sb.width, 720); assert.equal(sb.height, 1280);
  assert.equal(sb.scenes[2].type, "title"); assert.equal(sb.scenes[3].type, "title");
  assert.ok(sb.scenes.every((s) => s.seconds <= 30));
  assert.equal(p.notes.length, 2);
  assert.ok(p.seconds >= 10);
  assert.ok(planClaudeVideo({ title: "x", scenes: [] }).error);
  assert.ok(planClaudeVideo({ title: "x" }).error);
  assert.ok(planClaudeVideo({ title: "x", scenes: new Array(61).fill({ type: "title", seconds: 3 }) }).error);
});

test("venus.make_video starts the run through the deps with the cleaned plan", async () => {
  const log = [];
  const r = await run("venus.make_video", { chat: "c1", title: "T", scenes: [{ type: "title", seconds: 4, headline: "Hi" }, { type: "outro", seconds: 4, headline: "Bye" }] }, true, log);
  assert.equal(r.isError, false); assert.match(r.text, /v123/);
  assert.equal(log.find((l) => l[0] === "startVideo")[2].scenes, 2);
  assert.equal((await run("venus.make_video", { chat: "c1", title: "T" })).isError, true);
});

test("rpc: an image result is sent as image content; other media types are dropped", async () => {
  const mk = (image) => ({ info: { name: "t", version: "1" }, listTools: async () => [], callTool: async () => ({ text: "hi", isError: false, image }) });
  const call = { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "x", arguments: {} } };
  const ok = await handleRpc(call, mk({ mediaType: "image/png", data: "QUJD" }));
  assert.deepEqual(ok.result.content[1], { type: "image", data: "QUJD", mimeType: "image/png" });
  const bad = await handleRpc(call, mk({ mediaType: "image/svg+xml", data: "x" }));
  assert.equal(bad.result.content.length, 1);
});

test("group chat: read shows members, pins, notes, status and messages", async () => {
  const r = await run("group.read", { chat: "c1" }, false);
  assert.equal(r.isError, false);
  for (const t of [/chief: Chief/, /working: scraping/, /launch 5 Dec/, /likes short/, /Owner: find leads/]) assert.match(r.text, t);
});

test("group chat: post as a member strips control lines, saves notes and pins, refuses secrets and strangers", async () => {
  const log = [];
  const ok = await run("group.post", { chat: "c1", member: "Hunter", text: "Found 12 clinics.\nNOTE: owner wants Pune only\nPIN: budget is 5k\nHANDOFF: chief | summarise this", note: "likes csv", kind: "result", to: ["chief", "nobody"] }, true, log);
  assert.equal(ok.isError, false); assert.match(ok.text, /HANDOFF/);
  const post = log.find((l) => l[0] === "groupPost")[2];
  assert.deepEqual(post, { from: "hunter", text: "Found 12 clinics.", kind: "result", to: ["chief"] });
  const save = log.find((l) => l[0] === "groupSave");
  assert.deepEqual(save.slice(2), ["hunter", ["likes csv", "owner wants Pune only"], ["budget is 5k"]]);
  assert.equal((await run("group.post", { chat: "c1", member: "ghost", text: "hi" })).isError, true);
  assert.equal((await run("group.post", { chat: "c1", member: "chief", text: "my key is sk-abcdefghijklmnop1234" })).isError, true);
  assert.equal((await run("group.post", { chat: "c1", member: "chief", text: "" })).isError, true);
  const own = await run("group.post", { chat: "c1", member: "you", text: "@everyone hello" }, true, log);
  assert.equal(own.isError, false);
  assert.equal(log.filter((l) => l[0] === "groupPost").pop()[2].from, "you");
});

test("group chat: working status set and cleared; writes need Actions ON", async () => {
  const log = [];
  await run("group.working", { chat: "c1", member: "hunter", text: "scraping" }, true, log);
  await run("group.working", { chat: "c1", member: "hunter", text: "" }, true, log);
  const w = log.filter((l) => l[0] === "groupWorking");
  assert.deepEqual([w[0][3], w[1][3]], ["scraping", null]);
  assert.equal((await run("group.post", { chat: "c1", member: "chief", text: "hi" }, false)).text, WRITE_OFF);
  assert.equal((await run("group.working", { chat: "c1", member: "chief" }, false)).text, WRITE_OFF);
});
