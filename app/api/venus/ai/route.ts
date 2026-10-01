import { NextResponse } from "next/server";
import { callProvider } from "@/lib/ai-providers-server";
import { reviewPrompt, storyboardPrompt } from "@/lib/venus-prompts";
import { sanitizeStoryboard, type Aspect } from "@/lib/venus-schema";
import type { ProviderId } from "@/lib/providers";

export const runtime = "nodejs";
export const maxDuration = 60;

function extractJson(text: string): any | null {
  const a = text.indexOf("{");
  const b = text.lastIndexOf("}");
  if (a === -1 || b <= a) return null;
  try {
    return JSON.parse(text.slice(a, b + 1));
  } catch {
    return null;
  }
}

const PATCH_KEYS = new Set(["fontScale", "transition", "headline", "subhead", "text", "label", "caption"]);

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const provider = body.provider as ProviderId;
    const apiKey = String(body.apiKey || "");
    const model = String(body.model || "");
    if (!provider || !apiKey || !model) {
      return NextResponse.json({ error: "Provider, key aur model chahiye." }, { status: 400 });
    }

    if (body.kind === "storyboard") {
      const seconds = Math.min(60, Math.max(10, Number(body.seconds) || 45));
      const aspect = (["16:9", "9:16", "1:1"].includes(body.aspect) ? body.aspect : "16:9") as Aspect;
      const theme = String(body.theme || "midnight");
      const voice = Boolean(body.voice);
      const captions = Boolean(body.captions);
      const reply = await callProvider({
        provider,
        apiKey,
        model,
        messages: [
          {
            role: "user",
            content: storyboardPrompt({ brief: String(body.brief || "").slice(0, 3000), seconds, aspect, theme, voice, captions }),
          },
        ],
      });
      const raw = extractJson(reply);
      if (!raw) {
        return NextResponse.json(
          { error: "Model ne valid storyboard nahi diya: " + reply.slice(0, 160) },
          { status: 422 }
        );
      }
      const storyboard = sanitizeStoryboard(raw, { aspect, theme, captions, maxSeconds: seconds, keepFiles: false });
      return NextResponse.json({ storyboard });
    }

    if (body.kind === "review") {
      const img = body.image as { mediaType?: string; data?: string } | undefined;
      if (!img?.data) return NextResponse.json({ error: "Image missing." }, { status: 400 });
      const tiles = (Array.isArray(body.tiles) ? body.tiles : []).slice(0, 6);
      const reply = await callProvider({
        provider,
        apiKey,
        model,
        messages: [
          {
            role: "user",
            content: reviewPrompt(tiles),
            image: { mediaType: img.mediaType || "image/jpeg", data: img.data },
          },
        ],
      });
      const raw = extractJson(reply) as { verdict?: string; issues?: any[] } | null;
      const issues = (raw?.issues ?? []).slice(0, 8).map((i: any) => {
        const patch: Record<string, unknown> = {};
        for (const [k, v] of Object.entries((i?.patch ?? {}) as Record<string, unknown>)) {
          if (!PATCH_KEYS.has(k)) continue;
          if (k === "fontScale") patch[k] = Math.min(1.2, Math.max(0.5, Number(v) || 1));
          else if (typeof v === "string") patch[k] = v.slice(0, 160);
        }
        return { scene: Number(i?.scene), problem: String(i?.problem ?? "").slice(0, 200), patch };
      });
      return NextResponse.json({ verdict: raw?.verdict === "fix" ? "fix" : "good", issues });
    }

    return NextResponse.json({ error: "Unknown kind." }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "AI request failed." }, { status: 500 });
  }
}