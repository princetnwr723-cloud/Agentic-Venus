import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_COMPACT, buildHead, compactMessages, dedupeToolResults, digest, findSplit, normalizeRoles, pruneToolResults,
  repairToolPairs, totalTokens, triggerAt,
} from "../../lib/agent/compaction.ts";

const t = (role, text) => ({ role, content: [{ type: "text", text }] });
const call = (id, name = "web.read") => ({ role: "assistant", content: [{ type: "tool_use", id, name, input: { u: id } }] });
const res = (id, content) => ({ role: "user", content: [{ type: "tool_result", toolUseId: id, content }] });
const small = { ...DEFAULT_COMPACT, windowTokens: 2000, tailTokens: 400, pruneChars: 1000, pruneKeep: 400 };

function history(n, size = 1500) {
  const m = [buildHead("TASK: research X", "")];
  for (let i = 0; i < n; i++) { m.push(call(`t${i}`)); m.push(res(`t${i}`, `result ${i} ` + "data ".repeat(size / 5))); }
  return m;
}
const pairsOk = (msgs) => {
  const uses = new Set(), results = new Set();
  for (const m of msgs) for (const b of m.content) { if (b.type === "tool_use") uses.add(b.id); if (b.type === "tool_result") results.add(b.toolUseId); }
  return [...uses].every((u) => results.has(u)) && [...results].every((r) => uses.has(r));
};
const alternates = (msgs) => msgs.every((m, i) => i === 0 || m.role !== msgs[i - 1].role) && msgs[0].role === "user";

test("trigger is 75% of the window but never above the cap", () => {
  assert.equal(triggerAt({ ...DEFAULT_COMPACT, windowTokens: 200_000 }), 150_000);
  assert.equal(triggerAt({ ...DEFAULT_COMPACT, windowTokens: 1_000_000 }), 150_000);
  assert.equal(triggerAt({ ...DEFAULT_COMPACT, windowTokens: 8000 }), 6000);
});

test("old big tool outputs are pruned, the protected tail is not", () => {
  const h = history(6);
  const out = pruneToolResults(h, 9, small);
  assert.match(out[2].content[0].content, /characters cut/);
  assert.ok(out[2].content[0].content.length < 600);
  assert.equal(out[12].content[0].content, h[12].content[0].content);
});

test("identical outputs are collapsed, the later one stays whole", () => {
  const body = "same output ".repeat(40);
  const out = dedupeToolResults([buildHead("t", ""), call("a"), res("a", body), call("b"), res("b", body)]);
  assert.match(out[2].content[0].content, /same output as the later call b/);
  assert.equal(out[4].content[0].content, body);
});

test("the split never starts on a tool result", () => {
  const h = history(8, 400);
  for (const tail of [100, 300, 900]) {
    const s = findSplit(h, tail);
    assert.ok(s >= 1 && s <= h.length);
    if (s < h.length) assert.ok(!(h[s].role === "user" && h[s].content.every((b) => b.type === "tool_result")));
  }
});

test("compaction summarises the middle, keeps task and tail, and stays valid", async () => {
  const h = history(14);
  assert.ok(totalTokens(h) > triggerAt(small));
  let seen = "";
  const r = await compactMessages("TASK: research X", "", h, async (tr, prev) => { seen = tr; return "GOAL x. DONE: read 1-10 at https://a.example. OPEN: finish."; }, small);
  assert.ok(r.summarised);
  assert.ok(r.after < r.before / 2);
  assert.match(r.messages[0].content[0].text, /TASK: research X/);
  assert.match(r.messages[0].content[0].text, /CHECKPOINT/);
  assert.match(r.messages[0].content[0].text, /https:\/\/a\.example/);
  assert.ok(pairsOk(r.messages));
  assert.ok(alternates(r.messages));
  assert.match(seen, /CALL web.read/);
  const last = h[h.length - 1];
  assert.deepEqual(r.messages[r.messages.length - 1], last);
  assert.equal(r.summary, "GOAL x. DONE: read 1-10 at https://a.example. OPEN: finish.");
});

test("a second compaction passes the previous summary along", async () => {
  const h = history(14);
  const first = await compactMessages("T", "", h, async () => "S1", small);
  const grown = [...first.messages];
  for (let i = 0; i < 12; i++) { grown.push(call(`n${i}`)); grown.push(res(`n${i}`, "more ".repeat(300))); }
  let prevSeen = "";
  const second = await compactMessages("T", first.summary, grown, async (_t, prev) => { prevSeen = prev; return "S2"; }, small, true);
  assert.equal(prevSeen, "S1");
  assert.equal(second.summary, "S2");
  assert.ok(pairsOk(second.messages));
});

test("when the summariser fails a digest is used, nothing is lost silently", async () => {
  const h = history(14);
  const r = await compactMessages("T", "", h, async () => { throw new Error("model down"); }, small);
  assert.ok(r.summarised);
  assert.match(r.summary, /called web.read/);
});

test("below the trigger nothing is summarised", async () => {
  const h = history(2, 200);
  const r = await compactMessages("T", "", h, async () => { throw new Error("must not be called"); }, small);
  assert.equal(r.summarised, false);
  assert.equal(r.messages.length, h.length);
});

test("force shrinks even below the trigger", async () => {
  const h = history(6, 900);
  const r = await compactMessages("T", "", h, async () => "S", { ...small, windowTokens: 100_000 }, true);
  assert.ok(r.summarised);
  assert.ok(r.after < r.before);
});

test("repairToolPairs adds missing results and drops orphans", () => {
  const msgs = [t("user", "go"), call("a"), t("user", "no result here"), res("ghost", "orphan"), call("b"), res("b", "ok")];
  const fixed = repairToolPairs(msgs);
  assert.ok(pairsOk(fixed));
  assert.ok(alternates(fixed));
  const a = fixed.flatMap((m) => m.content).find((b) => b.type === "tool_result" && b.toolUseId === "a");
  assert.match(a.content, /lost/);
  assert.ok(!fixed.flatMap((m) => m.content).some((b) => b.type === "tool_result" && b.toolUseId === "ghost"));
});

test("normalizeRoles merges neighbours and drops empties", () => {
  const out = normalizeRoles([t("user", "a"), t("user", "b"), t("assistant", " "), t("assistant", "c")]);
  assert.equal(out.length, 2);
  assert.equal(out[0].content.length, 2);
});

test("digest lists calls and results", () => {
  const d = digest([call("x", "github.read"), res("x", "file contents here")]);
  assert.match(d, /called github.read/);
  assert.match(d, /file contents here/);
});
