// Helpers for the /vmaps screen. No imports, so the browser page and the node tests share the same code.
// The page calls the same vmaps.* tools the agent uses and turns their answer into a summary, a card and details.

export type Block = { kind: "vmap" | "vleads"; code: string };

/** Splits a tool answer into: one headline, the details, and the ```vmap / ```vleads block (drawn as a card). */
export function splitToolText(text: string): { summary: string; details: string; block: Block | null } {
  const m = /```(vmap|vleads)\n([\s\S]*?)\n```/.exec(text);
  const block: Block | null = m ? { kind: m[1] as Block["kind"], code: m[2] } : null;
  const lines = (m ? text.replace(m[0], "") : text)
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !/^(To show this map in the chat|The card has a table)/.test(l));
  return { summary: lines[0] ?? "", details: lines.slice(1).join("\n"), block };
}

/** vmaps.geocode answers with lines like "1. Name, address — lat 28.63, lon 77.21 [kind]". */
export function parseGeocodeLines(text: string): Array<{ name: string; lat: number; lon: number; note?: string }> {
  const out: Array<{ name: string; lat: number; lon: number; note?: string }> = [];
  for (const line of text.split("\n")) {
    const m = /^\d+\.\s+(.+?)\s+—\s+lat\s+(-?\d+(?:\.\d+)?),\s+lon\s+(-?\d+(?:\.\d+)?)/.exec(line.trim());
    if (!m) continue;
    const lat = Number(m[2]), lon = Number(m[3]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
    const cut = /^(.*?)(?:,\s+| \()(.*?)\)?$/.exec(m[1]);
    out.push({ name: (cut ? cut[1] : m[1]).slice(0, 80), lat, lon, note: cut ? cut[2].slice(0, 120) : undefined });
    if (out.length >= 10) break;
  }
  return out;
}

/** Only plain, short values reach the server tools from the screen. */
export function cleanArgs(input: unknown): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  if (!input || typeof input !== "object" || Array.isArray(input)) return out;
  for (const [k, v] of Object.entries(input as Record<string, unknown>).slice(0, 12)) {
    if (!/^[a-z_]{1,24}$/.test(k)) continue;
    if (typeof v === "string") out[k] = v.slice(0, 300);
    else if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
    else if (typeof v === "boolean") out[k] = v;
  }
  return out;
}
