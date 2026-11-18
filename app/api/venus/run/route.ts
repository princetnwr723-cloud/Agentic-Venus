import { NextResponse } from "next/server";
import { readBody, requestStatus, RequestError } from "@/lib/request";
import { PROVIDERS } from "@/lib/providers";
import { getAdminDb } from "@/lib/firebase-admin";
import { appBaseUrl } from "@/lib/voice-server";
import { startVenusRun, stopVenusRun, venusStore, VenusStartError } from "@/lib/venus-run-server";
import type { VenusRunDoc } from "@/lib/venus-run";
import type { VenusProject } from "@/lib/venus";

export const runtime = "nodejs";
export const maxDuration = 30;

const PROVIDER_IDS = new Set<string>(PROVIDERS.map((p) => p.id));
const str = (v: unknown, n: number) => String(v ?? "").slice(0, n);
const num = (v: unknown, lo: number, hi: number, d: number) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
const origin = (req: Request) => { try { return appBaseUrl(req); } catch { return new URL(req.url).origin; } };

/** What the browser may see of a run. */
const view = (r: VenusRunDoc) => ({
  id: r.id, chatId: r.chatId, title: r.title, status: r.status, stage: r.stage, label: r.label ?? "", value: r.value ?? null,
  error: r.error ?? null, createdAt: r.createdAt, updatedAt: r.updatedAt, endedAt: r.endedAt ?? null, slices: r.slices,
});

/** Only the fields of a project that the owner may set. The server decides the rest (ids, status, stage, owner of the run). */
function cleanProject(raw: Record<string, unknown>, chatId: string): VenusProject {
  const provider = str(raw.provider, 40);
  if (!PROVIDER_IDS.has(provider) || !raw.model) throw new RequestError("Pick a provider and a model for this chat.", 400);
  const brief = str(raw.brief, 12_000).trim();
  if (!brief) throw new RequestError("The video needs a brief.", 400);
  const aspect = ["16:9", "9:16", "1:1"].includes(String(raw.aspect)) ? (raw.aspect as VenusProject["aspect"]) : "16:9";
  const src = raw.source as Record<string, unknown> | undefined;
  const now = Date.now();
  const p: VenusProject = {
    id: "v" + now.toString(36) + Math.random().toString(36).slice(2, 5), title: str(raw.title || brief, 48).replace(/\s+/g, " "), brief,
    seconds: num(raw.seconds, 5, 3600, 45), aspect, theme: str(raw.theme || "midnight", 30), voice: raw.voice !== false && Boolean(raw.voice), voiceName: str(raw.voiceName || "nova", 40),
    captions: raw.captions !== false, quality: raw.quality === "1080p" ? "1080p" : "720p", review: raw.review !== false, design: ["ai", "mixed", "library"].includes(String(raw.design)) ? (raw.design as VenusProject["design"]) : "ai", music: raw.music !== false, origin: raw.origin === "venus" ? "venus" : "chat", chatId,
    provider: provider as VenusProject["provider"], model: str(raw.model, 120), stage: "studio", status: "idle", createdAt: now, updatedAt: now,
    mode: raw.mode === "edit" ? "edit" : "make",
  };
  if (p.mode === "edit") {
    if (!src || (src.kind !== "url" && src.kind !== "upload")) throw new RequestError("The video to edit is missing.", 400);
    p.source = { kind: src.kind, ...(src.url ? { url: str(src.url, 2000) } : {}), ...(src.path ? { path: str(src.path, 400) } : {}), ...(src.name ? { name: str(src.name, 200) } : {}) };
    p.keepAll = Boolean(raw.keepAll); p.matchSource = Boolean(raw.matchSource);
    if (raw.editPolicy && typeof raw.editPolicy === "object") p.editPolicy = raw.editPolicy as VenusProject["editPolicy"];
  }
  if (typeof raw.templateJson === "string" && raw.templateJson.length < 200_000) { p.templateJson = raw.templateJson; p.templateName = str(raw.templateName, 80); }
  if (raw.voiceMode === "auto" || raw.voiceMode === "on" || raw.voiceMode === "off") p.voiceMode = raw.voiceMode;
  if (typeof raw.script === "boolean") p.script = raw.script;
  if (raw.docu === true) p.docu = true;
  return p;
}

export async function POST(req: Request) {
  try {
    const raw = (await req.clone().json().catch(() => ({}))) as { project?: Record<string, unknown> };
    const body = await readBody(req);
    const uid = String(body.uid);
    const S = venusStore();
    const action = String(body.action || "");

    if (action === "start") {
      // The Venus page and Studio+ have no chat of their own: the finished video is announced in the newest chat.
      let chatId = str(body.chatId, 200);
      if (!chatId) {
        const q = await getAdminDb().collection("users").doc(uid).collection("chats").orderBy("createdAt", "desc").limit(1).get().catch(() => null);
        chatId = q?.docs[0]?.id ?? "";
      }
      if (!chatId) throw new RequestError("Open the dashboard once and create a chat first: the finished video is posted there.", 400);
      const project = cleanProject(raw.project ?? {}, chatId);
      const id = await startVenusRun(uid, project, { origin: origin(req), source: "chat" });
      return NextResponse.json({ ok: true, runId: id });
    }
    if (action === "list") return NextResponse.json({ ok: true, runs: (await S.listRuns(uid, 20)).map(view) });

    const pid = str(body.runId, 40);
    const run = await S.getRun(uid, pid);
    if (!run) throw new RequestError("Run not found.", 404);
    if (action === "status") return NextResponse.json({ ok: true, run: view(run) });
    if (action === "stop") { await stopVenusRun(uid, pid); return NextResponse.json({ ok: true }); }
    throw new RequestError("Unknown action.", 400);
  } catch (err) {
    const status = err instanceof VenusStartError ? err.status : requestStatus(err);
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : "Venus request failed." }, { status });
  }
}
