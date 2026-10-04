import { doc, getDoc, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";

type Env = { uid: string; e2bKey: string };

const IDLE_MS = 120_000;
const seen = new Map<string, { t: number; key: string }>();
let timer: ReturnType<typeof setInterval> | null = null;

async function post(url: string, body: Record<string, unknown>) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const text = await res.text();
  let data: any = {};
  try { data = JSON.parse(text); } catch { data = { error: `Server returned ${res.status}: ${text.slice(0, 160)}` }; }
  if (!res.ok) throw new Error(data?.error || "Request failed.");
  return data;
}

function pauseNow(key: string, sandboxId: string) {
  return post("/api/e2b/pause", { apiKey: key, sandboxId }).catch(() => {});
}

function ensureTimer() {
  if (timer || typeof window === "undefined") return;
  timer = setInterval(() => {
    const now = Date.now();
    for (const [id, v] of seen) {
      if (now - v.t > IDLE_MS) { seen.delete(id); void pauseNow(v.key, id); }
    }
  }, 20_000);
}

/** Call whenever a computer is used. 2 minutes without use → it is paused automatically (saves money). */
export function touch(sandboxId: string | null | undefined, e2bKey: string) {
  if (!sandboxId || !e2bKey) return;
  seen.set(sandboxId, { t: Date.now(), key: e2bKey });
  ensureTimer();
}

/** Pause right now (data stays saved; the next use wakes it up). */
export function releaseNow(e2bKey: string, sandboxId: string) {
  seen.delete(sandboxId);
  return pauseNow(e2bKey, sandboxId);
}

const ref = (uid: string, chatId: string) => doc(db, "users", uid, "chats", chatId);

export async function setComputer(env: Env, chatId: string, slot: string, sandboxId: string) {
  await updateDoc(ref(env.uid, chatId), { ["computers." + slot]: sandboxId }).catch(() => {});
  touch(sandboxId, env.e2bKey);
}

/** Returns this chat's computer for a slot ("code", "studio", "worker_<memberId>"): wakes it, or creates it the first time. */
export async function acquire(env: Env, chatId: string, slot: string): Promise<string> {
  if (!/^[A-Za-z0-9_]{1,40}$/.test(slot)) throw new Error("Bad computer slot.");
  const snap = await getDoc(ref(env.uid, chatId));
  const existing = (snap.data() as { computers?: Record<string, string> } | undefined)?.computers?.[slot];
  if (existing) {
    try {
      await post("/api/venus/studio", { action: "status", e2bKey: env.e2bKey, sandboxId: existing });
      touch(existing, env.e2bKey);
      return existing;
    } catch (e) {
      if (!String((e as Error).message).includes("SANDBOX_GONE")) throw e;
    }
  }
  const created = await post("/api/e2b/create", { apiKey: env.e2bKey });
  await setComputer(env, chatId, slot, created.sandboxId as string);
  return created.sandboxId as string;
}