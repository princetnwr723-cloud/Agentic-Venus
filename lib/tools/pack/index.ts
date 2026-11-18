// The Tool Pack: 1000+ small deterministic tools (text, math, stats, dates, units, validation, encode, colour, data / CSV / JSON,
// leads, finance, web + DNS helpers, computer recipes, work-field playbooks). They are found with tools.search and run by name.
import { searchPack, lev, type A, type PackTool } from "./core.ts";
import { TEXT_TOOLS } from "./text.ts";
import { MATH_TOOLS } from "./math.ts";
import { DATE_TOOLS } from "./dates.ts";
import { UNIT_TOOLS } from "./units.ts";
import { VALIDATE_TOOLS } from "./validate.ts";
import { ENCODE_TOOLS } from "./encode.ts";
import { DATA_TOOLS } from "./data.ts";
import { LEADS_TOOLS } from "./leads.ts";
import { FINANCE_TOOLS } from "./finance.ts";
import { WEB_TOOLS } from "./web.ts";
import { FIELD_TOOLS, FIELDS } from "./fields.ts";
import { PC_TOOLS, RECIPES } from "./recipes.ts";

type Run = (args: Record<string, unknown>, cred: string[], ctx?: unknown) => Promise<string>;
export type MetaDef = { name: string; description: string; params: string; risk: "read"; run: Run };

export const PACK: PackTool[] = (() => {
  const all = [...TEXT_TOOLS, ...MATH_TOOLS, ...DATE_TOOLS, ...UNIT_TOOLS, ...VALIDATE_TOOLS, ...ENCODE_TOOLS, ...DATA_TOOLS, ...LEADS_TOOLS, ...FINANCE_TOOLS, ...WEB_TOOLS, ...FIELD_TOOLS, ...PC_TOOLS];
  const seen = new Set<string>();
  const out: PackTool[] = [];
  for (const t of all) { if (seen.has(t.name)) throw new Error(`Duplicate pack tool name: ${t.name}`); seen.add(t.name); out.push(t); }
  return out;
})();
export const PACK_MAP = new Map(PACK.map((t) => [t.name, t]));

// Names people (and models) naturally guess. They point at the real tool.
export const ALIASES: Record<string, string> = {
  "pdf.create": "file.pdf", "pdf.make": "file.pdf", "pdf.write": "file.pdf", "doc.pdf": "file.pdf",
  "docx.create": "file.docx", "word.create": "file.docx", "doc.create": "file.docx", "doc.word": "file.docx",
  "xlsx.create": "file.xlsx", "excel.create": "file.xlsx", "sheet.create": "file.xlsx", "spreadsheet.create": "file.xlsx",
  "pptx.create": "file.pptx", "ppt.create": "file.pptx", "slides.create": "file.pptx", "powerpoint.create": "file.pptx",
  "zip.create": "file.zip", "csv.create": "file.csv", "text.create": "file.create", "txt.create": "file.create", "html.create": "file.create", "md.create": "file.create", "json.create": "file.create",
  "calc": "math.calc", "calculator": "math.calc", "calculate": "math.calc", "math.eval": "math.calc", "math.evaluate": "math.calc", "convert": "convert.units", "unit.convert": "convert.units", "units.convert": "convert.units",
  "email.validate": "validate.email", "phone.validate": "validate.phone", "csv.clean": "data.csv_trim_all", "csv.dedupe": "data.csv_dedupe", "csv.info": "data.csv_info", "lead.score": "leads.score", "lead.clean": "leads.clean_list", "leads.clean": "leads.clean_list", "lead.dedupe": "leads.dedupe", "leads.find_emails": "web.find_emails", "contacts.extract": "web.extract_contacts", "company.contacts": "web.extract_contacts", "gst.calc": "finance.gst", "emi.calc": "finance.emi", "sip.calc": "finance.sip", "date.diff_days": "date.days_between", "date.add": "date.add_days", "hash.sha256": "encode.sha256", "hash.md5": "encode.md5", "base64.encode": "encode.base64", "base64.decode": "encode.base64_decode", "uuid.create": "encode.uuid", "password.generate": "encode.password", "qr.create": "encode.qr_url",
  "computer.recipe": "pc.recipe", "pc.howto": "pc.recipe", "playbook": "field.guide", "field.playbook": "field.guide",
};
export const resolveAlias = (name: string) => ALIASES[name.toLowerCase()] ?? name;

