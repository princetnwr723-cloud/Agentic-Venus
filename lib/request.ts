import { authFromRequest } from "@/lib/job-token";
import { resolveDeep } from "@/lib/vault";

const DEFAULT_MAX_BODY_BYTES = 2 * 1024 * 1024;

async function readBoundedText(req: Request, maxBytes: number): Promise<string> {
  const declared = Number(req.headers.get("content-length") || 0);
  if (declared > maxBytes) throw new Error(`Request body is too large (maximum ${maxBytes} bytes).`);
  if (!req.body) return "";

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new Error(`Request body is too large (maximum ${maxBytes} bytes).`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { merged.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder("utf-8", { fatal: true }).decode(merged);
}

/**
 * Authenticated JSON body parser used by API routes.
 * - Enforces a hard body-size limit before parsing.
 * - Rejects malformed JSON and non-object payloads.
 * - Forces uid to the verified identity and resolves vault references server-side.
 */
export async function readBody(req: Request, opts: { allowJob?: boolean; maxBytes?: number } = {}): Promise<any> {
  const rawText = await readBoundedText(req, opts.maxBytes ?? DEFAULT_MAX_BODY_BYTES);
  let raw: unknown = {};
  if (rawText.trim()) {
    try { raw = JSON.parse(rawText); }
    catch { throw new Error("Request body must contain valid JSON."); }
  }
  if (raw !== null && (typeof raw !== "object" || Array.isArray(raw))) {
    throw new Error("Request body must be a JSON object.");
  }
  const input = (raw ?? {}) as Record<string, unknown>;
  const auth = await authFromRequest(req, input.uid);
  if (auth.job && !opts.allowJob) throw new Error("Background-job tokens are not accepted on this endpoint.");
  const body = await resolveDeep(auth.uid, input) as Record<string, any>;
  body.uid = auth.uid;
  if (auth.job && auth.chatId) body.chatId = auth.chatId;
  return body;
}
