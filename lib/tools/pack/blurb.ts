// The prompt block about the Tool Pack. It must stay free of imports: lib/tools/prompt.ts is also loaded by client pages,
// and the pack itself uses server-only modules (dns, net, tls). Numbers here are checked by scripts/tests/tool-pack.test.mjs.
export const PACK_PROMPT_MIN_TOOLS = 1900;

export function packPrompt(): string {
  return `\n\nBUILT-IN TOOL PACK (${PACK_PROMPT_MIN_TOOLS}+ tools, always available, free, no key). They are not listed one by one: FIND them with tools.search {"query":"what you need"} and call them by name. Examples of what exists:\n` +
    [
      "leads: clean_list, dedupe, score_list, email_patterns, seniority, search_queries, spam_check, classify_reply, followup_sequence, to_crm_csv, call_script",
      "validate: email, phone, indian_mobile, pan, gstin, aadhaar, ifsc, iban, credit_card (format only), url, domain, password_strength",
      "data: csv_info, csv_dedupe, csv_filter, csv_sort, csv_join, csv_group_sum, csv_compare, csv_to_sql, csv_to_vcf; json.* (get, flatten, diff, merge, to_yaml)",
      "web: extract_contacts, find_emails, page_meta, tech_stack, sitemap, status_many; dns.records, email.domain_health, domain.age, web.ssl_expiry",
      "finance: gst, invoice_total, emi, sip, income_tax_india_new_regime, salary_breakup, break_even, cac_ltv, ad_metrics",
      "text: slugify, extract_emails / phones / urls / prices, mail_merge, readability, keywords, diff, regex_*, table_markdown",
      "math + stats + geo: calc (safe expression), percent_*, number_to_words (lakh / crore), summary, regression, ab_test, haversine",
      "date: parse, add_business_days, diff, age, financial_year, timezone_convert, cron_next, ics_event, followup_schedule",
      "convert: units (everything), plus 1000+ exact pair tools like convert.km_to_mile",
      "encode + color + dev: hash, base64, uuid, password, totp, jwt_decode, upi_link, qr_url, color.palette / contrast, http_status, regex_for",
      "pc: recipe = 70+ tested commands for the computer (pdf merge / split / ocr, docx / xlsx / pptx convert, ffmpeg video and audio, images, zip, scraping, automation)",
      "field: guide = 60+ work-field playbooks (lead_generation, tax_gst_india, recruitment_hr, accounting_bookkeeping, ecommerce, real_estate, legal_documents ...)",
    ].map((x) => "- " + x).join("\n") +
    `\nNames you may guess are understood: pdf.create = file.pdf, docx.create = file.docx, xlsx.create = file.xlsx, pptx.create = file.pptx, zip.create = file.zip, csv.create = file.csv. ` +
    `RULES: (1) Anything that can be COMPUTED, CHECKED or CONVERTED is done with a tool, never by guessing in your head: numbers, dates, taxes, unit conversions, email / phone / ID checks, CSV work. (2) At the start of an unfamiliar kind of job call field.guide {"task":"..."}; for a job on the computer call pc.recipe {"task":"..."} before you improvise commands. (3) If a tool answers with an error, read the Usage line and call it again with fixed arguments: do not give up and do not do it by hand. (4) Report only what a tool result confirms.`;
}
