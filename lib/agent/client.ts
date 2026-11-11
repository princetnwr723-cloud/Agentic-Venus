"use client";
// Browser side of the server agent. Calls go through the normal secure fetch (Firebase ID token added automatically).
// Live updates come straight from Firestore (the owner may read users/{uid}/runs/**), so a reload or a second device sees the same run.
import { collection, doc, limit, onSnapshot, orderBy, query } from "firebase/firestore";
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
