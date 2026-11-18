import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { appBaseUrl } from "@/lib/voice-server";
import { isPlaceholder, vaultPut } from "@/lib/vault";
import { startRun, store } from "@/lib/agent/worker";
import { getAdminDb } from "@/lib/firebase-admin";
import type { ProviderId } from "@/lib/providers";

export const runtime = "nodejs";
export const maxDuration = 30;

// The endpoint behind `npm run eval:run` (scripts/eval-run.mjs). It runs ONE eval task through the real agent loop of a SANDBOX account.
//   EVAL_TOKEN   shared secret the runner sends as a Bearer token (the endpoint is closed without it)
//   EVAL_UID     the sandbox account whose chat, keys and connectors are used (never your real account: write tasks really run)
//   EVAL_CHAT_ID the chat of that account (its model and connectors are used; EVAL_MODEL / EVAL_PROVIDER override the model)
// Two steps, so no single request has to live as long as a long task:
//   POST {taskId, prompt}   -> {runId, status:"running"}
//   POST {runId}            -> {status:"running"} | {status:"done"|"failed", output, costUsd, notes?}
const safeEq = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };
const origin = (req: Request) => { try { return appBaseUrl(req); } catch { return new URL(req.url).origin; } };

export async function POST(req: Request) {
  const token = process.env.EVAL_TOKEN || "", uid = process.env.EVAL_UID || "", chatId = process.env.EVAL_CHAT_ID || "";
  if (!token || !uid || !chatId) return NextResponse.json({ error: "Evals are not set up (EVAL_TOKEN, EVAL_UID and EVAL_CHAT_ID are required)." }, { status: 503 });
  const got = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!got || !safeEq(got, token)) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { taskId?: unknown; prompt?: unknown; runId?: unknown };
  const S = store();

  if (typeof body.runId === "string") {
    const r = await S.getRun(uid, body.runId);
    if (!r) return NextResponse.json({ error: "Run not found." }, { status: 404 });
    const costUsd = (r.costMicros ?? 0) / 1_000_000;
    if (r.status === "done") return NextResponse.json({ status: "done", output: String(r.result ?? ""), costUsd });
    if (r.status === "error" || r.status === "stopped") return NextResponse.json({ status: "failed", output: "", costUsd, notes: r.error?.message || r.status });
    if (r.status === "paused") return NextResponse.json({ status: "failed", output: "", costUsd, notes: `waiting for a human: ${String(r.pending?.summary ?? r.pending?.question ?? r.pending?.name ?? "").slice(0, 160)}` });
    return NextResponse.json({ status: "running" });
  }

  const prompt = String(body.prompt ?? "").trim().slice(0, 8000);
  if (!prompt) return NextResponse.json({ error: "prompt is required." }, { status: 400 });
  const db = getAdminDb();
  const chat = (await db.collection("users").doc(uid).collection("chats").doc(chatId).get()).data() as { provider?: ProviderId; model?: string } | undefined;
  const provider = (process.env.EVAL_PROVIDER || chat?.provider) as ProviderId | undefined;
  const model = process.env.EVAL_MODEL || chat?.model;
  if (!provider || !model) return NextResponse.json({ error: "The eval chat has no model." }, { status: 400 });
  const keys = ((await db.collection("users").doc(uid).get()).data() as { apiKeys?: Partial<Record<ProviderId, string>> } | undefined)?.apiKeys ?? {};
  let keyRef = keys[provider] ?? "", tempKey: string | undefined;
  if (!keyRef) return NextResponse.json({ error: `The eval account has no saved key for ${provider}.` }, { status: 400 });
  if (!isPlaceholder(keyRef)) { tempKey = `eval.tmp.${Date.now().toString(36)}`; keyRef = await vaultPut(uid, tempKey, keyRef); }
  // autoApprove: an eval has nobody to click "approve". The risk classifier still stops money, secrets and deletions: those runs end as "failed: waiting for a human".
  const runId = await startRun(uid, { chatId, task: prompt, provider, model, keyRef, tempKey, origin: origin(req), maxRounds: 40, autoApprove: true });
  return NextResponse.json({ runId, status: "running" });
}
