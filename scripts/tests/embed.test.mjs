import test from "node:test";
import assert from "node:assert/strict";
import { cosine, fuse, textKey, requestFor, parseVectors, embedBatch } from "../../lib/embed.ts";

test("cosine: same direction 1, orthogonal 0, empty 0", () => {
  assert.ok(Math.abs(cosine([1, 2, 3], [2, 4, 6]) - 1) < 1e-9);
  assert.equal(cosine([1, 0], [0, 1]), 0);
  assert.equal(cosine([], [1]), 0);
  assert.equal(cosine([0, 0], [1, 1]), 0);
});

test("fuse lets meaning lift a document that shares no keyword, and keeps keyword-only docs", () => {
  const hits = [{ doc: "a", score: 0.9 }, { doc: "b", score: 0.1 }, { doc: "c", score: 0.5 }];
  const vec = { a: [0, 1], b: [1, 0], c: undefined };
  const out = fuse(hits, [1, 0], (d) => vec[d], 0.7);
  assert.equal(out[0].doc, "b", "b is closest in meaning");
  assert.ok(out.find((x) => x.doc === "c").score === 0.5, "no vector: keyword score only");
  assert.equal(fuse(hits, [1, 0], (d) => vec[d], 0, 2).length, 2);
  assert.equal(fuse(hits, [1, 0], (d) => vec[d], 0)[0].doc, "a", "alpha 0 = keywords only");
});

test("text keys are stable and differ", () => {
  assert.equal(textKey("hello"), textKey("hello"));
  assert.notEqual(textKey("hello"), textKey("hellp"));
});

test("requests are built for both providers (key in header, never in the URL)", () => {
  const o = requestFor("openai", "sk-x", ["a", "b"]);
  assert.match(o.url, /openai\.com\/v1\/embeddings/); assert.equal(JSON.parse(o.init.body).input.length, 2); assert.ok(!o.url.includes("sk-x"));
  const g = requestFor("gemini", "AIza-x", ["a"]);
  assert.ok(!g.url.includes("AIza-x")); assert.equal(g.init.headers["x-goog-api-key"], "AIza-x");
});

test("vectors are parsed in order and refused when the count or values are wrong", () => {
  assert.deepEqual(parseVectors("openai", { data: [{ index: 1, embedding: [2] }, { index: 0, embedding: [1] }] }, 2), [[1], [2]]);
  assert.equal(parseVectors("openai", { data: [{ embedding: [1] }] }, 2), null);
  assert.equal(parseVectors("gemini", { embeddings: [{ values: [1, NaN] }] }, 1), null);
  assert.deepEqual(parseVectors("gemini", { embeddings: [{ values: [3, 4] }] }, 1), [[3, 4]]);
  assert.equal(parseVectors("openai", null, 1), null);
});

test("embedBatch returns null on any failure and never throws", async () => {
  const ok = async () => ({ ok: true, status: 200, json: async () => ({ data: [{ index: 0, embedding: [1, 2] }] }) });
  assert.deepEqual(await embedBatch(ok, "openai", "k", ["x"]), [[1, 2]]);
  assert.equal(await embedBatch(async () => ({ ok: false, status: 401, json: async () => ({}) }), "openai", "k", ["x"]), null);
  assert.equal(await embedBatch(async () => { throw new Error("net"); }, "openai", "k", ["x"]), null);
  assert.equal(await embedBatch(ok, "openai", "", ["x"]), null);
  assert.equal(await embedBatch(ok, "openai", "k", []), null);
  assert.equal(await embedBatch(ok, "openai", "k", Array(65).fill("x")), null);
});
