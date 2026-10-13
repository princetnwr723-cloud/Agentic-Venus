// Server-only. image.generate: makes an image with the owner's OpenAI key, stores it privately in Supabase
// and returns a markdown line ("![alt](vimg:path)") that the chat renders as a picture.
import type { Def } from "./plugins";
import { getExistingOpenAIKey } from "@/lib/voice-utils";
import { createSignedUpload, supabaseConfigured } from "@/lib/supabase-server";

const s = (v: unknown, n = 4000) => String(v ?? "").trim().slice(0, n);

const SIZES: Record<string, [string, string]> = {
  square: ["1024x1024", "1024x1024"],
  landscape: ["1536x1024", "1792x1024"],
  portrait: ["1024x1536", "1024x1792"],
};

async function generate(key: string, prompt: string, shape: string): Promise<Buffer> {
  const t0 = Date.now();
  const [sizeA, sizeB] = SIZES[shape] ?? SIZES.square;
  const attempts: Array<{ model: string; size: string; extra: Record<string, unknown>; ms: number }> = [
    { model: "gpt-image-1", size: sizeA, extra: {}, ms: 38_000 },
    { model: "dall-e-3", size: sizeB, extra: { response_format: "b64_json" }, ms: 0 },
  ];
  const errors: string[] = [];
  for (const a of attempts) {
    const ms = a.ms || Math.max(10_000, 56_000 - (Date.now() - t0));
    try {
      const r = await fetch("https://api.openai.com/v1/images/generations", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: a.model, prompt, size: a.size, n: 1, ...a.extra }),
        signal: AbortSignal.timeout(ms),
      });
      const j = (await r.json().catch(() => ({}))) as { data?: Array<{ b64_json?: string }>; error?: { message?: string } };
      const b64 = j.data?.[0]?.b64_json;
      if (r.ok && b64) return Buffer.from(b64, "base64");
      errors.push(`${a.model}: ${s(j.error?.message ?? r.status, 160)}`);
    } catch (e) {
      errors.push(`${a.model}: ${e instanceof Error ? e.message.slice(0, 100) : "failed"}`);
    }
  }
  throw new Error(`Image generation failed (${errors.join(" | ")}).`);
}

export const VISUAL_TOOLS: Def[] = [
  {
    name: "image.generate", risk: "read",
    params: "prompt:string (detailed description), alt:string (short caption), shape?:square|landscape|portrait",
    description:
      "Create an image (illustration, logo idea, poster, product mockup, diagram-style picture) with the owner's OpenAI key. " +
      "Returns a markdown line: paste it UNCHANGED on its own line in your reply and the picture appears in the chat. " +
      "Costs a little money per image: generate only when a picture really helps, and at most 2 per reply.",
    run: async (a, _cred, ctx) => {
      if (!ctx) throw new Error("Images can only be created from a chat.");
      if (!supabaseConfigured()) throw new Error("Image storage is not set up: add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Vercel.");
      const prompt = s(a.prompt, 3500);
      if (prompt.length < 8) throw new Error("`prompt` must describe the image in detail.");
      const key = await getExistingOpenAIKey(ctx.uid);
      if (!key) throw new Error("No OpenAI key is saved. Tell the owner to add one under API keys to create images.");

      const bytes = await generate(key, prompt, s(a.shape, 12).toLowerCase());
      const path = `${ctx.uid}/images/${ctx.chatId}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}.png`;
      const up = await createSignedUpload(path);
      const r = await fetch(up, {
        method: "PUT",
        headers: { "Content-Type": "image/png", "x-upsert": "true" },
        body: new Blob([new Uint8Array(bytes)]),
        signal: AbortSignal.timeout(20_000),
      });
      if (!r.ok) throw new Error(`Could not save the image (storage HTTP ${r.status}).`);
      const alt = (s(a.alt, 100) || prompt.slice(0, 80)).replace(/[\[\]()\n]/g, " ").replace(/\s+/g, " ").trim();
      return `IMAGE READY. Paste this line unchanged on its own line in your reply:\n![${alt}](vimg:${path})`;
    },
  },
];