// Catches the one thing that must never happen: the agent says "email sent" but no email was really sent.
type M = { role: string; content: string };

const CLAIM =
  /(e-?mails?|mails?)\b[^.\n]{0,60}\b(sent|delivered|bhej\s?di\w*|bhej\s?diy\w*|ho\s?gay\w*)|\b(sent|delivered|bhej\s?di\w*|bhej\s?diy\w*)\b[^.\n]{0,60}\b(e-?mails?|mails?)\b|✅[^\n]{0,60}\b(e-?mails?|mails?)\b/i;
const NEG = /\b(not|nahi|never|couldn'?t|failed|unable)\b[^.\n]{0,25}\b(sent|bhej\w*|deliver\w*)/i;
const SEND_ASK = /\b(send|bhej\w*|mail|e-?mail|reply|follow\s?-?up)\b/i;
const OK = /EMAIL SENT to|MAIL REPORT: [1-9]\d* sent|Emails? sent to /;
const BAD = /EMAIL NOT SENT|NOTHING WAS SENT|MAIL REPORT: 0 sent|NOT SENT AGAIN/;

export function mailGuardNote(messages: M[], output: string): string {
  const sys = messages[0];
  if (!sys || sys.role !== "system" || !sys.content.includes("YOUR TOOLS. To call one")) return "";
  if (/\[\[TOOL:(mail|gmail|email)[._]/i.test(output)) return ""; // a real call is being made right now
  const text = output.replace(/\[\[[\s\S]*?\]\]/g, " ");
  if (!CLAIM.test(text) || NEG.test(text)) return "";

  let k = messages.length - 1;
  while (k >= 0 && !(messages[k].role === "user" && !/^(TOOL RESULTS:|NOT FINISHED)/.test(messages[k].content.trim()))) k--;
  if (k < 0) return "";
  const ask = messages[k].content;
  if (!SEND_ASK.test(ask) || /\?\s*$/.test(ask.trim())) return "";

  const after = messages.slice(k + 1).filter((m) => m.role === "user").map((m) => m.content).join("\n");
  if (OK.test(after)) return "";
  if (BAD.test(after)) {
    return "⚠️ Correction: the mail tool reported that the email was NOT sent (failed or skipped as a duplicate). Nothing was delivered. Ask me to send it again, or say \"force\" to resend.";
  }
  return "⚠️ Not verified: no email tool ran in this step, so no email was actually sent. Say \"send it now\" and I will send it for real and show you the receipt.";
}

/** Puts the note before the [[NEXT:...]] buttons line when there is one. */
export function appendNote(reply: string, note: string): string {
  if (!note) return reply;
  const m = /(\[\[NEXT:[\s\S]*?\]\]\s*)$/.exec(reply);
  return m ? reply.slice(0, m.index).trimEnd() + "\n\n" + note + "\n" + m[1] : reply + "\n\n" + note;
}