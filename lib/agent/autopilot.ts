// Automatic mode. With it ON the agent does not ask before ordinary actions (send the mail, post, push, save the file).
// Three things still stop and ask, because a wrong guess there cannot be undone:
//   1) the agent has read untrusted web / mail / file text in this run (it might be steered by a prompt injection)
//   2) the action moves money or destroys something (pay, buy, delete, cancel, transfer ...)
//   3) sensitive content (keys, passwords, card / ID numbers, \"confidential\" text) is about to leave to the outside (see risk.ts)
// Secrets, captchas and real questions still need the owner: nobody else knows them.
export type AutoVerdict = "approve" | "ask";

import { classifyAction, type RiskInput } from "./risk.ts";

/**
 * Decides whether Automatic mode may approve an ordinary action. The decision is made by the risk classifier (risk.ts):
 * it looks at what the tool does, who receives it and what is inside it, not only at keywords.
 */
export function autoDecision(name: string, summary: string, tainted: boolean, args?: Record<string, unknown>, extra?: Pick<RiskInput, "ownerDomains" | "ownerEmails">): AutoVerdict {
  return classifyAction({ name, summary, args, tainted, ...(extra ?? {}) }).decision;
}

export const AUTO_NOTE = "AUTOMATIC MODE: the owner is not watching and wants the job finished without questions. Decide yourself with good judgement, do not ask for confirmation, and say what you assumed in the final answer. Use ask_user only when a fact is truly missing and no tool can find it.";
export const AUTO_APPROVED_TEXT = "The owner has Automatic mode on, so this is APPROVED. Go ahead with exactly what you described.";
