import { streamProvider, type ChatMsg } from "@/lib/ai-providers-server";
import { readBody, requestStatus } from "@/lib/request";
import type { ProviderId } from "@/lib/providers";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  let body: any;
  try { body = await readBody(req); }
  catch (e) { return Response.json({ error: e instanceof Error ? e.message : "Not signed in." }, { status: requestStatus(e) }); }
  if (!body.apiKey || !body.provider || !body.model) return Response.json({ error: "Missing provider, model or API key." }, { status: 400 });
  const msgs: ChatMsg[] = Array.isArray(body.messages) ? body.messages : [];
  const messages: ChatMsg[] = body.systemPrompt ? [{ role: "system", content: String(body.systemPrompt) }, ...msgs] : msgs;
  return new Response(
    streamProvider({ provider: body.provider as ProviderId, apiKey: String(body.apiKey), model: String(body.model), messages }),
    { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" } }
  );
}
