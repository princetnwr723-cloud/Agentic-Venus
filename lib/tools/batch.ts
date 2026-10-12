export type Item = Record<string, unknown>;

export function itemsOf(v: unknown, max: number): Item[] {
  if (!Array.isArray(v)) throw new Error("`items` must be an array.");
  const list = v.filter((x): x is Item => Boolean(x) && typeof x === "object" && !Array.isArray(x)).slice(0, max);
  if (!list.length) throw new Error("`items` is empty.");
  return list;
}

/** Runs one item after the other inside a time budget and reports every result (so a long list never silently stops). */
export async function eachItem(list: Item[], fn: (it: Item) => Promise<string>, budgetMs = 45_000, gapMs = 200): Promise<string> {
  const t0 = Date.now();
  const out: string[] = [];
  let ok = 0;
  for (let i = 0; i < list.length; i++) {
    if (Date.now() - t0 > budgetMs) { out.push(`… ${list.length - i} not sent (out of time): send these again`); break; }
    try { out.push(`✓ ${await fn(list[i])}`); ok++; }
    catch (e) { out.push(`✗ item ${i + 1}: ${e instanceof Error ? e.message.slice(0, 160) : "failed"}`); }
    if (gapMs) await new Promise((r) => setTimeout(r, gapMs));
  }
  return `${ok}/${list.length} done.\n${out.join("\n")}`;
}
