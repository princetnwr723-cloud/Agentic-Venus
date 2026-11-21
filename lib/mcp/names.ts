// Tool names. MCP clients (Claude, ChatGPT) accept only letters, digits, "_" and "-" (max 64 characters), while Venus
// names look like "web.search". The mapping is stateless: the first "." becomes "__" and back, so tools/call needs no lookup.

export const toNative = (name: string) => name.replace(/\./g, "__");

export function fromNative(native: string): string {
  const i = native.indexOf("__");
  return i < 0 ? native : native.slice(0, i) + "." + native.slice(i + 2);
}

/** A tool is listed only when its name survives the round trip and the client accepts it. */
export function listable(name: string): boolean {
  const n = toNative(name);
  return /^[A-Za-z0-9_-]{1,64}$/.test(n) && fromNative(n) === name;
}

/**
 * Tools that must never be reachable from outside the AgenticVenus app.
 * connect.* would pass API keys and tokens through another company's chat.
 * Extra prefixes: MCP_BLOCKED_TOOLS="mission.,voice." (comma separated, in Vercel).
 */
export function isBlocked(name: string, extra = ""): boolean {
  const prefixes = ["connect.", ...extra.split(",").map((s) => s.trim()).filter(Boolean)];
  return prefixes.some((p) => name.startsWith(p));
}
