import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { PC_RUNNER_SOURCE, PC_RUNNER_VERSION } from "../../lib/pc-runner-script.ts";

test("the runner source is plain JavaScript that Node accepts (it is shipped inside a template string)", () => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "runner-")), "pc-runner.mjs");
  fs.writeFileSync(f, PC_RUNNER_SOURCE);
  const r = spawnSync(process.execPath, ["--check", f], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
});

test("the runner source never contains a backtick or a dollar-brace (they would break the template string)", () => {
  assert.ok(!PC_RUNNER_SOURCE.includes("`"));
  assert.ok(!PC_RUNNER_SOURCE.includes("${"));
});

test("version was bumped so running computers pick up the new runner", () => {
  assert.ok(Number(PC_RUNNER_VERSION) >= 11);
});

test("human-like input is present, can be switched off, and always falls back to the plain action", () => {
  assert.match(PC_RUNNER_SOURCE, /VENUS_HUMAN_INPUT !== "0"/);
  assert.match(PC_RUNNER_SOURCE, /async function humanMove/);
  assert.match(PC_RUNNER_SOURCE, /async function humanType/);
  assert.match(PC_RUNNER_SOURCE, /await loc\.fill\(text, \{timeout: 5000\}\)/, "the instant fill is still the fallback");
});

test("a captcha or robot check is named in what the model sees, with the instruction to ask the owner", () => {
  assert.match(PC_RUNNER_SOURCE, /async function detectCaptcha/);
  assert.match(PC_RUNNER_SOURCE, /HUMAN CHECK: this page shows a captcha/);
  assert.match(PC_RUNNER_SOURCE, /Use ask_user to ask the owner/);
  assert.match(PC_RUNNER_SOURCE, /async function snapshotBase/);
});
