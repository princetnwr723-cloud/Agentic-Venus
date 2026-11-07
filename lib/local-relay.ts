// Server-only. Lets the existing computer features (shell, screenshots, clicks, the computer-agent runner) work on a
// Linux virtual machine that runs on the USER'S OWN PC, through the AgenticVenus desktop app.
//
// How it stays safe: the server decides everything (plans, limits, what to run). The desktop app is only "hands":
// it asks for queued jobs with the user's login token and posts the results back. It never receives plan data.
import { randomBytes } from "crypto";
import { getAdminDb } from "@/lib/firebase-admin";
import {
  MAX_PENDING, deviceFromSandboxId, isDeviceId, isExpired, isOnline, normalizeResult, sandboxIdOf, validateJob,
  type JobResult, type RelayOp,
} from "@/lib/local-relay-core";

type Ref = FirebaseFirestore.DocumentReference;
const devices = () => getAdminDb().collection("localDevices");
const dev = (id: string) => devices().doc(id);

type DeviceDoc = { uid: string; name: string; platform: string; createdAt: number; lastSeen: number };

export async function registerDevice(uid: string, name: string, platform: string, existing?: unknown): Promise<string> {
  const now = Date.now();
  const clean = { name: String(name || "My PC").slice(0, 60), platform: String(platform || "").slice(0, 30) };
  if (isDeviceId(existing)) {
    const snap = await dev(existing).get();
    const d = snap.data() as DeviceDoc | undefined;
    if (d && d.uid === uid) { await dev(existing).set({ ...clean, lastSeen: now }, { merge: true }); return existing; }
  }
  const id = randomBytes(16).toString("hex");
  await dev(id).set({ uid, ...clean, createdAt: now, lastSeen: now } satisfies DeviceDoc);
  return id;
}

async function ownDevice(uid: string, deviceId: string): Promise<Ref> {
  if (!isDeviceId(deviceId)) throw new Error("Bad device id.");
  const ref = dev(deviceId);
  const d = (await ref.get()).data() as DeviceDoc | undefined;
  if (!d || d.uid !== uid) throw new Error("This computer does not belong to your account.");
  return ref;
}

export async function touchDevice(uid: string, deviceId: string) {
  const ref = await ownDevice(uid, deviceId);
  await ref.set({ lastSeen: Date.now() }, { merge: true });
}

type Claimed = { id: string; op: RelayOp; args: Record<string, unknown> };
type Row = { d: FirebaseFirestore.QueryDocumentSnapshot; j: { op: RelayOp; args: Record<string, unknown>; createdAt: number } };

/** The desktop app asks: what is waiting for me? Each job is handed out once. */
export async function claimJobs(uid: string, deviceId: string, max = 5): Promise<Claimed[]> {
  const ref = await ownDevice(uid, deviceId);
  const db = getAdminDb();
  return db.runTransaction(async (tx: FirebaseFirestore.Transaction) => {
    const snap = await tx.get(ref.collection("jobs").where("status", "==", "queued").limit(20));
    const now = Date.now();
    const rows = snap.docs
      .map((d: FirebaseFirestore.QueryDocumentSnapshot): Row => ({ d, j: d.data() as Row["j"] }))
      .sort((a: Row, b: Row) => a.j.createdAt - b.j.createdAt);
    const out: Claimed[] = [];
    for (const { d, j } of rows) {
      if (isExpired(j.createdAt, now)) { tx.delete(d.ref); continue; }
      if (out.length >= max) continue;
      tx.update(d.ref, { status: "running", startedAt: now });
      out.push({ id: d.id, op: j.op, args: j.args });
    }
    return out;
  });
}

export async function completeJob(uid: string, deviceId: string, jobId: string, result: unknown) {
  const ref = await ownDevice(uid, deviceId);
  if (!/^[A-Za-z0-9]{10,40}$/.test(jobId)) throw new Error("Bad job id.");
  const jr = ref.collection("jobs").doc(jobId);
  const cur = (await jr.get()).data() as { status?: string } | undefined;
  if (!cur || cur.status !== "running") return;
  await jr.update({ status: "done", result: normalizeResult(result), doneAt: Date.now() });
}

export async function assertDeviceOnline(deviceId: string) {
  const d = (await dev(deviceId).get()).data() as DeviceDoc | undefined;
  if (!d) throw new Error("This computer is not registered. Open the AgenticVenus desktop app and sign in.");
  if (!isOnline(d.lastSeen)) throw new Error("Your PC app is offline. Open the AgenticVenus desktop app on that PC and try again.");
}

