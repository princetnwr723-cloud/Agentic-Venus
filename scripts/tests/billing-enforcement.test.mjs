// If someone removes a plan/limit check from a route, this test fails (and so does CI).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = (p) => readFileSync(new URL("../../" + p, import.meta.url), "utf8");

const MUST_CALL = {
  "app/api/chat/route.ts": ["assertTokens", "addTokens"],
  "app/api/chat/stream/route.ts": ["assertTokens", "addTokens"],
  "app/api/venus/ai/route.ts": ["assertTokens", "addTokens"],
  "app/api/venus/studio/route.ts": ["consumeFeature", "addTokens"],
  "app/api/code/ws/route.ts": ["consumeFeature"],
  "app/api/runner/route.ts": ["assertPcAllowed", "openPcJob", "settlePcJob"],
  "lib/pc-start-server.ts": ["assertPcAllowed", "openPcJob"],
  "lib/pc-tick.ts": ["pcExhausted", "settlePcJob"],
};

for (const [file, names] of Object.entries(MUST_CALL)) {
  test(`${file} still enforces the plan`, () => {
    const code = src(file);
    for (const n of names) assert.match(code, new RegExp("\\b" + n + "\\s*\\("), `${file} no longer calls ${n}()`);
  });
}

test("the browser can never choose its own uid or plan", () => {
  const req = src("lib/request.ts");
  assert.match(req, /authFromRequest/, "readBody must verify the user");
  const billing = src("app/api/billing/checkout/route.ts");
  assert.match(billing, /authFromRequest\(req\)/, "checkout must use the verified uid");
});

test("plan state is only written by the server", () => {
  for (const f of ["lib/chats.ts", "lib/keys-context.tsx", "lib/venus.ts", "lib/team.ts"]) {
    assert.doesNotMatch(src(f), /"billing"/, `${f} must not touch billing documents`);
  }
});

test("no protected file has been deleted", async () => {
  const { existsSync } = await import("node:fs");
  const list = readFileSync(new URL("../../.github/protected-paths.txt", import.meta.url), "utf8");
  const files = list.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#") && !l.includes("*"));
  for (const f of files) assert.ok(existsSync(new URL("../../" + f, import.meta.url)), `protected file is missing: ${f}`);
});

test("local computers go through the server relay, never around it", () => {
  const e2b = src("lib/e2b-server.ts");
  assert.match(e2b, /isLocalSandboxId\(sandboxId\)\) return localSandbox/, "connect() must route local ids to the relay");
  const route = src("app/api/local/route.ts");
  assert.match(route, /verifyUser\(req\)/, "the relay route must verify the signed-in user");
  const relay = src("lib/local-relay.ts");
  assert.match(relay, /d\.uid !== uid/, "a device must belong to the caller");
});