"use strict";
// The "hands": asks the server for jobs, runs them in the local computer, posts the answers. It receives no plan or
// payment data, only jobs, and it re-checks every job before running it.
const OPS = new Set(["exec", "screenshot", "input", "vm"]);
const INPUT = new Set(["click", "double_click", "right_click", "type", "key", "scroll"]);
const MAX_CMD = 4_000_000;
const IDLE_STOP_MS = 45 * 60_000;

function checkJob(job) {
  if (!job || typeof job.id !== "string" || !OPS.has(job.op)) return "Unknown job.";
  const a = job.args || {};
  if (job.op === "exec" && (typeof a.cmd !== "string" || !a.cmd.trim() || Buffer.byteLength(a.cmd) > MAX_CMD)) return "Bad command.";
  if (job.op === "input" && !INPUT.has(a.type)) return "Bad input.";
  if (job.op === "vm" && !["start", "stop", "status"].includes(a.action)) return "Bad action.";
  return null;
}

class RelayClient {
  constructor({ appUrl, session, vm, hostInfo, state, onChange }) {
    Object.assign(this, { appUrl, session, vm, hostInfo, state, onChange: onChange || (() => {}) });
    this.stopped = true;
    this.lastJob = Date.now();
    this.errors = 0;
  }
  get deviceId() { return this.state.get().deviceId || null; }
  get localKey() { return this.deviceId ? "venus-local:" + this.deviceId : null; }

  async call(body, timeoutMs = 40_000) {
    const r = await fetch(this.appUrl + "/api/local", {
      method: "POST", signal: AbortSignal.timeout(timeoutMs),
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + (await this.session.idToken()) },
      body: JSON.stringify(body),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || "Server error " + r.status);
    return j;
  }

  async register(name) {
    const j = await this.call({ action: "register", name, platform: process.platform, deviceId: this.deviceId || undefined });
    this.state.set({ deviceId: j.deviceId });
    this.onChange();
    return j.deviceId;
  }

  start() {
    if (!this.stopped) return;
    this.stopped = false;
    void this.loop();
    this.idleTimer = setInterval(() => {
      if (this.vm.isRunning && Date.now() - this.lastJob > IDLE_STOP_MS) void this.vm.stop();
    }, 60_000);
  }
  stop() { this.stopped = true; clearInterval(this.idleTimer); }

  async loop() {
    while (!this.stopped) {
      try {
        const { jobs } = await this.call({ action: "poll", deviceId: this.deviceId });
        this.errors = 0;
        for (const job of jobs || []) void this.run(job);
      } catch (e) {
        this.errors++;
        await new Promise((r) => setTimeout(r, Math.min(30_000, 1500 * this.errors)));
      }
    }
  }

  async run(job) {
    this.lastJob = Date.now();
    let result;
    try {
      const bad = checkJob(job);
      result = bad ? { error: bad } : await this.exec(job);
    } catch (e) {
      result = { error: (e instanceof Error ? e.message : String(e)).slice(0, 400) };
    }
    await this.call({ action: "result", deviceId: this.deviceId, jobId: job.id, result }).catch(() => {});
  }

  async exec(job) {
    const a = job.args;
    if (job.op === "vm") {
      if (a.action === "start") void this.vm.start({ info: this.hostInfo }).catch(() => {});
      if (a.action === "stop") await this.vm.stop();
      return { stdout: this.vm.state, exitCode: 0 };
    }
    if (!this.vm.isRunning) {
      if (this.vm.isSetUp && !this.vm.proc) void this.vm.start({ info: this.hostInfo }).catch(() => {});
      return { error: this.vm.isSetUp ? "Your computer is starting. Try again in about a minute." : "Set up your computer first: open the AgenticVenus desktop app and press 'Set up my computer'." };
    }
    if (job.op === "exec") return this.vm.agent("POST", "/exec", { cmd: a.cmd, timeoutMs: a.timeoutMs }, Math.min(300_000, (a.timeoutMs || 30_000) + 5_000));
    if (job.op === "screenshot") return this.vm.agent("POST", "/screenshot", {}, 25_000);
    return this.vm.agent("POST", "/input", a, 30_000);
  }
}

module.exports = { RelayClient, checkJob };