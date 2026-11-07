// Desktop app pieces that can be tested without Electron or a virtual machine.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pickAsset, sumFor } from "../../desktop/cli/agenticvenus.mjs";

const require = createRequire(import.meta.url);
const Q = require("../../desktop/lib/qemu-args.js");
const { parseSums } = require("../../desktop/lib/vm.js");
const { userData } = require("../../desktop/lib/cloud-init.js");
const { checkJob } = require("../../desktop/lib/relay-client.js");

const good = { platform: "linux", arch: "x64", totalMemMB: 16384, cpus: 8, freeDiskGB: 100 };

test("a good PC passes and gets a sensible VM size", () => {
  const r = Q.checkHost(good);
  assert.equal(r.ok, true);
  assert.deepEqual(r.vm, { memMB: 6144, cpus: 4, diskGB: 15 });
  assert.deepEqual(Q.checkHost({ ...good, totalMemMB: 8192, cpus: 4 }).vm, { memMB: 3072, cpus: 2, diskGB: 15 });
});

test("a weak or unsupported PC is told exactly what is wrong", () => {
  assert.equal(Q.checkHost({ ...good, totalMemMB: 4096 }).ok, false);
  assert.equal(Q.checkHost({ ...good, cpus: 2 }).ok, false);
  assert.equal(Q.checkHost({ ...good, freeDiskGB: 5 }).ok, false);
  assert.equal(Q.checkHost({ ...good, platform: "win32", arch: "arm64" }).ok, false);
  assert.equal(Q.checkHost({ ...good, arch: "ia32" }).ok, false);
  assert.equal(Q.checkHost({ ...good, platform: "freebsd" }).ok, false);
});