/** Tools whose result contains text from the outside world (so it is wrapped as untrusted). The rest are computed by our own code. */
export const isExternalPack = (name: string) => /^(web\.|dns\.|email\.domain_health|domain\.|text\.extract_between)/.test(name) && !name.startsWith("web.search") && !name.startsWith("web.read");

const usage = (t: PackTool) => `${t.name}(${t.params})`;
export function suggest(name: string, n = 5): string[] {
  const hits = searchPack(PACK, name.replace(/[._-]+/g, " "), n);
  const near = PACK.map((t) => [lev(name.toLowerCase(), t.name), t.name] as const).filter(([d]) => d <= Math.max(3, Math.floor(name.length / 4))).sort((a, b) => a[0] - b[0]).slice(0, n).map(([, x]) => x);
  return [...new Set([...near, ...hits.map((h) => h.name)])].slice(0, n);
}

export type PackResult = { ok: boolean; text: string };
/** Runs one pack tool. Returns null when the name is not a pack tool. NEVER throws: failures come back as a clear message with the usage line. */
export async function runPackTool(name: string, raw: unknown): Promise<PackResult | null> {
  const t = PACK_MAP.get(name);
  if (!t) return null;
  const args: A = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as A) : {};
  try {
    const out = await Promise.race([Promise.resolve(t.run(args)), new Promise<string>((_, rej) => setTimeout(() => rej(new Error("The tool took too long (30 s).")), 30_000))]);
    const text = typeof out === "string" ? out : JSON.stringify(out);
    return { ok: true, text: text === "" ? "(empty result)" : text };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "failed";
    return { ok: false, text: `${msg}\nUsage: ${usage(t)} — ${t.description}\nFix the arguments and call it again.` };
  }
}

const fam = () => { const m = new Map<string, number>(); for (const t of PACK) m.set(t.family, (m.get(t.family) ?? 0) + 1); return m; };
export const packCount = () => PACK.length;

export const META_TOOLS: MetaDef[] = [
  {
    name: "tools.search", risk: "read", params: "query:string (what you want to do, e.g. 'dedupe leads csv', 'gst invoice', 'convert km to miles'), limit?:number",
    description: `Find the right tool among ${PACK.length}+ built-in tools (text, math, stats, dates, unit conversion, validation of emails / phones / PAN / GSTIN / Aadhaar, hashing, colours, CSV / JSON work, lead cleaning / scoring / outreach checks, finance / GST / EMI / SIP, website contact finding, DNS / email-deliverability checks, computer recipes, work-field playbooks). Returns names with their arguments; then call the tool by its name (or with tools.call). Search BEFORE doing by hand anything a tool could compute.`,
    run: async (a) => {
      const q = String(a.query ?? "").trim();
      const limit = Math.min(30, Math.max(1, Number(a.limit) || 12));
      if (!q) return "Tool families:\n" + [...fam()].map(([f, c]) => `${f}: ${c}`).join("\n") + "\nGive a query to search.";
      const hits = searchPack(PACK, q, limit);
      if (!hits.length) return `No tool found for "${q}". Try other words, or tools.families.`;
      return hits.map((t) => `- ${t.name}(${t.params}) — ${t.description}`).join("\n") + `\n(${PACK.length} tools in total. Call one by its exact name.)`;
    },
  },
  {
    name: "tools.call", risk: "read", params: "name:string (exact tool name from tools.search), args?:object",
    description: "Run one built-in pack tool by name with its arguments (same as calling it directly; use this when the name is not in your tool list).",
    run: async (a) => {
      const nm = resolveAlias(String(a.name ?? "").trim());
      let args: unknown = a.args ?? {};
      if (typeof args === "string") { try { args = JSON.parse(args); } catch { args = {}; } }
      const r = await runPackTool(nm, args);
      if (!r) return `No pack tool named "${nm}". Did you mean: ${suggest(nm).join(", ") || "(use tools.search)"}`;
      if (!r.ok) throw new Error(r.text);
      return r.text;
    },
  },
  {
    name: "tools.families", risk: "read", params: "",
    description: "The families of built-in tools and how many each has.",
    run: async () => [...fam()].map(([f, c]) => `${f}: ${c} tools`).join("\n") + `\nTotal: ${PACK.length}. Use tools.search to list the ones you need.`,
  },
];

