// Risk classifier for approvals. PURE: no imports, no network, no database (tested with node --test).
//
// It replaces the old keyword-only rule of Automatic mode. It looks at four things:
//   1. what the tool DOES      (destroys something? moves money? sends something outside?)
//   2. who gets it             (recipients outside the owner's own addresses / domains)
//   3. WHAT is in it           (keys, passwords, card / ID numbers, "confidential", bulk contact lists)
//   4. whether the run is tainted (it read text that tried to give the agent orders)
// and returns a decision plus plain reasons, so the approval card can say WHY it stopped.
// Rule that matters most: sensitive content that is about to leave to the outside never goes out on its own.

export type RiskLevel = "low" | "medium" | "high";
export type Finding = { kind: string; label: string; secret: boolean };
export type RiskInput = {
  name: string;
  summary: string;
  args?: Record<string, unknown>;
  tainted?: boolean;
  /** the owner's own e-mail domains / addresses: mail to these is "inside" (optional; without them every recipient counts as outside) */
  ownerDomains?: string[];
  ownerEmails?: string[];
};
export type RiskResult = {
  level: RiskLevel;
  decision: "approve" | "ask";
  reasons: string[];
  findings: Finding[];
  outside: string[];
  outbound: boolean;
};

const DANGER_WORDS = /\b(delete|remove|erase|destroy|drop|wipe|purge|purchase|buy|order|pay|payment|payments|checkout|charge|refund|transfer|wire|withdraw|donate|subscribe|unsubscribe|cancel|revoke|terminate|format|overwrite|force push|reset hard|invoice|kharid\w*|khareed\w*|bhugtan|paise\s+bhej\w*|paisa\s+bhej\w*|delete\s+kar\w*|hata\s+do|transfer\s+kar\w*|cancel\s+kar\w*|order\s+kar\w*|payment\s+kar\w*)\b/i;
const MONEY = /([$€£₹]\s?\d|\b\d[\d,.]*\s?(usd|eur|gbp|inr|rs|rupees?|rupaye|rupay|rupiya|paise|dollars?|euros?)\b)/i;
// A tool that hands something to someone / somewhere outside this system.
const OUTBOUND_NAME = /\b(send|send many|post|reply|publish|share|tweet|upload|forward|broadcast|notify|message|sms|whatsapp|email|mail|slackbot|webhook|put files|push|call|dm)\b/i;
const COMMS_NAME = /\b(send|send many|post|reply|publish|share|tweet|forward|broadcast|notify|message|sms|whatsapp|email|mail|slackbot|draft|dm)\b/i;

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const PHONE_RE = /(?<![\w.])\+?\d[\d\s().-]{8,16}\d(?![\w.])/g;

/** Luhn check for card numbers. */
export function luhn(digits: string): boolean {
  if (!/^\d{13,19}$/.test(digits)) return false;
  let sum = 0, dbl = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (dbl) { d *= 2; if (d > 9) d -= 9; }
    sum += d; dbl = !dbl;
  }
  return sum % 10 === 0;
}

