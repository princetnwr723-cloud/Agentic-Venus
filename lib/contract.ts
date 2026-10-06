// Turns the request into a checkable contract ("100 leads" = 100 VERIFIED leads). The runner enforces it.
export type Contract = {
  kind: "list" | "other"; quota: number; item: string; fields: string[]; criteria: string[]; verify: "leads" | "facts" | "urls" | "none";
};
export const NO_CONTRACT: Contract = { kind: "other", quota: 0, item: "", fields: [], criteria: [], verify: "none" };

const LEAD_FIELDS = ["name", "company", "role", "email", "website", "source_url"];
const LEADISH = /^(leads?|prospects?|companies|contacts?|emails?|startups?|businesses|clients?|customers?|agencies|founders?|ceos?|restaurants?|stores?|shops?|profiles?)$/i;

function heuristic(task: string): Contract | null {
  const m = /\b(\d{1,4})\s+(?:[\w&-]+\s+){0,3}?(leads?|prospects?|companies|contacts?|emails?|startups?|businesses|clients?|customers?|agencies|founders?|ceos?|listings?|products?|results?|articles?|jobs?|profiles?|restaurants?|stores?|shops?)\b/i.exec(task);
  if (!m) return null;
  const quota = Number(m[1]);
  if (!Number.isFinite(quota) || quota < 3) return null;
  const leadish = LEADISH.test(m[2]);
  return {
    kind: "list", quota: Math.min(quota, 300), item: leadish ? "lead" : m[2].toLowerCase().replace(/ies$/, "y").replace(/s$/, ""),
    fields: leadish ? LEAD_FIELDS : ["title", "url", "source_url"], criteria: [], verify: leadish ? "leads" : "urls",
  };
}

const SYS = `You turn a user's request into a checkable deliverable contract. Reply with ONE JSON object only:
{"kind":"list"|"other","quota":number,"item":"lead|company|product|...","fields":["..."],"criteria":["short must-match rules from the request, e.g. 'B2B SaaS', 'in India', 'founder or CEO'"],"verify":"leads"|"urls"|"none"}
- kind "list" ONLY when the user wants a number of items collected (leads, companies, contacts, listings, products...). Numbers can be words ("hundred", "ten").
- verify "leads" when the items are people/companies/contacts; "urls" for other lists; "none" for other kinds.`;

export async function extractContract(llm: (system: string, prompt: string) => Promise<string>, task: string): Promise<Contract> {
  const h = heuristic(task);
  try {
    const raw = await llm(SYS, task.slice(0, 1500));
    const a = raw.indexOf("{"), b = raw.lastIndexOf("}");
    const j = a >= 0 && b > a ? (JSON.parse(raw.slice(a, b + 1)) as Partial<Contract>) : {};
    const isList = j.kind === "list" || Boolean(h);
    if (!isList) return NO_CONTRACT;
    const quota = Math.min(300, Math.max(1, h?.quota ?? Number(j.quota) || 0));
    if (!quota) return h ?? NO_CONTRACT;
    const verify = (h?.verify ?? (["leads", "urls"].includes(String(j.verify)) ? j.verify : "urls")) as Contract["verify"];
    const fields = Array.isArray(j.fields) && j.fields.length ? j.fields.map(String).slice(0, 10) : verify === "leads" ? LEAD_FIELDS : ["title", "url", "source_url"];
    return {
      kind: "list", quota, item: String(h?.item ?? j.item ?? "item").slice(0, 30), fields,
      criteria: (Array.isArray(j.criteria) ? j.criteria : []).map(String).slice(0, 6), verify,
    };
  } catch {
    return h ?? NO_CONTRACT;
  }
}

export function contractPrompt(c: Contract): string {
  const evidence = `EVIDENCE RULE: every fact in your final summary must come from a page you actually opened. Use the tool verify.facts for the important claims ({"claims":[{"claim":"...","source_url":"..."}]}). If you could not confirm something, say so instead of guessing.`;
  if (c.kind !== "list") return `\n\n${evidence}`;
  const leads = c.verify === "leads";
  const tool = leads ? "verify.leads" : "verify.urls";
  const example = leads
    ? '{"items":[{"name":"Asha Rao","company":"Acme Pvt Ltd","role":"CEO","email":"asha@acme.com","website":"https://acme.com","source_url":"https://acme.com/team"}]}'
    : '{"urls":["https://example.com/a"]}';
  return `\n\nDELIVERABLE CONTRACT (the request made checkable; the system enforces it):
- Deliver ${c.quota} VERIFIED items (${c.item}). Fields per item: ${c.fields.join(", ")}.${c.criteria.length ? "\n- Every item must match: " + c.criteria.join("; ") : ""}
- Work in rounds: collect about ${Math.ceil(c.quota * 1.6)} candidates from real pages (company sites, team/about/contact pages, public directories). For EVERY candidate keep the page URL where you saw it as source_url.
- Then call the tool ${tool} in batches of at most 10. Example: {"type":"tool","name":"${tool}","args":${example}}
- Only items the tool marks "verified" count. NEVER change a rejected item to make it pass. Never invent or guess emails, names, websites or sources: leave the email empty if you did not see one on a page.
- Keep sourcing and verifying until ${c.quota} are verified. The system keeps the count, builds the final CSV file itself and will not let you finish early. If you truly cannot find enough, finish with fewer and say so honestly.
${evidence}`;
}