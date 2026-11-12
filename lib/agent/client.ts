"use client";
// Browser side of the server agent. Calls go through the normal secure fetch (Firebase ID token added automatically).
// Live updates come straight from Firestore (the owner may read users/{uid}/runs/**), so a reload or a second device sees the same run.
import { collection, doc, limit, onSnapshot, orderBy, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";

export type RunView = {
  id: string; chatId: string; task: string; status: "queued" | "running" | "paused" | "done" | "error" | "stopped" | "budget";
  round: number; createdAt: number; updatedAt: number; endedAt: number | null;
  pending: null | { id: string; kind: "approve_tool" | "ask_user" | "request_approval" | "request_secret" | "request_takeover"; name: string; summary: string; question?: string; options?: string[]; secretName?: string; args?: Record<string, unknown>; tainted?: boolean; expiresAt: number };
  takeover: null | { status: string; startedAt?: number; lastBeat?: number };
  usage: { input: number; output: number; cacheRead?: number; cacheWrite?: number };
  costMicros: number; calls: number; compactions: number; tainted: boolean; result: string | null; error: { code: string; message: string } | null; model: string; provider: string;
};
export type RunEvent = { id: string; t: number; kind: string; text: string };

export async function agentApi<T = any>(uid: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch("/api/agent", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ uid, ...body }) });
  const d = await res.json().catch(() => ({}));
  if (!res.ok || d.ok === false) throw Object.assign(new Error(d.error || "Agent request failed."), { latched: !!d.latched, status: res.status });
  return d as T;
}

export function watchRun(uid: string, runId: string, on: (r: RunView | null) => void): () => void {
  return onSnapshot(doc(db, "users", uid, "runs", runId), (s) => on(s.exists() ? ({ ...(s.data() as object), id: s.id } as RunView) : null), () => on(null));
}
export function watchEvents(uid: string, runId: string, on: (e: RunEvent[]) => void, max = 80): () => void {
  const q = query(collection(db, "users", uid, "runs", runId, "events"), orderBy("t", "desc"), limit(max));
  return onSnapshot(q, (s) => on(s.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<RunEvent, "id">) })).reverse()), () => on([]));
}
export function watchRuns(uid: string, on: (r: RunView[]) => void): () => void {
  const q = query(collection(db, "users", uid, "runs"), orderBy("createdAt", "desc"), limit(20));
  return onSnapshot(q, (s) => on(s.docs.map((d) => ({ ...(d.data() as object), id: d.id }) as RunView)), () => on([]));
}
export const usd = (micros: number) => "$" + (micros / 1_000_000).toFixed(micros < 10_000 ? 4 : 3);

/** The answer while the model is still writing it (streaming). null when nothing is being written. */
export function watchLive(uid: string, runId: string, on: (t: { text: string; round: number } | null) => void): () => void {
  return onSnapshot(doc(db, "users", uid, "runs", runId, "live", "now"), (s) => on(s.exists() ? (s.data() as { text: string; round: number }) : null), () => on(null));
}

/** Runs of one chat (newest first). Equality filter only, so no composite index is needed. */
export function watchChatRuns(uid: string, chatId: string, on: (r: RunView[]) => void): () => void {
  const q = query(collection(db, "users", uid, "runs"), where("chatId", "==", chatId), limit(12));
  return onSnapshot(q, (s) => on(s.docs.map((d) => ({ ...(d.data() as object), id: d.id }) as RunView).sort((a, b) => b.createdAt - a.createdAt)), () => on([]));
}

export const isActiveRun = (r: Pick<RunView, "status">) => r.status === "queued" || r.status === "running" || r.status === "paused" || r.status === "budget";

export type StartInput = { chatId: string; task: string; provider: string; model: string; apiKey: string; fallbacks?: Array<{ provider: string; model: string; apiKey: string }>; maxRounds?: number };
/** Starts a run on the server. `apiKey` is the vault placeholder the app already keeps (never a plain key when one is saved). */
export async function startServerRun(uid: string, i: StartInput): Promise<string> {
  const d = await agentApi<{ runId: string }>(uid, { action: "start", ...i });
  return d.runId;
}
