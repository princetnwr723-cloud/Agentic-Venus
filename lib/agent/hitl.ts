// Human-in-the-loop. Four tools the MODEL can call to stop and ask the owner, plus the approval card for risky tools.
// A card pauses the run (nothing runs, nothing is billed) until the owner answers. Secrets never pass through the model:
// the owner types them into the card, they go straight to the encrypted vault and the model only gets a "vault:NAME" reference.
import type { Pending, PendingKind, Reply, ToolDef } from "./types.ts";

export const HITL_NAMES = ["ask_user", "request_approval", "request_secret", "request_takeover"] as const;
export type HitlName = (typeof HITL_NAMES)[number];
export const isHitlName = (n: string): n is HitlName => (HITL_NAMES as readonly string[]).includes(n);

export const PENDING_TTL_MS = 24 * 3600_000;
const clip = (v: unknown, n: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);

export const HITL_TOOLS: ToolDef[] = [
  {
    name: "ask_user", risk: "read",
    description: "Ask the owner ONE question when you truly cannot continue without the answer (a choice, a missing fact). Do not ask what you can find out with a tool. The task pauses until they answer.",
    schema: { type: "object", properties: { question: { type: "string", description: "the question, one or two sentences" }, options: { type: "array", items: { type: "string" }, description: "2-5 short answers the owner can tap (optional)" } }, required: ["question"] },
  },
  {
    name: "request_approval", risk: "read",
    description: "Before something important that cannot be undone and that no other tool asks about (spending money, deleting, telling a customer something). Say exactly what you are about to do. The task pauses until the owner approves or refuses.",
    schema: { type: "object", properties: { summary: { type: "string", description: "exactly what will happen if approved" } }, required: ["summary"] },
  },
  {
    name: "request_secret", risk: "read",
    description: "You need a password, API key or token that you do not have. The owner types it into a private box; you will only receive a reference like vault:NAME to pass to tools, never the value. NEVER ask the owner to write secrets in the chat.",
    schema: { type: "object", properties: { name: { type: "string", description: "short id, letters digits . _ - only, e.g. stripe_key" }, reason: { type: "string", description: "what it is for" } }, required: ["name", "reason"] },
  },
  {
    name: "request_takeover", risk: "read",
    description: "The Cloud PC screen needs a human (captcha, 2-step login, payment page, anything you cannot do). The owner takes over the screen, then hands it back. Say what they must do.",
    schema: { type: "object", properties: { reason: { type: "string", description: "what the owner has to do on the screen" } }, required: ["reason"] },
  },
];

export const safeSecretName = (v: unknown): string => String(v ?? "").toLowerCase().replace(/[^a-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);

const KIND: Record<HitlName, PendingKind> = { ask_user: "ask_user", request_approval: "request_approval", request_secret: "request_secret", request_takeover: "request_takeover" };

export function pendingFromHitl(call: { id: string; name: HitlName; input: Record<string, unknown> }, now: number, tainted = false): Pending {
  const i = call.input;
  const base = { id: `p${now.toString(36)}${Math.random().toString(36).slice(2, 5)}`, kind: KIND[call.name], toolUseId: call.id, name: call.name, createdAt: now, expiresAt: now + PENDING_TTL_MS, ...(tainted ? { tainted } : {}) };
  switch (call.name) {
    case "ask_user": {
      const options = Array.isArray(i.options) ? i.options.map((o) => clip(o, 60)).filter(Boolean).slice(0, 5) : [];
      return { ...base, summary: clip(i.question, 400), question: clip(i.question, 400), ...(options.length ? { options } : {}) };
    }
    case "request_approval": return { ...base, summary: clip(i.summary, 600) };
    case "request_secret": return { ...base, summary: clip(i.reason, 300), secretName: safeSecretName(i.name) || "secret" };
    default: return { ...base, summary: clip(i.reason, 400) };
  }
}

export function pendingFromApproval(call: { id: string; name: string; input: Record<string, unknown> }, summary: string, now: number, tainted: boolean): Pending {
  return {
    id: `p${now.toString(36)}${Math.random().toString(36).slice(2, 5)}`, kind: "approve_tool", toolUseId: call.id, name: call.name,
    summary: clip(summary, 1200), args: call.input, createdAt: now, expiresAt: now + PENDING_TTL_MS, ...(tainted ? { tainted: true } : {}),
  };
}

/** The tool result the model sees for a card the owner answered. */
export function resultFromReply(p: Pending, r: Reply): { content: string; isError: boolean } {
  if (r.action === "timeout") return { content: "The owner did not answer within 24 hours. Do not retry this. Finish what you can without it and say what is waiting for them.", isError: true };
  if (p.kind === "approve_tool") return r.action === "deny" ? { content: `The owner refused this action${r.note ? `: ${clip(r.note, 300)}` : ""}. Do not do it. Offer another way or stop.`, isError: true } : { content: "approved", isError: false };
  if (p.kind === "ask_user") return r.action === "answer" ? { content: `The owner answered: ${clip(r.text, 2000)}`, isError: false } : { content: "The owner did not want to answer. Continue with your best judgement and say what you assumed.", isError: false };
  if (p.kind === "request_approval") return r.action === "approve" ? { content: "The owner APPROVED. Go ahead with exactly what you described.", isError: false } : { content: `The owner REFUSED${r.action === "deny" && r.note ? `: ${clip(r.note, 300)}` : ""}. Do not do it.`, isError: true };
  if (p.kind === "request_secret") return r.action === "secret" ? { content: `Saved. Use it in tool arguments as vault:${r.name} (the value is never shown to you).`, isError: false } : { content: "The owner did not provide the secret. Continue without it or say what is blocked.", isError: true };
  if (r.action === "takeover_done") return { content: `The owner controlled the screen for ${Math.max(1, Math.round(r.seconds / 60))} min and handed it back${r.reason ? ` (${r.reason})` : ""}${r.note ? `: "${clip(r.note, 300)}"` : "."} Take a fresh look at the screen before you continue.`, isError: false };
  return { content: "The owner declined to take over. Continue another way or say what is blocked.", isError: true };
}
