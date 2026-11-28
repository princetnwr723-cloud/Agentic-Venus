
// Turns the many error texts of 11 providers into ONE typed answer, so the loop knows what to do:
// retry, switch provider, shrink the context, stop for the day, or tell the owner exactly what is wrong.

export type ErrorCode =
  | "context_exceeded" | "no_credit" | "usage_limit" | "unauthorized" | "model_not_found" | "rate_limited"
  | "overloaded" | "timeout" | "network" | "refused" | "bad_request" | "aborted" | "unknown";

export type Classified = {
  code: ErrorCode;
  /** the same request may work a moment later */
  retryable: boolean;
  /** another provider / model might work now */
  switchProvider: boolean;
  /** retrying or switching cannot fix it: the owner has to act */
  permanent: boolean;
  message: string;
  retryAfterMs?: number;
};

export class ProviderError extends Error {
  readonly status?: number;
  readonly retryAfterMs?: number;
  constructor(message: string, status?: number, retryAfterMs?: number) {
    super(message);
    this.name = "ProviderError";
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

const RULES: Array<[ErrorCode, RegExp]> = [
  ["aborted", /\b(aborted|abort(ed)?error|cancell?ed by user)\b/i],
  ["context_exceeded", /(context[_ ]length|context window|maximum context|prompt is too long|input is too long|too many tokens|exceeds? the (model'?s )?(maximum|context)|request too large|reduce the length)/i],
  // the account has no money left: waiting does not help, only the owner (or another provider) can
  // only clear "money is gone" wording: a bare "402" or "no credit" somewhere in a longer text must not count (Gemini's per-minute quota errors are not this)
  ["no_credit", /(insufficient[_ ](quota|balance|funds)|credit balance|out of credits?|(have|has) no credits?|no credits? (left|remaining)|credits? (are|is|have been) (depleted|exhausted)|prepayment credits?|balance is (too )?low|payment required|^402[\s:]|\s402:)/i],
  // a limit that resets by itself
  ["usage_limit", /(billing|quota exceeded|exceeded your current quota|usage limit|spend limit|monthly limit)/i],
  ["unauthorized", /(\b401\b|\b403\b|invalid[_ ]api[_ ]key|invalid x-api-key|incorrect api key|authentication|unauthori[sz]ed|permission[_ ]denied|api key not valid|forbidden)/i],
  ["model_not_found", /(\b404\b|model[^.]{0,40}(not found|does not exist|not available|deprecated)|not_found_error|unknown model|no such model)/i],
  ["rate_limited", /(\b429\b|rate[_ -]?limit|too many requests|requests per (minute|second)|tokens per minute|resource[_ ]exhausted)/i],
  ["overloaded", /(\b529\b|overloaded|\b50[0234]\b|unavailable|capacity|internal server error|bad gateway|try again later)/i],
  ["timeout", /(timeout|timed out|etimedout|deadline exceeded)/i],
  ["network", /(fetch failed|econn|socket|network|enotfound|eai_again|terminated|connection (reset|closed))/i],
  ["refused", /(content[_ ]policy|safety|refus(ed|al)|blocked|harm_category|prohibited)/i],
  ["bad_request", /(\b400\b|invalid[_ ]request|malformed|unprocessable|\b422\b)/i],
];

const TABLE: Record<ErrorCode, Omit<Classified, "code" | "message" | "retryAfterMs">> = {
  context_exceeded: { retryable: false, switchProvider: false, permanent: false },
  no_credit: { retryable: false, switchProvider: true, permanent: true },
  usage_limit: { retryable: false, switchProvider: true, permanent: true },
  unauthorized: { retryable: false, switchProvider: true, permanent: true },
  model_not_found: { retryable: false, switchProvider: true, permanent: true },
  rate_limited: { retryable: true, switchProvider: true, permanent: false },
  overloaded: { retryable: true, switchProvider: true, permanent: false },
  timeout: { retryable: true, switchProvider: true, permanent: false },
  network: { retryable: true, switchProvider: true, permanent: false },
  refused: { retryable: false, switchProvider: false, permanent: true },
  bad_request: { retryable: false, switchProvider: false, permanent: true },
  aborted: { retryable: false, switchProvider: false, permanent: true },
  unknown: { retryable: false, switchProvider: false, permanent: false },
};

/** "retry after 20 seconds", "try again in 1.5s", "retry-after: 30" -> milliseconds. */
export function parseRetryAfter(text: string): number | undefined {
  const m = /(?:retry[- ]after|try again in|please retry in)\D{0,6}(\d+(?:\.\d+)?)\s*(ms|milliseconds?|s|sec(?:onds?)?|m|min(?:utes?)?|h|hrs?|hours?)?/i.exec(text);
  if (!m) return undefined;
  const n = parseFloat(m[1]);
  const u = (m[2] ?? "s").toLowerCase();
  const ms = u.startsWith("ms") || u.startsWith("milli") ? n : u.startsWith("h") ? n * 3600_000 : u.startsWith("m") ? n * 60_000 : n * 1000;
  return Math.min(Math.round(ms), 6 * 3600_000);
}

export function classifyError(err: unknown, status?: number): Classified {
  const text = err instanceof Error ? err.message : typeof err === "string" ? err : JSON.stringify(err ?? "");
  const st = status ?? (err instanceof ProviderError ? err.status : (err as { status?: unknown } | null)?.status);
  const probe = `${typeof st === "number" ? st + " " : ""}${text}`;
  const code = RULES.find(([, re]) => re.test(probe))?.[0] ?? "unknown";
  const retryAfterMs = (err instanceof ProviderError ? err.retryAfterMs : undefined) ?? parseRetryAfter(text);
  return { code, ...TABLE[code], message: text.slice(0, 500) || "Unknown error", ...(retryAfterMs ? { retryAfterMs } : {}) };
}

/** What the owner reads. Short, says what to do. */
export function userMessage(c: Classified): string {
  switch (c.code) {
    case "no_credit": return "Your AI provider account has no credit left. Add credit at the provider (or pick another provider in Settings), then send the task again.";
    case "usage_limit": return "The AI provider's usage limit is reached. This task continues by itself when the limit resets.";
    case "unauthorized": return "The AI provider rejected the API key. Open Settings and save a valid key for this provider.";
    case "model_not_found": return "This model is not available on your provider account. Pick another model for this chat.";
    case "context_exceeded": return "The conversation is too long for this model even after trimming. Start a new chat or use a model with a bigger context.";
    case "rate_limited": return "The AI provider is rate limiting this key. It will try again shortly.";
    case "overloaded": return "The AI provider is overloaded right now. It will try again shortly.";
    case "timeout": case "network": return "The connection to the AI provider dropped. It will try again.";
    case "refused": return "The AI provider refused this request (content policy). Rephrase the task.";
    case "bad_request": return `The AI provider rejected the request: ${c.message.slice(0, 160)}`;
    case "aborted": return "Stopped.";
    default: return c.message.slice(0, 200);
  }
}

/** Waiting time before retry number `attempt` (0-based): exponential, respects Retry-After, never longer than `cap`. */
export function backoffMs(attempt: number, c: Classified, cap = 20_000): number {
  const base = 1500 * 2 ** attempt;
  return Math.min(cap, Math.max(base, c.retryAfterMs ?? 0));
}