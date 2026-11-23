import { authFromRequest, verifyJobToken } from "@/lib/job-token";
import { resolveDeep } from "@/lib/vault";
import { rateLimitOn, retryAfterSeconds, sharedLimiter, userRuleFor } from "@/lib/rate-limit";

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

/**
 * Per signed-in user and route family (see lib/rate-limit.ts for the numbers). Background-job tokens are not counted: they are started
 * by the server and are already bounded by the plan, the run cost cap and the computer-time limit.
 * Routes that read their own body (vPassword) call this directly.
 */
export function enforceUserLimit(req: Request, uid: string, isJob = false): void {
  if (isJob || !rateLimitOn()) return;
  let path = "/";
  try { path = new URL(req.url).pathname; } catch { /* a request without a usable address is counted under the default rule */ }
  const rule = userRuleFor(path);
  const h = sharedLimiter().hit(`u:${uid}:${rule.name}`, rule);
  if (!h.ok) throw new RequestError(`Too many requests. Please wait ${retryAfterSeconds(h.retryAfterMs)} seconds and try again.`, 429);
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
 * - FALLBACK provider keys are resolved one by one: a fallback key that can no longer be opened is dropped,
 *   it never breaks the whole request (the main key still fails loudly, with its name).
 */
/** `allowJob`: true = any background-job token; a string = only job tokens whose job id starts with it (Venus Pro runs use "vpro"). */
export async function readBody(req: Request, opts: { allowJob?: boolean | string; maxBytes?: number } = {}): Promise<any> {
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
  enforceUserLimit(req, auth.uid, Boolean(auth.job));
  if (auth.job && typeof opts.allowJob === "string") {
    const j = verifyJobToken((req.headers.get("authorization") || "").replace(/^Bearer\s+/i, ""));
    if (!j || !j.jobId.startsWith(opts.allowJob)) throw new RequestError("This background-job token is not accepted on this endpoint.", 403);
  }

  const fallbacks = Array.isArray(input.fallbacks) ? (input.fallbacks as unknown[]) : null;
  const rest: Record<string, unknown> = { ...input };
  if (fallbacks) delete rest.fallbacks;
  const body = (await resolveDeep(auth.uid, rest)) as Record<string, any>;
  if (fallbacks) {
    const usable: unknown[] = [];
    for (const f of fallbacks.slice(0, 3)) {
      try { usable.push(await resolveDeep(auth.uid, f)); } catch { /* unreadable fallback key: skipped */ }
    }
    body.fallbacks = usable;
  }
  body.uid = auth.uid;
  if (auth.job && auth.chatId) body.chatId = auth.chatId;
  return body;
}