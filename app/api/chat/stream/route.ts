import { streamProvider, type ChatMsg } from "@/lib/ai-providers-server";
import type { ProviderId } from "@/lib/providers";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body?.apiKey || !body.provider || !body.model) {
    return Response.json({ error: "Missing provider, model or API key." }, { status: 400 });
  }
  const msgs: ChatMsg[] = Array.isArray(body.messages) ? body.messages : [];
  const messages: ChatMsg[] = body.systemPrompt ? [{ role: "system", content: String(body.systemPrompt) }, ...msgs] : msgs;
  return new Response(
    streamProvider({ provider: body.provider as ProviderId, apiKey: String(body.apiKey), model: String(body.model), messages }),
    { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" } }
  );
}