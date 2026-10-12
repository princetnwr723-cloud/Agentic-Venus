/** Every agent reply ends with two tappable next steps. The model writes them as [[NEXT:one|two]]; the UI shows them as buttons. */
export const SUGGEST_PROMPT =
  `\n\nNEXT STEPS: End EVERY reply with exactly one last line [[NEXT:<suggestion 1>|<suggestion 2>]]. ` +
  `Two short commands (max 8 words each) that the owner can tap to continue. They are sent to you as the owner's next message, so write them as direct commands in the owner's language ` +
  `(for example: Send follow-up emails to all of them). Never suggest something you just did. Nothing after that line.`;

const RE = /\[\[NEXT:([\s\S]*?)\]\]/gi;

export function splitSuggestions(raw: string): { body: string; next: string[] } {
  const text = String(raw ?? "");
  let next: string[] = [];
  const body = text
    .replace(RE, (_m, inner: string) => {
      const items = String(inner).split("|").map((x) => x.replace(/^["'\s]+|["'\s]+$/g, "").slice(0, 90)).filter((x) => x.length >= 3);
      if (items.length) next = items.slice(0, 2);
      return "";
    })
    .replace(/\[\[NEXT:[\s\S]*$/i, "") // an unfinished marker while the answer is still streaming
    .trim();
  return { body, next };
}

export function withNext(text: string, items: string[]): string {
  const clean = items.map((x) => x.replace(/[|[\]]/g, " ").replace(/\s+/g, " ").trim()).filter((x) => x.length >= 3).slice(0, 2);
  return clean.length ? `${text}\n[[NEXT:${clean.join("|")}]]` : text;
}