test("qemu arguments: right accelerator, one loopback-only port, secret-free", () => {
  const base = { memMB: 3072, cpus: 2, diskPath: "/d/disk.qcow2", agentPort: 41000, seedPort: 41001 };
  const lin = Q.buildQemuArgs({ ...base, platform: "linux", arch: "x64" }).join(" ");
  assert.match(lin, /-accel kvm/);
  assert.match(lin, /hostfwd=tcp:127\.0\.0\.1:41000-:7077/);
  assert.match(lin, /s=http:\/\/10\.0\.2\.2:41001\//);
  assert.match(lin, /-display gtk/);
  assert.match(Q.buildQemuArgs({ ...base, platform: "win32", arch: "x64" }).join(" "), /-accel whpx/);
  const mac = Q.buildQemuArgs({ ...base, platform: "darwin", arch: "arm64", firmware: "/f.fd" }).join(" ");
  assert.match(mac, /-accel hvf/); assert.match(mac, /-display cocoa/); assert.match(mac, /-bios \/f\.fd/);
  assert.throws(() => Q.buildQemuArgs({ ...base, platform: "darwin", arch: "arm64" }), /firmware/i);
  assert.match(Q.buildQemuArgs({ ...base, platform: "linux", arch: "x64", headless: true }).join(" "), /-display none/);
  assert.doesNotMatch(lin, /0\.0\.0\.0/);
  assert.equal(Q.qemuBinary("arm64"), "qemu-system-aarch64");
});

test("first-boot config installs the agent with the key and nothing else secret", () => {
  const ud = userData({ agentKey: "k".repeat(64), agentScript: "print('hi')", arch: "x64" });
  assert.match(ud, /^#cloud-config/);
  assert.match(ud, /name: user/);
  assert.match(ud, /venus-agent\.service/);
  assert.match(ud, /\/var\/lib\/venus-ready/);
  assert.match(ud, new RegExp(Buffer.from("print('hi')").toString("base64")));
  assert.match(userData({ agentKey: "k".repeat(64), agentScript: "x", arch: "arm64" }), /chromium/);
});

test("image checksum list is parsed exactly", () => {
  const h = "a".repeat(64);
  assert.equal(parseSums(`${h} *noble-server-cloudimg-amd64.img\n${"b".repeat(64)} *other.img`, "noble-server-cloudimg-amd64.img"), h);
  assert.equal(parseSums(`${h} *x.img`, "noble-server-cloudimg-amd64.img"), null);
});

test("the app refuses jobs that are not on its short list", () => {
  assert.equal(checkJob({ id: "a", op: "exec", args: { cmd: "ls" } }), null);
  assert.ok(checkJob({ id: "a", op: "rm", args: {} }));
  assert.ok(checkJob({ id: "a", op: "exec", args: { cmd: "" } }));
  assert.ok(checkJob({ id: "a", op: "input", args: { type: "shell" } }));
  assert.ok(checkJob({ id: "a", op: "vm", args: { action: "format" } }));
  assert.ok(checkJob(null));
});

test("install command picks the right installer and checksum", () => {
  const assets = ["AgenticVenus-0.1.0-win-x64.exe", "AgenticVenus-0.1.0-mac-arm64.dmg", "AgenticVenus-0.1.0-mac-x64.dmg", "AgenticVenus-0.1.0-linux-x64.AppImage", "SHA256SUMS.txt"].map((name) => ({ name }));
  assert.equal(pickAsset(assets, "win32", "x64").name, "AgenticVenus-0.1.0-win-x64.exe");
  assert.equal(pickAsset(assets, "darwin", "arm64").name, "AgenticVenus-0.1.0-mac-arm64.dmg");
  assert.equal(pickAsset(assets, "linux", "x64").name, "AgenticVenus-0.1.0-linux-x64.AppImage");
  assert.equal(pickAsset(assets, "linux", "arm64"), null);
  assert.equal(pickAsset(assets, "freebsd", "x64"), null);
  const h = "c".repeat(64);
  assert.equal(sumFor(`${h}  AgenticVenus-0.1.0-win-x64.exe`, "AgenticVenus-0.1.0-win-x64.exe"), h);
  assert.equal(sumFor(`${h}  other`, "AgenticVenus-0.1.0-win-x64.exe"), null);
});

// ---- the guest agent, run for real (commands only: no screen needed) ----
const py = spawnSync("python3", ["--version"]);
test("guest agent: needs the key, runs commands, times out, survives bad input", { skip: py.status !== 0 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "agent-"));
  const keyFile = join(dir, "key");
  const key = "z".repeat(64);
  writeFileSync(keyFile, key);
  const port = 47000 + Math.floor(Math.random() * 1000);
  const p = spawn("python3", [new URL("../../desktop/vm-agent/venus-agent.py", import.meta.url).pathname], {
    env: { ...process.env, VENUS_AGENT_PORT: String(port), VENUS_AGENT_KEYFILE: keyFile, VENUS_AGENT_NOSUDO: "1", VENUS_AGENT_READY: join(dir, "ready") },
    stdio: "ignore",
  });
  try {
    const call = async (method, path, body, k = key) => {
      const r = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers: { "X-Venus-Key": k, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
      return { status: r.status, json: await r.json() };
    };
    for (let i = 0; i < 40; i++) { try { await call("GET", "/health"); break; } catch { await new Promise((r) => setTimeout(r, 100)); } }
    assert.equal((await call("GET", "/health", null, "wrong")).status, 401, "wrong key is rejected");
    assert.equal((await call("POST", "/exec", { cmd: "echo hi" }, "")).status, 401, "no key is rejected");
    const ok = await call("POST", "/exec", { cmd: "echo hi; echo err 1>&2; exit 3" });
    assert.deepEqual([ok.json.stdout.trim(), ok.json.stderr.trim(), ok.json.exitCode], ["hi", "err", 3]);
    const slow = await call("POST", "/exec", { cmd: "sleep 5", timeoutMs: 1000 });
    assert.equal(slow.json.exitCode, 124);
    assert.equal((await call("GET", "/health")).json.ready, false);
    writeFileSync(join(dir, "ready"), "");
    assert.equal((await call("GET", "/health")).json.ready, true);
    assert.equal((await call("POST", "/nope", {})).status, 404);
    assert.equal((await call("POST", "/input", { type: "bogus" })).json.exitCode, 2);
  } finally { p.kill(); }
});