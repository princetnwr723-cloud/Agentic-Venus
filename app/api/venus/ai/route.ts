import { NextResponse } from "next/server";
import { callProvider } from "@/lib/ai-providers-server";
import { readBody, requestStatus } from "@/lib/request";
import { addTokens, assertTokens, estTokens } from "@/lib/billing-server";
import { directorPrompt, editNotesPrompt, editPlanPrompt, editPrompt, outlinePrompt, reviewPrompt, sceneCodePrompt, templateExtractPrompt, videoIntentPrompt, type EditFacts } from "@/lib/venus-prompts";
import { checkCode, sanitizeScene, sanitizeSource, sanitizeStoryboard, type Aspect } from "@/lib/venus-schema";
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
const STYLE_KEYS = ["concept", "palette", "fonts", "bg", "grade", "audio"];
const ASPECT_LIST = ["16:9", "9:16", "1:1"];

export async function POST(req: Request) {
  try {
    const body = await readBody(req);
    const provider = body.provider as ProviderId;
    const apiKey = String(body.apiKey || "");
    const model = String(body.model || "");
    if (!provider || !apiKey || !model) return NextResponse.json({ error: "Provider, API key and model are required." }, { status: 400 });

    const uid = String(body.uid);
    await assertTokens(uid); // plan limit (HTTP 402 when used up)

    const ask = async (content: string, image?: { mediaType: string; data: string }, maxTokens?: number) => {
      // a long edit plan is a long JSON: it gets more room, and falls back to the normal size when the model does not allow it
      const run = (max?: number) => callProvider({ provider, apiKey, model, messages: [{ role: "user", content, ...(image ? { image } : {}) }], ...(max ? { maxTokens: max } : {}) });
      const out = maxTokens ? await run(maxTokens).catch(() => run()) : await run();
      await addTokens(uid, estTokens(content.length + out.length));
      return out;
    };
    const aspectOf = (v: unknown): Aspect => (ASPECT_LIST.includes(String(v)) ? String(v) : "16:9") as Aspect;
    const context = typeof body.context === "string" ? body.context.slice(0, 3000) : undefined;
    // a saved video template to clone (look, pace, structure): its own field, so memory text can never push it out
    const template = typeof body.template === "string" && body.template.trim() ? body.template.slice(0, 7000) : undefined;

    // ---- a storyboard for one video, or for ONE PART of a long video ----
    if (body.kind === "storyboard") {
      const seconds = Math.min(90, Math.max(8, Number(body.seconds) || 45));
      const aspect = aspectOf(body.aspect);
      const design = "ai"; // every video is designed by the agent
      const part = body.part && typeof body.part === "object"
        ? { index: Math.max(0, Number(body.part.index) || 0), total: Math.max(1, Number(body.part.total) || 1), title: String(body.part.title || "").slice(0, 120), summary: String(body.part.summary || "").slice(0, 700), seconds: Math.round(seconds) }
        : undefined;
      const style = body.style && typeof body.style === "object" ? body.style as Record<string, unknown> : undefined;
      const voiceArg: boolean | "auto" = body.voice === "auto" ? "auto" : Boolean(body.voice);
      const scriptText = typeof body.scriptText === "string" && body.scriptText.trim() ? body.scriptText.slice(0, 12000) : undefined;
      const reply = await ask(
        directorPrompt({ brief: String(body.brief || "").slice(0, 4000), seconds, aspect, voice: voiceArg, captions: Boolean(body.captions), design, context, part, style, scriptText, template })
      );
      const raw = extractJson(reply);
      if (!raw) return NextResponse.json({ error: "The model did not return a valid storyboard: " + reply.slice(0, 160) }, { status: 422 });
      const opts = { aspect, theme: String(body.theme || "midnight"), captions: Boolean(body.captions), maxSeconds: seconds, keepFiles: false };
      const fixStyle = (r: any) => { if (style) for (const k of STYLE_KEYS) if (style[k] !== undefined) r[k] = style[k]; }; // every part keeps the same look
      fixStyle(raw);
      let storyboard = sanitizeStoryboard(raw, opts);
      // too few scenes feel like a slideshow: ask once more, with the exact number needed
      const minScenes = Math.max(3, Math.round(seconds / 4.5));
      if (storyboard.scenes.length < minScenes) {
        const again = extractJson(await ask(
          directorPrompt({ brief: String(body.brief || "").slice(0, 4000), seconds, aspect, voice: voiceArg, captions: Boolean(body.captions), design, context, part, style, scriptText, template }) +
          `\n\nIMPORTANT: your previous answer had only ${storyboard.scenes.length} scenes for ${Math.round(seconds)} seconds. Write the same story again with at least ${minScenes} scenes (about ${Math.round(seconds / 3.4)}): one story beat per scene, 2.5 to 5 seconds each, changing picture every time.`
        ));
        if (again) {
          fixStyle(again);
          const better = sanitizeStoryboard(again, opts);
          if (better.scenes.length > storyboard.scenes.length) storyboard = better;
        }
      }
      return NextResponse.json({ storyboard });
    }

    // ---- the chapter plan of a long video ----
    if (body.kind === "outline") {
      const seconds = Math.min(3600, Math.max(120, Number(body.seconds) || 600));
      const chapters = Math.min(80, Math.max(2, Math.round(seconds / 55)));
      const raw = extractJson(await ask(outlinePrompt({ brief: String(body.brief || "").slice(0, 4000), seconds, aspect: aspectOf(body.aspect), voice: Boolean(body.voice), chapters, context, template })));
      const list = Array.isArray(raw?.chapters) ? raw.chapters : [];
      if (!raw || list.length < 2) return NextResponse.json({ error: "The model did not return a chapter plan." }, { status: 422 });
      const chs = list.slice(0, 90).map((c: any, i: number) => ({ title: String(c?.title ?? "Part " + (i + 1)).slice(0, 120), summary: String(c?.summary ?? "").slice(0, 700), seconds: Math.max(20, Math.min(90, Number(c?.seconds) || seconds / list.length)) }));
      const sum = chs.reduce((a: number, c: { seconds: number }) => a + c.seconds, 0) || seconds;
      const k = seconds / sum;
      const chapterList = chs.map((c: { title: string; summary: string; seconds: number }) => ({ ...c, seconds: Math.max(15, Math.min(90, Math.round(c.seconds * k))) }));
      const first = sanitizeStoryboard({ ...raw, scenes: [] }, { aspect: aspectOf(body.aspect), theme: String(body.theme || "midnight") });
      const style: Record<string, unknown> = {};
      for (const key of STYLE_KEYS) if ((first as any)[key] !== undefined) style[key] = (first as any)[key];
      return NextResponse.json({ title: first.title, style, chapters: chapterList });
    }

    // ---- editing the user's own video ----
    if (body.kind === "edit-plan") {
      const facts = body.facts as EditFacts | undefined;
      const source = sanitizeSource(body.source);
      const img = body.image as { mediaType?: string; data?: string } | undefined;
      if (!facts || !source) return NextResponse.json({ error: "The analysis of the video is missing." }, { status: 400 });
      const aspect = aspectOf(body.aspect);
      const seconds = Math.min(1200, Math.max(10, Number(body.seconds) || 60));
      const pol = body.policy && typeof body.policy === "object" ? (body.policy as Record<string, unknown>) : null;
      const policy = pol ? { length: (["keep", "tighten", "target", "shorter"].includes(String(pol.length)) ? String(pol.length) : "keep") as "keep" | "tighten" | "target" | "shorter", seconds: Number(pol.seconds) || undefined, creative: pol.creative === true, graphics: pol.graphics === true } : undefined;
      const notes = typeof body.notes === "string" && body.notes.trim() ? body.notes.slice(0, 6000) : undefined;
      const prompt = editPlanPrompt({ brief: String(body.brief || "").slice(0, 4000), seconds, keepAll: Boolean(body.keepAll), aspect, captions: Boolean(body.captions), music: Boolean(body.music), facts, context, policy, notes });
      const reply = await ask(prompt, img?.data ? { mediaType: img.mediaType || "image/jpeg", data: img.data } : undefined, 16000);
      const raw = extractJson(reply);
      if (!raw) return NextResponse.json({ error: "The model did not return an edit plan: " + reply.slice(0, 160) }, { status: 422 });
      raw.source = source;
      const storyboard = sanitizeStoryboard(raw, { aspect, theme: String(body.theme || "midnight"), captions: Boolean(body.captions), maxSeconds: body.keepAll ? Math.min(1200, source.duration + 120) : Math.min(1200, seconds * 1.15 + 6), keepFiles: false });
      if (!storyboard.scenes.some((s) => s.type === "clip")) return NextResponse.json({ error: "The edit plan has no clips of your video. Try again or describe the edit more clearly." }, { status: 422 });
      return NextResponse.json({ storyboard });
    }

    // ---- what does the user want with the attached video? (ANY language) ----
    if (body.kind === "video-intent") {
      const reply = await ask(videoIntentPrompt(String(body.text || ""), String(body.fileName || "")), undefined, 300);
      const j = extractJson(reply) as Record<string, unknown> | null;
      if (!j) return NextResponse.json({ error: "No verdict." }, { status: 422 });
      const action = ["edit", "template", "other"].includes(String(j.action)) ? String(j.action) : "other";
      const length = ["keep", "tighten", "target", "shorter"].includes(String(j.length)) ? String(j.length) : "keep";
      const seconds = Number(j.seconds);
      return NextResponse.json({
        verdict: { action, length: length === "target" && !(seconds >= 5) ? "keep" : length, ...(length === "target" && seconds >= 5 && seconds <= 7200 ? { seconds: Math.round(seconds) } : {}), creative: j.creative === true, graphics: j.graphics === true || j.creative === true },
      });
    }

    // ---- the first pass of a free / full-treatment edit: the editor's notes ----
    if (body.kind === "edit-notes") {
      const facts = body.facts as EditFacts | undefined;
      const img = body.image as { mediaType?: string; data?: string } | undefined;
      if (!facts || !Array.isArray(facts.tiles)) return NextResponse.json({ error: "The analysis of the video is missing." }, { status: 400 });
      const pol = body.policy && typeof body.policy === "object" ? (body.policy as Record<string, unknown>) : null;
      const policy = pol ? { length: (["keep", "tighten", "target", "shorter"].includes(String(pol.length)) ? String(pol.length) : "keep") as "keep" | "tighten" | "target" | "shorter", seconds: Number(pol.seconds) || undefined, creative: pol.creative === true, graphics: pol.graphics === true } : undefined;
      const prompt = editNotesPrompt({
        brief: String(body.brief || "").slice(0, 4000), seconds: Math.min(1200, Math.max(10, Number(body.seconds) || facts.duration)), keepAll: Boolean(body.keepAll),
        aspect: aspectOf(body.aspect), music: Boolean(body.music), facts, policy,
      });
      const reply = await ask(prompt, img?.data ? { mediaType: img.mediaType || "image/jpeg", data: img.data } : undefined, 4000);
      return NextResponse.json({ notes: reply.trim().slice(0, 6000) });
    }

    // ---- reverse-engineering a real video into a reusable template ----
    if (body.kind === "template-extract") {
      const facts = body.facts as EditFacts | undefined;
      const img = body.image as { mediaType?: string; data?: string } | undefined;
      if (!facts || !Array.isArray(facts.tiles)) return NextResponse.json({ error: "The analysis of the video is missing." }, { status: 400 });
      const prompt = templateExtractPrompt({
        facts, hint: String(body.hint || "").slice(0, 600), name: String(body.name || "").slice(0, 60), category: String(body.category || "").slice(0, 20), fileName: String(body.fileName || "").slice(0, 100),
      });
      const reply = await ask(prompt, img?.data ? { mediaType: img.mediaType || "image/jpeg", data: img.data } : undefined);
      const raw = extractJson(reply);
      if (!raw || !Array.isArray(raw.structure)) return NextResponse.json({ error: "The model did not return a template: " + reply.slice(0, 160) }, { status: 422 });
      return NextResponse.json({ template: raw });
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