/** Queues one job for the desktop app and waits for its answer. */
export async function runOnDevice(deviceId: string, op: RelayOp, rawArgs: unknown, timeoutMs: number): Promise<JobResult> {
  const checked = validateJob(op, rawArgs);
  if (!checked.ok) throw new Error(checked.error);
  await assertDeviceOnline(deviceId);
  const jobs = dev(deviceId).collection("jobs");
  const pending = await jobs.where("status", "in", ["queued", "running"]).limit(MAX_PENDING + 1).get();
  if (pending.size > MAX_PENDING) throw new Error("Too many jobs are waiting for your PC.");
  const ref = jobs.doc(randomBytes(10).toString("hex"));
  await ref.set({ op, args: checked.args, status: "queued", createdAt: Date.now() });
  const deadline = Date.now() + Math.max(2_000, timeoutMs) + 8_000; // a little extra for the round trip
  let wait = 250;
  try {
    for (;;) {
      const d = (await ref.get()).data() as { status?: string; result?: JobResult } | undefined;
      if (d?.status === "done" && d.result) {
        if (d.result.error) throw new Error(d.result.error);
        return d.result;
      }
      if (Date.now() > deadline) throw new Error("Your PC did not answer in time. Is the desktop app open and the computer started?");
      await new Promise((r) => setTimeout(r, wait));
      wait = Math.min(900, wait + 150);
    }
  } finally {
    await ref.delete().catch(() => {});
  }
}

// ---------------- an object that looks like the E2B desktop sandbox the rest of the code already uses ----------------

type RunOpts = { timeoutMs?: number };
class CommandExitError extends Error {
  stdout: string; stderr: string; exitCode: number;
  constructor(r: JobResult) { super(`Command exited with code ${r.exitCode}`); this.stdout = r.stdout; this.stderr = r.stderr; this.exitCode = r.exitCode; }
}

export class LocalSandbox {
  sandboxId: string;
  private deviceId: string;
  constructor(sandboxId: string) { this.sandboxId = sandboxId; this.deviceId = deviceFromSandboxId(sandboxId); }

  commands = {
    run: async (cmd: string, opts?: RunOpts) => {
      const t = opts?.timeoutMs ?? 30_000;
      const r = await runOnDevice(this.deviceId, "exec", { cmd, timeoutMs: t }, t);
      if (r.exitCode !== 0) throw new CommandExitError(r);
      return { stdout: r.stdout, stderr: r.stderr, exitCode: 0 };
    },
  };
  // The live picture of a local computer opens in its own window on the PC, not inside the website.
  stream = {
    start: async () => { throw new Error("A local computer opens in its own window on your PC (the AgenticVenus desktop app)."); },
    stop: async () => {},
    getUrl: () => { throw new Error("A local computer opens in its own window on your PC (the AgenticVenus desktop app)."); },
  };
  private input = (args: Record<string, unknown>) => runOnDevice(this.deviceId, "input", args, 20_000).then(() => {});
  screenshot = async (): Promise<Uint8Array> => {
    const r = await runOnDevice(this.deviceId, "screenshot", {}, 25_000);
    if (!r.data) throw new Error("The local computer returned no picture.");
    return Uint8Array.from(Buffer.from(r.data, "base64"));
  };
  leftClick = (x: number, y: number) => this.input({ type: "click", x, y });
  doubleClick = (x: number, y: number) => this.input({ type: "double_click", x, y });
  rightClick = (x: number, y: number) => this.input({ type: "right_click", x, y });
  write = (text: string) => this.input({ type: "type", text });
  press = (key: string | string[]) => this.input({ type: "key", keys: Array.isArray(key) ? key.join("+") : key });
  scroll = (direction: "up" | "down", amount: number) => this.input({ type: "scroll", direction, amount });
  open = async (url: string) => {
    const safe = url.replace(/'/g, "%27");
    await this.commands.run(`DISPLAY=:0 nohup xdg-open '${safe}' >/dev/null 2>&1 &`, { timeoutMs: 15_000 });
  };
  kill = async () => { /* never wipes the user's disk; stopping is done in the desktop app */ };
}

export const localSandbox = (sandboxId: string) => new LocalSandbox(sandboxId);
export { sandboxIdOf };