/**
 * "connect canva", "can a connect kro", "notion mcp add karo", "disconnect canva",
 * "firecrawl mcp https://...", "stripe connect kro sk_live_...":
 * a SHORT message that only asks to connect (or disconnect) a service is handled by code, not by the model.
 * That way it works in the middle of other work and is never mixed into the task the agent was busy with.
 * Anything longer or unclear returns null and goes to the agent as usual.
 */
export type ConnectIntent = { kind: "connect" | "remove"; name: string; url?: string; key?: string };

const URL_RE = /https?:\/\/[^\s"'<>]+/i;
const KEY_RE = /\b(?:sk|pk|rk|fc|ghp|gho|ghs|xox[abp]|AKIA)[-_][A-Za-z0-9_-]{12,}\b|\b(?:sk|pk|rk|fc)[A-Za-z0-9_-]{24,}\b/;
const REMOVE = /\b(disconnect|unlink|hatao|hata\s?do|hata\s?de)\b/;
const CONNECT = /\b(connect|link|integrate|hook\s?up|jodo|jod\s?do|jod\s?de|add|install|setup|set\s?up|enable)\b/;
const WEAK = /\b(add|install|setup|set\s?up|enable)\b/;
const MCPWORD = /\b(mcp|connector|integration|server)\b/;

// words that carry no service name (verbs, politeness, Hinglish glue)
const FILL = new Set([
  "connect", "link", "integrate", "hook", "hookup", "up", "jodo", "jod", "add", "install", "setup", "set", "enable", "disconnect", "unlink", "hatao", "hata", "remove",
  "mcp", "server", "tool", "tools", "connector", "connectors", "integration", "app", "apps", "service", "the", "my", "please", "pls", "plz",
  "bhai", "yaar", "bro", "ye", "yeh", "is", "isko", "isse", "ko", "ka", "ki", "ke", "se", "bas", "ab", "abhi", "ek", "new", "naya", "na", "hi", "ji", "sir",
  "kro", "karo", "kar", "kr", "do", "dena", "de", "dedo", "lagao", "laga", "chalu", "you", "mere", "mera", "meri", "apne", "apna",
]);
// words that show this is NOT a plain "connect a service" request
const NOT_A_NAME = new Set([
  "to", "in", "on", "for", "and", "with", "from", "at", "into", "of", "then", "after", "before", "using", "about", "when", "if", "also", "that", "this", "it", "me", "i", "we",
  "database", "db", "internet", "wifi", "vpn", "ssh", "everything", "all", "agent", "chat", "pc", "computer", "project", "repo", "file", "files", "account", "phone",
  "research", "use", "fetch", "send", "make", "create", "write", "build", "find", "search", "analyze", "analyse", "run", "start", "open", "check", "read", "show", "tell",
]);

export function connectIntent(raw: string): ConnectIntent | null {
  const original = String(raw ?? "").trim();
  if (!original || original.length > 260 || original.startsWith("/") || original.includes("\n")) return null;

  const url = URL_RE.exec(original)?.[0]?.replace(/[.,;)\]]+$/, "");
  let work = url ? original.replace(url, " ") : original;
  const key = KEY_RE.exec(work)?.[0];
  if (key) work = work.replace(key, " ");

  const rest = work.replace(/[.,!?;:"“”()]/g, " ").replace(/\s+/g, " ").trim().toLowerCase().replace(/^(?:can|could|will|would)\s+you\s+/, "");
  const words = rest.split(" ").filter(Boolean);
  if (!words.length || words.length > 12) return null;

  const remove = REMOVE.test(rest);
  const connect = CONNECT.test(rest);
  const mcpWord = MCPWORD.test(rest);
  // "add / install / setup" alone is too vague ("add milk"): it needs the word mcp / connector / integration / server, or an address.
  const weakOnly = connect && !remove && WEAK.test(rest) && !/\b(connect|link|integrate|hook\s?up|jodo|jod)\b/.test(rest);
  if (remove) { /* ok */ }
  else if (connect) { if (weakOnly && !mcpWord && !url) return null; }
  else if (!(url && mcpWord)) return null; // "firecrawl mcp https://..." without any verb is still a connect

  const extraFill = key ? new Set(["api", "key", "token", "apikey"]) : new Set<string>();
  const name = words.filter((w) => !FILL.has(w) && !extraFill.has(w));
  if (name.some((w) => NOT_A_NAME.has(w) || !/^[\w.+-]{1,24}$/.test(w))) return null;
  if (name.length > 3) return null;
  const joined = name.join(" ");
  if (!joined && !url) return null;
  if (key && !joined) return null;

  return { kind: remove ? "remove" : "connect", name: joined, ...(url ? { url } : {}), ...(key ? { key } : {}) };
}