/** A short block for the agent's prompt: it must know the pack exists and how to use it, without 1000 lines of text. */
export function packPrompt(): string {
  const f = fam();
  const line = (k: string, e: string) => `${k} (${f.get(k) ?? 0}): ${e}`;
  return `\n\nBUILT-IN TOOL PACK (${PACK.length}+ tools, always available, free, no key). They are not listed one by one: FIND them with tools.search {"query":"what you need"} and call them by name. Examples of what exists:\n` +
    [
      line("leads", "clean_list, dedupe, score_list, email_patterns, seniority, search_queries, spam_check, classify_reply, followup_sequence, to_crm_csv, call_script"),
      line("validate", "email, phone, indian_mobile, pan, gstin, aadhaar, ifsc, iban, credit_card (format), url, domain, password_strength"),
      line("data", "csv_info, csv_dedupe, csv_filter, csv_sort, csv_join, csv_group_sum, csv_compare, csv_to_sql, csv_to_vcf; json.* (get, flatten, diff, merge, to_yaml)"),
      line("web", "extract_contacts, find_emails, page_meta, tech_stack, sitemap, status_many; dns.records, email.domain_health, domain.age, web.ssl_expiry"),
      line("finance", "gst, invoice_total, emi, sip, income_tax_india_new_regime, salary_breakup, break_even, cac_ltv, ad_metrics"),
      line("text", "slugify, extract_emails / phones / urls / prices, mail_merge, readability, keywords, diff, regex_*, table_markdown"),
      line("math+stats+geo", "calc (safe expression), percent_*, number_to_words (lakh / crore), summary, regression, ab_test, haversine"),
      line("date", "parse, add_business_days, diff, age, financial_year, timezone_convert, cron_next, ics_event, followup_schedule"),
      line("convert", `units (everything), plus ${f.get("convert") ?? 0} exact pair tools like convert.km_to_mile`),
      line("encode+color+dev", "hash, base64, uuid, password, totp, jwt_decode, upi_link, qr_url, color.palette / contrast, http_status, regex_for"),
      line("pc", `recipe: ${RECIPES.length} tested commands for the computer (pdf merge / split / ocr, docx / xlsx / pptx convert, ffmpeg video & audio, images, zip, scraping, automation)`),
      line("field", `guide: ${FIELDS.length} work-field playbooks (lead_generation, tax_gst_india, recruitment_hr, accounting_bookkeeping, ecommerce, real_estate, legal_documents ...)`),
    ].map((x) => "- " + x).join("\n") +
    `\nNames you may guess are understood: pdf.create = file.pdf, docx.create = file.docx, xlsx.create = file.xlsx, pptx.create = file.pptx, zip.create = file.zip, csv.create = file.csv. ` +
    `RULES: (1) Anything that can be COMPUTED, CHECKED or CONVERTED is done with a tool, never by guessing in your head: numbers, dates, taxes, unit conversions, email / phone / ID checks, CSV work. (2) At the start of an unfamiliar kind of job call field.guide {"task":"..."}; for a job on the computer call pc.recipe {"task":"..."} before you improvise commands. (3) If a tool answers with an error, read the Usage line and call it again with fixed arguments: do not give up and do not do it by hand. (4) Report only what a tool result confirms.`;
}
