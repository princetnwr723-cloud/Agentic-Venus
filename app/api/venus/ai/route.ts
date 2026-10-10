import { NextResponse } from "next/server";
import { callProvider } from "@/lib/ai-providers-server";
import { readBody, requestStatus } from "@/lib/request";
import { directorPrompt, editPrompt, reviewPrompt, sceneCodePrompt } from "@/lib/venus-prompts";
import { checkCode, sanitizeScene, sanitizeStoryboard, type Aspect } from "@/lib/venus-schema";
import type { ProviderId } from "@/lib/providers";

export const runtime = "nodejs";
export const maxDuration = 60;

function extractJson(text: string): any | null {
  const a = text.indexOf("{");
  const b = text.lastIndexOf("}");
  if (a === -1 || b <= a) return null;
  try { return JSON.parse(text.slice(a, b + 1)); } catch { return null; }
}
function extractCode(text: string): string {
  const m = /```(?:tsx|jsx|typescript|ts|javascript|js)?\s*\n([\s\S]*?)```/.exec(text);
  return (m ? m[1] : text).trim();
}
const PATCH_KEYS = new Set(["fontScale", "transition", "headline", "subhead", "text", "label", "caption"]);

export async function POST(req: Request) {
  try {
    const body = await readBody(req);
    const provider = body.provider as ProviderId;
    const apiKey = String(body.apiKey || "");
    const model = String(body.model || "");
    if (!provider || !apiKey || !model) return NextResponse.json({ error: "Provider, API key and model are required." }, { status: 400 });
    const ask = (content: string, image?: { mediaType: string; data: string }) =>
      callProvider({ provider, apiKey, model, messages: [{ role: "user", content, ...(image ? { image } : {}) }] });

    if (body.kind === "storyboard") {
      const seconds = Math.min(60, Math.max(10, Number(body.seconds) || 45));
      const aspect = (["16:9", "9:16", "1:1"].includes(body.aspect) ? body.aspect : "16:9") as Aspect;
      const design = body.design === "library" ? "library" : "ai";
      const reply = await ask(
        directorPrompt({ brief: String(body.brief || "").slice(0, 3000), seconds, aspect, voice: Boolean(body.voice), captions: Boolean(body.captions), design, context: typeof body.context === "string" ? body.context.slice(0, 3000) : undefined })
      );
      const raw = extractJson(reply);
      if (!raw) return NextResponse.json({ error: "The model did not return a valid storyboard: " + reply.slice(0, 160) }, { status: 422 });
      const storyboard = sanitizeStoryboard(raw, { aspect, theme: String(body.theme || "midnight"), captions: Boolean(body.captions), maxSeconds: seconds, keepFiles: false });
      return NextResponse.json({ storyboard });
    }

    if (body.kind === "scene-code") {
      const input = {
        scene: (body.scene ?? {}) as Record<string, unknown>,
        palette: body.palette as Record<string, string> | undefined,
        fonts: body.fonts as { display?: string; body?: string } | undefined,
        aspect: String(body.aspect || "16:9"),
        frames: Math.max(36, Number(body.frames) || 150),
        concept: typeof body.concept === "string" ? body.concept : undefined,
        previousCode: typeof body.previousCode === "string" ? body.previousCode.slice(0, 12000) : undefined,
        error: typeof body.error === "string" ? body.error.slice(0, 1500) : undefined,
        critique: typeof body.critique === "string" ? body.critique.slice(0, 600) : undefined,
      };
      let code = extractCode(await ask(sceneCodePrompt(input)));
      let problem = checkCode(code);
      if (problem) {
        code = extractCode(await ask(sceneCodePrompt({ ...input, previousCode: code, error: problem, critique: undefined })));
        problem = checkCode(code);
      }
      return NextResponse.json({ code, problem });
    }

    if (body.kind === "edit") {
      const scene = (body.scene ?? {}) as Record<string, unknown>;
      const raw = extractJson(await ask(editPrompt(scene, String(body.instruction || "").slice(0, 600)))) as { scene?: unknown; regenerateCode?: boolean } | null;
      if (!raw?.scene) return NextResponse.json({ error: "The agent could not apply that edit." }, { status: 422 });
      return NextResponse.json({ scene: sanitizeScene(raw.scene, true), regenerateCode: Boolean(raw.regenerateCode) });
    }

    if (body.kind === "review") {
      const img = body.image as { mediaType?: string; data?: string } | undefined;
      if (!img?.data) return NextResponse.json({ error: "Image missing." }, { status: 400 });
      const tiles = (Array.isArray(body.tiles) ? body.tiles : []).slice(0, 6);
      const raw = extractJson(await ask(reviewPrompt(tiles), { mediaType: img.mediaType || "image/jpeg", data: img.data })) as { verdict?: string; issues?: any[] } | null;
      const issues = (raw?.issues ?? []).slice(0, 8).map((i: any) => {
        const patch: Record<string, unknown> = {};
        for (const [k, v] of Object.entries((i?.patch ?? {}) as Record<string, unknown>)) {
          if (!PATCH_KEYS.has(k)) continue;
          if (k === "fontScale") patch[k] = Math.min(1.2, Math.max(0.5, Number(v) || 1));
          else if (typeof v === "string") patch[k] = v.slice(0, 160);
        }
        return { scene: Number(i?.scene), problem: String(i?.problem ?? "").slice(0, 300), patch };
      });
      return NextResponse.json({ verdict: raw?.verdict === "fix" ? "fix" : "good", issues });
    }

    return NextResponse.json({ error: "Unknown request." }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "AI request failed." }, { status: requestStatus(err) });
  }
}