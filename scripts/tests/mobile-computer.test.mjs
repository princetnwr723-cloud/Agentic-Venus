// The phone computer (Android app): everything that can be tested without a phone.
//  - the screen's helper functions
//  - the Java logic (RAM/storage plan, Alpine list, unpacking, process memory, the local HTTP client) on a normal Java, against the real guest agent
//  - the scripts that run inside the computer
//  - the Android project preparation (run twice: must not add things twice)
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { sizeText, ramNote, pct, usable, isSettingUp, stateTitle } from "../../lib/native-computer-core.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const has = (cmd, args = ["--version"]) => spawnSync(cmd, args, { encoding: "utf8" }).status === 0;

const plan = { ramRecommendedMB: 3072, ramMinMB: 1024, ramMaxMB: 4528, diskRecommendedGB: 10, diskMinGB: 4, diskMaxGB: 50, ramOptionsMB: [1024, 2048, 3072, 4096], diskOptionsGB: [4, 10, 20] };

test("sizes read well", () => {
  assert.equal(sizeText(512), "512 MB");
  assert.equal(sizeText(3072), "3 GB");
  assert.equal(sizeText(1536), "1.5 GB");
  assert.equal(sizeText(-1), "-");
  assert.equal(sizeText(NaN), "-");
});

test("the RAM note tells the truth about the pick", () => {
  const s = { plan, phoneRamMB: 7600 };
  assert.equal(ramNote(s, 3072).kind, "ok");
  assert.equal(ramNote(s, 2048).kind, "warn");
  assert.match(ramNote(s, 2048).text, /Chrome may close/);
  assert.equal(ramNote(s, 4096).kind, "warn");
  assert.equal(ramNote(s, 4528).kind, "bad");
  assert.match(ramNote(s, 4096).text, /local model/);
});

test("bars, states and when the website may use the phone computer", () => {
  assert.equal(pct(1536, 3072), 50);
  assert.equal(pct(9999, 3072), 100);
  assert.equal(pct(5, 0), 0);
  assert.equal(pct(-5, 100), 0);
  assert.equal(isSettingUp("downloading") && isSettingUp("installing") && isSettingUp("unpacking"), true);
  assert.equal(isSettingUp("ready") || isSettingUp("running"), false);
  assert.match(stateTitle("ready"), /uses no RAM/);
  assert.equal(usable({ supported: true, installed: true, enabled: true }), true);
  assert.equal(usable({ supported: true, installed: false, enabled: true }), false);
  assert.equal(usable({ supported: true, installed: true, enabled: false }), false);
  assert.equal(usable({ supported: false, installed: true, enabled: true }), false);
});

test("Java logic: RAM plan, Alpine list, unpacking, process memory, local HTTP client, real guest agent", { skip: !has("python3") || !has("java", ["-version"]) }, () => {
  const work = mkdtempSync(join(tmpdir(), "venus-java-"));
  const classes = join(work, "classes");
  mkdirSync(classes);
  const fx = spawnSync("python3", [join(root, "scripts/tests/java/make-fixtures.py"), join(work, "fixtures")], { encoding: "utf8" });
  assert.equal(fx.status, 0, fx.stderr);
  const src = [join(root, "mobile/native/android/VenusLocalLogic.java"), join(root, "scripts/tests/java/VenusLocalLogicTest.java")];
  // `javac` when there is one; a JRE-only machine can still compile through the compiler module
  const c = has("javac", ["-version"])
    ? spawnSync("javac", ["-d", classes, ...src], { encoding: "utf8" })
    : spawnSync("java", ["-m", "jdk.compiler/com.sun.tools.javac.Main", "-d", classes, ...src], { encoding: "utf8" });
  if (c.status !== 0 && /module jdk.compiler not found|Module jdk.compiler/i.test(c.stderr)) return; // no compiler on this machine
  assert.equal(c.status, 0, c.stderr);
  mkdirSync(join(work, "out"));
  const r = spawnSync("java", ["-Dfile.encoding=UTF-8", "-cp", classes, "com.agenticvenus.app.VenusLocalLogicTest", join(work, "fixtures"), join(work, "out"), join(root, "desktop/vm-agent/venus-agent.py")],
    { encoding: "utf8", timeout: 90_000, env: { ...process.env, LC_ALL: "C.UTF-8", LANG: "C.UTF-8" } });
  assert.match(r.stdout, /ALL OK/, r.stdout + r.stderr);
});

