import { waitUntil } from "@vercel/functions";
import { streamProvider, STREAM_ERROR_MARK, type ChatMsg } from "@/lib/ai-providers-server";
import { readBody, requestStatus } from "@/lib/request";
import { addTokens, assertTokens, estTokens } from "@/lib/billing-server";
import { mailGuardNote } from "@/lib/mail-guard";
import type { ProviderId } from "@/lib/providers";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  let body: any;
  try { body = await readBody(req); }
  catch (e) { return Response.json({ error: e instanceof Error ? e.message : "Not signed in." }, { status: requestStatus(e) }); }
  if (!body.apiKey || !body.provider || !body.model) return Response.json({ error: "Missing provider, model or API key." }, { status: 400 });

  try { await assertTokens(String(body.uid)); }
  catch (e) { return Response.json({ error: e instanceof Error ? e.message : "Limit reached." }, { status: requestStatus(e) }); }

  const msgs: ChatMsg[] = Array.isArray(body.messages) ? body.messages : [];
  const messages: ChatMsg[] = body.systemPrompt ? [{ role: "system", content: String(body.systemPrompt) }, ...msgs] : msgs;
  const inChars = messages.reduce((n, m) => n + String(m.content ?? "").length, 0);
  const uid = String(body.uid);

  const source = streamProvider({ provider: body.provider as ProviderId, apiKey: String(body.apiKey), model: String(body.model), messages });

  // count the answer while it streams, and charge the tokens when the stream ends
  let outBytes = 0;
  let acc = "";
  const dec = new TextDecoder();
  const counted = source.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        outBytes += chunk.byteLength;
        acc += dec.decode(chunk, { stream: true });
        controller.enqueue(chunk);
      },
      flush(controller) {
        // honesty guard: never let the agent claim "email sent" without a real receipt
        if (!acc.includes(STREAM_ERROR_MARK)) {
          const note = mailGuardNote(messages, acc);
          if (note) {
            const extra = "\n\n" + note;
            outBytes += extra.length;
            controller.enqueue(new TextEncoder().encode(extra));
          }
        }
        const job = addTokens(uid, estTokens(inChars + outBytes)).catch(() => {});
        try { waitUntil(job); } catch { /* not on Vercel */ }
      },
    })
  );

  return new Response(counted, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" } });
}