const SECRET_PATTERNS: Array<[string, string, RegExp]> = [
  ["private-key", "a private key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ["api-key", "an API key or access token", /\b(sk-ant-[A-Za-z0-9_-]{16,}|sk-[A-Za-z0-9]{24,}|AIza[0-9A-Za-z_-]{30,}|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|xox[abprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|xai-[A-Za-z0-9]{20,}|glpat-[A-Za-z0-9_-]{16,})\b/],
  ["jwt", "a login token (JWT)", /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/],
  ["password", "a password or secret value", /\b(password|passwd|pwd|passcode|secret|api[ _-]?key|token|client[ _-]?secret)\s*(?:is\s*[:=]?|[:=])\s*["']?[^\s"',;]{6,}/i],
];
const ID_PATTERNS: Array<[string, string, RegExp]> = [
  ["aadhaar", "an Aadhaar-style ID number", /(?<![\d-])[2-9]\d{3}[ -]\d{4}[ -]\d{4}(?![\d-])/],
  ["pan", "a PAN-style tax ID", /\b[A-Z]{5}\d{4}[A-Z]\b/],
  ["ssn", "a social-security-style number", /(?<![\d-])\d{3}-\d{2}-\d{4}(?![\d-])/],
  ["iban", "a bank account number (IBAN)", /\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/],
];
const CONFIDENTIAL = /\b(confidential|internal use only|internal only|do not (share|forward|distribute)|under nda|non-?disclosure|privileged|proprietary|not for (distribution|external|public)|attorney[- ]client|term sheet|board deck|payroll|salary|salaries|cap table|source code)\b/i;

/** Finds sensitive content. It never returns the value itself, only what kind of thing it is. */
export function scanSensitive(text: string): Finding[] {
  const t = String(text ?? "").slice(0, 60_000);
  const out: Finding[] = [];
  const add = (kind: string, label: string, secret: boolean) => { if (!out.some((f) => f.kind === kind)) out.push({ kind, label, secret }); };
  for (const [k, l, re] of SECRET_PATTERNS) if (re.test(t)) add(k, l, true);
  for (const m of t.matchAll(/(?<![\d-])(?:\d[ -]?){13,19}(?![\d-])/g)) {
    const d = m[0].replace(/[ -]/g, "");
    if (luhn(d)) { add("card", "a payment card number", true); break; }
  }
  for (const [k, l, re] of ID_PATTERNS) if (re.test(t)) add(k, l, false);
  if (CONFIDENTIAL.test(t)) add("confidential", "text marked confidential / internal", false);
  const mails = new Set((t.match(EMAIL_RE) ?? []).map((e) => e.toLowerCase()));
  if (mails.size >= 8) add("contact-list", `a list of ${mails.size} e-mail addresses`, false);
  return out;
}

const flat = (v: unknown, depth = 0): string => {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (depth > 3) return "";
  if (Array.isArray(v)) return v.slice(0, 50).map((x) => flat(x, depth + 1)).join("\n");
  if (typeof v === "object") return Object.values(v as Record<string, unknown>).slice(0, 50).map((x) => flat(x, depth + 1)).join("\n");
  return "";
};

/** Who the action is addressed to: e-mail addresses and phone numbers found in the arguments and the summary. */
export function recipientsOf(input: Pick<RiskInput, "summary" | "args">): string[] {
  const keys = ["to", "cc", "bcc", "recipients", "recipient", "email", "emails", "phone", "number", "numbers", "channel", "target"];
  const parts: string[] = [input.summary ?? ""];
  for (const k of keys) if (input.args && k in input.args) parts.push(flat(input.args[k]));
  const text = parts.join("\n");
  const found = new Set<string>();
  for (const e of text.match(EMAIL_RE) ?? []) found.add(e.toLowerCase());
  for (const p of text.match(PHONE_RE) ?? []) { const d = p.replace(/\D/g, ""); if (d.length >= 10) found.add("+" + d); }
  return [...found];
}

const isInside = (r: string, o: RiskInput): boolean => {
  const mails = (o.ownerEmails ?? []).map((x) => x.toLowerCase());
  const doms = (o.ownerDomains ?? []).map((x) => x.toLowerCase().replace(/^@/, ""));
  if (mails.includes(r)) return true;
  const at = r.lastIndexOf("@");
  return at > 0 && doms.includes(r.slice(at + 1));
};

const words = (s: string) => s.replace(/[._\-:/]+/g, " ");

export function classifyAction(input: RiskInput): RiskResult {
  const name = words(input.name || "");
  const summary = String(input.summary ?? "");
  const outbound = OUTBOUND_NAME.test(name);
  const comms = COMMS_NAME.test(name);
  const argText = flat(input.args).slice(0, 20_000);
  const reasons: string[] = [];
  let hard = false;     // something that always needs a human
  let soft = 0;         // reasons that are only worth a note

  if (input.tainted) { hard = true; reasons.push("the agent read text from outside that tried to give it orders"); }

  // 1) what the tool does. A mail BODY that happens to say "cancel" must not stop the run: for messages only the tool name and
  //    the one-line summary count, for every other tool the arguments count as well.
  const doing = comms ? `${name} ${summary}` : `${name} ${summary} ${argText.slice(0, 600)}`;
  const danger = DANGER_WORDS.exec(doing);
  if (danger) { hard = true; reasons.push(`it looks like "${danger[0].toLowerCase()}" (money, delete or another step that cannot be undone)`); }
  else if (MONEY.test(`${summary} ${comms ? "" : argText.slice(0, 600)}`)) { hard = true; reasons.push("it mentions an amount of money"); }
  else if (comms && MONEY.test(argText)) { hard = true; reasons.push("the message talks about an amount of money"); }

  // 2) who gets it
  const rcpts = outbound ? recipientsOf(input) : [];
  const outside = rcpts.filter((r) => !isInside(r, input));
  const unknownAudience = outbound && rcpts.length === 0 && /\b(post|publish|share|tweet|upload|broadcast|webhook)\b/i.test(name);
  const leaves = outside.length > 0 || unknownAudience;

  // 3) what is in it
  const findings = scanSensitive(`${summary}\n${argText}`);
  const secrets = findings.filter((f) => f.secret);
  const other = findings.filter((f) => !f.secret);

  if (secrets.length) {
    // keys, passwords and card numbers never leave or get saved on an automatic OK
    hard = true;
    reasons.push(`it contains ${secrets.map((f) => f.label).join(" and ")}`);
  }
  if (other.length) {
    if (outbound && leaves) { hard = true; reasons.push(`it contains ${other.map((f) => f.label).join(" and ")} and goes to ${outside.length ? "someone outside (" + outside.slice(0, 3).join(", ") + (outside.length > 3 ? ", …" : "") + ")" : "a public place"}`); }
    else soft++;
  }
  if (outbound && outside.length > 25) { hard = true; reasons.push(`it goes to ${outside.length} people at once`); }
  else if (outbound && outside.length > 0 && !hard) soft++;

  const level: RiskLevel = hard ? "high" : soft > 0 ? "medium" : "low";
  return { level, decision: hard ? "ask" : "approve", reasons, findings, outside, outbound };
}

/** One short note for the approval card ("Why this needs you: ..."), or "" when there is nothing to say. */
export function riskNote(input: RiskInput): string {
  const r = classifyAction(input);
  return r.reasons.length ? `⚠ Check before you approve: ${r.reasons.join("; ")}.` : "";
}
