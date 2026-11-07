"use strict";
// Runs the user's own Linux computer with QEMU. Everything lives in the app's data folder; nothing touches the PC's files.
const { spawn, spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const net = require("net");
const http = require("http");
const crypto = require("crypto");
const { pipeline } = require("stream/promises");
const { Readable } = require("stream");
const { buildQemuArgs, qemuBinary, sizeVm, GUEST_PORT } = require("./qemu-args");
const { userData, serveSeed } = require("./cloud-init");

const IMG_BASE = "https://cloud-images.ubuntu.com/noble/current/";
const imageName = (arch) => `noble-server-cloudimg-${arch === "arm64" ? "arm64" : "amd64"}.img`;

/** Finds the hash of one file in an Ubuntu SHA256SUMS list. */
function parseSums(text, name) {
  for (const line of String(text).split(/\r?\n/)) {
    const m = /^([a-f0-9]{64})\s+\*?(.+)$/.exec(line.trim());
    if (m && m[2] === name) return m[1];
  }
  return null;
}

const FIRMWARE = [
  "/opt/homebrew/share/qemu/edk2-aarch64-code.fd", "/usr/local/share/qemu/edk2-aarch64-code.fd",
  "/usr/share/AAVMF/AAVMF_CODE.fd", "/usr/share/qemu-efi-aarch64/QEMU_EFI.fd",
];
const findFirmware = () => FIRMWARE.find((p) => fs.existsSync(p));

const freePort = () => new Promise((res, rej) => {
  const s = net.createServer();
  s.once("error", rej);
  s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => res(p)); });
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Vm {
  constructor(dataDir, agentScript, onStatus) {
    this.dir = path.join(dataDir, "computer");
    fs.mkdirSync(this.dir, { recursive: true });
    this.agentScript = agentScript;
    this.onStatus = onStatus || (() => {});
    this.proc = null;
    this.state = "stopped"; // downloading | setting-up | starting | running | stopped | error
    this.detail = "";
    this.meta = this._readMeta();
  }
  _p = (n) => path.join(this.dir, n);
  _readMeta() { try { return JSON.parse(fs.readFileSync(this._p("vm.json"), "utf8")); } catch { return {}; } }
  _saveMeta() { fs.writeFileSync(this._p("vm.json"), JSON.stringify(this.meta), { mode: 0o600 }); }
  _set(state, detail = "") { this.state = state; this.detail = detail; this.onStatus({ state, detail }); }
  get isSetUp() { return Boolean(this.meta.setupDone); }
  get isRunning() { return this.state === "running"; }

  async ensureImage(arch) {
    const name = imageName(arch);
    const file = this._p(name);
    if (fs.existsSync(file) && this.meta.imageOk === name) return file;
    this._set("downloading", "Checking the Linux image…");
    const sums = await (await fetch(IMG_BASE + "SHA256SUMS")).text();
    const want = parseSums(sums, name);
    if (!want) throw new Error("Could not find the image checksum.");
    const res = await fetch(IMG_BASE + name);
    if (!res.ok || !res.body) throw new Error("Image download failed (" + res.status + ").");
    const total = Number(res.headers.get("content-length")) || 0;
    let got = 0;
    const hash = crypto.createHash("sha256");
    const src = Readable.fromWeb(res.body);
    src.on("data", (c) => { got += c.length; hash.update(c); if (total) this._set("downloading", `Downloading Linux image… ${Math.round((got / total) * 100)}%`); });
    await pipeline(src, fs.createWriteStream(file + ".part"));
    if (hash.digest("hex") !== want) { fs.rmSync(file + ".part", { force: true }); throw new Error("The downloaded image did not match its checksum. Try again."); }
    fs.renameSync(file + ".part", file);
    this.meta.imageOk = name; this._saveMeta();
    return file;
  }

  _disk() { return this._p("disk.qcow2"); }
  ensureDisk(baseImage, gb) {
    if (fs.existsSync(this._disk())) return;
    const r = spawnSync("qemu-img", ["create", "-f", "qcow2", "-F", "qcow2", "-b", baseImage, this._disk(), gb + "G"], { encoding: "utf8" });
    // a cloud image is "qcow2"; if qemu-img says otherwise, retry without declaring the backing format
    if (r.status !== 0) throw new Error("Could not create the computer's disk: " + (r.stderr || r.stdout).slice(-300));
  }

  async start({ info, headless = false }) {
    if (this.proc) return;
    try {
      const arch = info.arch;
      const size = sizeVm(info);
      const base = await this.ensureImage(arch);
      this.ensureDisk(base, size.diskGB);
      if (!this.meta.agentKey) { this.meta.agentKey = crypto.randomBytes(32).toString("hex"); this._saveMeta(); }
      this.agentPort = await freePort();
      const firstBoot = !this.meta.setupDone;
      let seed = null;
      if (firstBoot) seed = await serveSeed(userData({ agentKey: this.meta.agentKey, agentScript: this.agentScript, arch }));
      const args = buildQemuArgs({
        platform: info.platform, arch, memMB: size.memMB, cpus: size.cpus, diskPath: this._disk(), agentPort: this.agentPort,
        seedPort: seed ? seed.port : 0, firmware: arch === "arm64" ? findFirmware() : undefined, headless,
      });
      this._set(firstBoot ? "setting-up" : "starting", firstBoot ? "First start: installing the computer (about 10 minutes, once)…" : "Starting your computer…");
      const proc = spawn(qemuBinary(arch), args, { stdio: "ignore" });
      this.proc = proc;
      proc.on("exit", () => { this.proc = null; if (this.state !== "error") this._set("stopped", ""); if (seed) seed.close(); });
      proc.on("error", (e) => { this.proc = null; this._set("error", "QEMU could not start: " + e.message); });
      const started = Date.now();
      const limit = firstBoot ? 40 * 60_000 : 5 * 60_000;
      for (;;) {
        if (!this.proc) throw new Error(this.detail || "The computer stopped while starting.");
        const h = await this.agent("GET", "/health", null, 3000).catch(() => null);
        if (h && h.ready) break;
        if (Date.now() - started > limit) throw new Error("The computer did not become ready in time.");
        if (firstBoot) this._set("setting-up", `First start: installing the computer… ${Math.round((Date.now() - started) / 60000)} min`);
        await sleep(4000);
      }
      if (firstBoot) { this.meta.setupDone = true; this._saveMeta(); if (seed) seed.close(); }
      this._set("running", "Your computer is ready.");
    } catch (e) {
      this._set("error", e instanceof Error ? e.message : String(e));
      await this.stop().catch(() => {});
      throw e;
    }
  }

  /** Talks to the guest agent through the one forwarded port on 127.0.0.1. */
  agent(method, pathname, body, timeoutMs = 60_000) {
    return new Promise((resolve, reject) => {
      if (!this.agentPort) return reject(new Error("The computer is not running."));
      const data = body ? Buffer.from(JSON.stringify(body)) : null;
      const req = http.request({
        host: "127.0.0.1", port: this.agentPort, path: pathname, method, timeout: timeoutMs,
        headers: { "X-Venus-Key": this.meta.agentKey, ...(data ? { "Content-Type": "application/json", "Content-Length": data.length } : {}) },
      }, (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          try { const j = JSON.parse(Buffer.concat(chunks).toString("utf8")); res.statusCode === 200 ? resolve(j) : reject(new Error(j.error || "agent error " + res.statusCode)); }
          catch (e) { reject(e); }
        });
      });
      req.on("timeout", () => req.destroy(new Error("The computer did not answer in time.")));
      req.on("error", reject);
      if (data) req.write(data);
      req.end();
    });
  }

  async stop() {
    const p = this.proc;
    if (!p) { if (this.state !== "error") this._set("stopped", ""); return; }
    await this.agent("POST", "/exec", { cmd: "sudo poweroff", timeoutMs: 5000 }, 6000).catch(() => {});
    for (let i = 0; i < 25 && this.proc; i++) await sleep(1000);
    if (this.proc) p.kill();
  }

  /** Deletes the computer's disk (the Linux image stays, so setup is quick). Only runs when the user asks. */
  async reset() {
    await this.stop();
    fs.rmSync(this._disk(), { force: true });
    this.meta.setupDone = false; this._saveMeta();
    this._set("stopped", "");
  }
}

module.exports = { Vm, parseSums, imageName, GUEST_PORT };