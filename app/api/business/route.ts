import { NextResponse } from "next/server";
import { readBody, requestStatus, RequestError } from "@/lib/request";
import { isPlaceholder } from "@/lib/vault";
import { PROVIDERS } from "@/lib/providers";
import { appBaseUrl } from "@/lib/voice-server";
import { advanceForUser, launchJob, stopJob } from "@/lib/business-server";

export const runtime = "nodejs";
export const maxDuration = 60;

const PROVIDER_IDS = new Set<string>(PROVIDERS.map((p) => p.id));
const str = (v: unknown, n: number) => String(v ?? "").slice(0, n);
const origin = (req: Request) => { try { return appBaseUrl(req); } catch { return new URL(req.url).origin; } };

// The Business Hub's background team. "launch" saves the plan and starts the first steps; "advance" moves a running job forward
// (the open Hub calls it every few seconds, the scheduler calls the same code through /api/agent/tick); "stop" ends a job.
export async function POST(req: Request) {
  try {
    const rawReq = req.clone();
    const body = await readBody(req);
    const uid = String(body.uid);
    const action = String(body.action || "");

    if (action === "launch") {
      // readBody opens vault placeholders; the agents must only ever get the reference, so the raw body is read again
      const raw = (await rawReq.json().catch(() => ({}))) as { apiKey?: unknown; fallbacks?: unknown };
      const chatId = str(body.chatId, 200), model = str(body.model, 120), provider = str(body.provider, 40);
      if (!chatId || !str(body.goal, 10).trim()) throw new RequestError("chatId and goal are required.", 400);
      if (!PROVIDER_IDS.has(provider) || !model) throw new RequestError("Pick a provider and a model.", 400);
      const keyRef = typeof raw.apiKey === "string" ? raw.apiKey : "";
      if (!isPlaceholder(keyRef)) throw new RequestError("Your API key is not in the vault yet. Open the dashboard once so it is secured, then try again.", 400);
      const fallbacks = (Array.isArray(raw.fallbacks) ? (raw.fallbacks as Array<Record<string, unknown>>) : [])
        .filter((f) => PROVIDER_IDS.has(String(f?.provider)) && isPlaceholder(f?.apiKey) && typeof f?.model === "string")
        .slice(0, 3).map((f) => ({ provider: String(f.provider), model: str(f.model, 120), keyRef: String(f.apiKey) }));
      const runId = await launchJob(uid, { chatId, goal: str(body.goal, 2000), steps: body.steps, profile: body.profile, provider, model, keyRef, fallbacks, origin: origin(req) });
      return NextResponse.json({ ok: true, runId });
    }

    if (action === "advance") return NextResponse.json({ ok: true, jobs: await advanceForUser(uid, origin(req)) });

    if (action === "stop") return NextResponse.json({ ok: true, stopped: await stopJob(uid, str(body.runId, 60)) });

    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Business request failed." }, { status: requestStatus(e) });
  }
}
