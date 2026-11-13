// Automatic mode. With it ON the agent does not ask before ordinary actions (send the mail, post, push, save the file).
// Two things still stop and ask, because a wrong guess there cannot be undone:
//   1) the agent has read untrusted web / mail / file text in this run (it might be steered by a prompt injection)
//   2) the action moves money or destroys something (pay, buy, delete, cancel, transfer ...)
// Secrets, captchas and real questions still need the owner: nobody else knows them.
export type AutoVerdict = "approve" | "ask";

const DANGER = /\b(delete|remove|erase|destroy|drop|wipe|purge|purchase|buy|order|pay|payment|payments|checkout|charge|refund|transfer|wire|withdraw|donate|subscribe|unsubscribe|cancel|revoke|terminate|format|overwrite|force push|reset hard|invoice)\b/i;
const MONEY = /([$€£₹]\s?\d|\b\d[\d,.]*\s?(usd|eur|gbp|inr|rs|rupees?|dollars?|euros?)\b)/i;

export function autoDecision(name: string, summary: string, tainted: boolean, args?: Record<string, unknown>): AutoVerdict {
  if (tainted) return "ask";
  const text = `${name} ${summary} ${args ? JSON.stringify(args).slice(0, 600) : ""}`.replace(/[._\-]+/g, " ");
  if (DANGER.test(text) || MONEY.test(text)) return "ask";
  return "approve";
}

export const AUTO_NOTE = "AUTOMATIC MODE: the owner is not watching and wants the job finished without questions. Decide yourself with good judgement, do not ask for confirmation, and say what you assumed in the final answer. Use ask_user only when a fact is truly missing and no tool can find it.";
export const AUTO_APPROVED_TEXT = "The owner has Automatic mode on, so this is APPROVED. Go ahead with exactly what you described.";
