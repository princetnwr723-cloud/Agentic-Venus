import { authFromRequest } from "@/lib/job-token";
import { resolveDeep } from "@/lib/vault";

const DEFAULT_MAX_BODY_BYTES = 2 * 1024 * 1024;

export class RequestError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = "RequestError";
  }
}

export function requestStatus(error: unknown, fallback = 500): number {
  if (error instanceof RequestError) return error.status;
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === "number" && status >= 400 && status <= 599 ? status : fallback;
}

async function readBoundedText(req: Request, maxBytes: number): Promise<string> {
  const declared = Number(req.headers.get("content-length") || 0);
  if (declared > maxBytes) throw new RequestError(`Request body is too large (maximum ${maxBytes} bytes).`, 413);
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
        throw new RequestError(`Request body is too large (maximum ${maxBytes} bytes).`, 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { merged.set(chunk, offset); offset += chunk.byteLength; }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(merged);
  } catch {
    throw new RequestError("Request body must be valid UTF-8 JSON.", 400);
  }
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
    catch { throw new RequestError("Request body must contain valid JSON.", 400); }
  }
  if (raw !== null && (typeof raw !== "object" || Array.isArray(raw))) {
    throw new RequestError("Request body must be a JSON object.", 400);
  }
  const input = (raw ?? {}) as Record<string, unknown>;
  let auth: Awaited<ReturnType<typeof authFromRequest>>;
  try {
    auth = await authFromRequest(req, input.uid);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Authentication failed.";
    const status = /not configured/i.test(message) ? 503 : 401;
    throw new RequestError(message, status);
  }
  if (auth.job && !opts.allowJob) throw new RequestError("Background-job tokens are not accepted on this endpoint.", 403);
  const body = await resolveDeep(auth.uid, input) as Record<string, any>;
  body.uid = auth.uid;
  if (auth.job && auth.chatId) body.chatId = auth.chatId;
  return body;
}