test("scripts inside the computer: valid, and the sudo and apt-get stand-ins behave", { skip: !has("bash") }, () => {
  const guest = join(root, "mobile/native/guest");
  assert.equal(spawnSync("bash", ["-n", join(guest, "venus-boot.sh")]).status, 0);
  assert.equal(spawnSync("sh", ["-n", join(guest, "venus-setup.sh")]).status, 0);
  const setup = readFileSync(join(guest, "venus-setup.sh"), "utf8");
  const part = (name) => {
    const a = setup.indexOf(`cat > /usr/local/bin/${name} <<'WRAP'\n`) + `cat > /usr/local/bin/${name} <<'WRAP'\n`.length;
    return setup.slice(a, setup.indexOf("\nWRAP", a) + 1);
  };
  const dir = mkdtempSync(join(tmpdir(), "venus-shim-"));
  writeFileSync(join(dir, "sudo"), part("sudo"), { mode: 0o755 });
  writeFileSync(join(dir, "apt-get"), part("apt-get"), { mode: 0o755 });
  const sudo = spawnSync(join(dir, "sudo"), ["-n", "-u", "user", "-H", "sh", "-c", "echo inner-ok"], { encoding: "utf8" });
  assert.equal(sudo.stdout.trim(), "inner-ok");
  const keep = spawnSync(join(dir, "sudo"), ["FOO=bar", "sh", "-c", "echo $FOO"], { encoding: "utf8" });
  assert.equal(keep.stdout.trim(), "bar");
  // apt-get: "update" does nothing, "install ffmpeg" is skipped (huge, only for a screen-recording proof), and neither fails
  assert.equal(spawnSync(join(dir, "apt-get"), ["-o", "DPkg::Lock::Timeout=600", "update", "-y"]).status, 0);
  assert.equal(spawnSync(join(dir, "apt-get"), ["install", "-y", "ffmpeg"]).status, 0);
  // everything the computer needs is in the package list: Chrome, a terminal, Node (the website's runner), Python (the agent), xdotool and scrot
  for (const p of ["chromium", "xterm", "nodejs", "npm", "python3", "xdotool", "scrot", "xvfb"]) assert.match(setup, new RegExp(`\\b${p}\\b`), p);
  assert.doesNotMatch(setup, /\b(firefox|thunar|xfce4|libreoffice|vlc|gimp)\b[^\n]*apk add|apk add[^\n]*\b(firefox|thunar|libreoffice|vlc|gimp)\b/, "no extra apps");
  // the agent only listens on this phone
  assert.match(readFileSync(join(guest, "venus-boot.sh"), "utf8"), /VENUS_AGENT_BIND=127\.0\.0\.1/);
});

test("the Android project is prepared once, also when the script runs twice", () => {
  const tmp = mkdtempSync(join(tmpdir(), "venus-prep-"));
  mkdirSync(join(tmp, "mobile"));
  for (const f of ["scripts", "native"]) cpSync(join(root, "mobile", f), join(tmp, "mobile", f), { recursive: true });
  mkdirSync(join(tmp, "desktop/vm-agent"), { recursive: true });
  cpSync(join(root, "desktop/vm-agent/venus-agent.py"), join(tmp, "desktop/vm-agent/venus-agent.py"));
  const app = join(tmp, "mobile/android/app");
  mkdirSync(join(app, "src/main"), { recursive: true });
  writeFileSync(join(app, "src/main/AndroidManifest.xml"), '<manifest xmlns:android="http://schemas.android.com/apk/res/android">\n    <application>\n        <activity android:name=".MainActivity">\n        </activity>\n    </application>\n</manifest>\n');
  writeFileSync(join(app, "build.gradle"), "apply plugin: 'com.android.application'\n\nandroid {\n    namespace = \"com.agenticvenus.app\"\n}\n");
  for (let i = 0; i < 2; i++) {
    const r = spawnSync("node", ["scripts/prepare-android.mjs"], { cwd: join(tmp, "mobile"), encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
  }
  const xml = readFileSync(join(app, "src/main/AndroidManifest.xml"), "utf8");
  assert.equal((xml.match(/VenusLocalService/g) || []).length, 1);
  assert.equal((xml.match(/ACCESS_NETWORK_STATE/g) || []).length, 1);
  const gradle = readFileSync(join(app, "build.gradle"), "utf8");
  assert.equal((gradle.match(/useLegacyPackaging/g) || []).length, 1);
  for (const f of ["venus-agent.py", "venus-boot.sh", "venus-setup.sh"]) assert.ok(existsSync(join(app, "src/main/assets/venus", f)), f);
  assert.match(readFileSync(join(app, "src/main/java/com/agenticvenus/app/MainActivity.java"), "utf8"), /registerPlugin\(VenusLocalPlugin\.class\)/);
  for (const f of ["VenusLocalComputer", "VenusLocalLogic", "VenusLocalPlugin", "VenusLocalRelay", "VenusLocalService"]) assert.ok(existsSync(join(app, "src/main/java/com/agenticvenus/app", f + ".java")), f);
});
