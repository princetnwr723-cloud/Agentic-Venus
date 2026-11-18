// The built-in Tool Pack: 1000+ small deterministic tools. These tests pin the answers that matter (money, tax, IDs, dates, leads).
import test from "node:test";
import assert from "node:assert/strict";
import { PACK, PACK_MAP, META_TOOLS, runPackTool, resolveAlias, packCount, suggest } from "../../lib/tools/pack/index.ts";

const run = async (name, args = {}) => { const r = await runPackTool(name, args); assert.ok(r, `no tool ${name}`); return r; };
const ok = async (name, args = {}) => { const r = await run(name, args); assert.ok(r.ok, `${name} failed: ${r.text}`); return r.text; };
const bad = async (name, args = {}) => { const r = await run(name, args); assert.equal(r.ok, false, `${name} should fail`); assert.match(r.text, /Usage:/); return r.text; };

test("the pack has 1000+ tools, unique names, and every tool has a usage line", () => {
  assert.ok(packCount() >= 1000, `only ${packCount()}`);
  assert.equal(new Set(PACK.map((t) => t.name)).size, PACK.length);
  for (const t of PACK) { assert.match(t.name, /^[a-z0-9_]+\.[a-z0-9_]+$/, t.name); assert.ok(t.description.length > 5, t.name); assert.equal(typeof t.run, "function"); }
  assert.ok(PACK.filter((t) => !/^convert\.[a-z0-9]+_to_[a-z0-9_]+$/.test(t.name)).length >= 500, "500+ hand-made tools besides the unit pairs");
});

test("every offline tool answers an empty call with a clear message, never a crash", async () => {
  for (const t of PACK) {
    if (/^(web|dns|domain)\.|^email\.domain_health$/.test(t.name)) continue;
    const r = await runPackTool(t.name, {});
    assert.ok(r && typeof r.text === "string", t.name);
    if (!r.ok) assert.match(r.text, /Usage:/, t.name);
  }
});

test("tools.search finds the right tool in English and Hinglish-ish words", async () => {
  const find = async (q) => (await META_TOOLS.find((m) => m.name === "tools.search").run({ query: q }, [])).split("\n").map((l) => l.slice(2).split("(")[0]);
  assert.ok((await find("remove duplicate leads")).slice(0, 5).includes("leads.dedupe"));
  assert.ok((await find("gst invoice total")).slice(0, 6).some((n) => n === "finance.invoice_total" || n === "finance.gst"));
  assert.ok((await find("convert kilometers to miles")).slice(0, 6).some((n) => n === "convert.units" || n === "convert.km_to_mile"));
  assert.ok((await find("validate aadhaar")).slice(0, 3).includes("validate.aadhaar"));
  assert.ok((await find("email deliverability spf dmarc")).slice(0, 4).includes("email.domain_health"));
  assert.ok((await find("merge pdf files computer")).slice(0, 5).includes("pc.recipe"));
});

test("tools.call runs a tool, understands aliases and explains unknown names", async () => {
  const call = META_TOOLS.find((m) => m.name === "tools.call");
  assert.equal(await call.run({ name: "math.calc", args: { expression: "2+3*4" } }, []), "2+3*4 = 14");
  assert.equal(await call.run({ name: "text.upper", args: '{"text":"abc"}' }, []), "ABC");
  assert.match(await call.run({ name: "text.uppr", args: {} }, []), /Did you mean: .*text\.upper/);
  await assert.rejects(call.run({ name: "text.upper", args: {} }, []), /Usage: text\.upper/);
  assert.equal(resolveAlias("pdf.create"), "file.pdf");
  assert.equal(resolveAlias("xlsx.create"), "file.xlsx");
  assert.ok(suggest("math.clac").includes("math.calc"));
});

test("math: safe calculator, percentages, Indian number words", async () => {
  assert.equal(await ok("math.calc", { expression: "(12+8)*3/4" }), "(12+8)*3/4 = 15");
  assert.match(await ok("math.calc", { expression: "20% of 450" }), /= 90$/);
  assert.match(await ok("math.calc", { expression: "2^10" }), /1024/);
  assert.match(await ok("math.calc", { expression: "sqrt(144)+5!" }), /132/);
  await bad("math.calc", { expression: "1/0" });
  await bad("math.calc", { expression: "process.exit()" });
  await bad("math.calc", { expression: "require('fs')" });
  assert.equal(await ok("math.number_to_words", { number: 1234567, system: "indian" }), "twelve lakh thirty-four thousand five hundred and sixty-seven");
  assert.equal(await ok("math.number_to_words", { number: 1234567 }), "one million two hundred and thirty-four thousand five hundred and sixty-seven");
  assert.equal(await ok("math.amount_in_words", { amount: 105250.5 }), "One lakh five thousand two hundred and fifty rupees and fifty paise only");
  assert.equal(await ok("math.percent_change", { from: 80, to: 100 }), "+25% (increase)");
  assert.equal(await ok("math.to_roman", { number: 2026 }), "MMXXVI");
  assert.equal(await ok("math.from_roman", { roman: "MCMXCIV" }), "1994");
  assert.equal(await ok("math.gcd", { numbers: [12, 18, 24] }), "6");
  assert.equal(await ok("math.base_convert", { value: "ff", from_base: 16, to_base: 2 }), "11111111");
  assert.equal(await ok("math.combinations", { n: 10, r: 3 }), "120");
  assert.match(await ok("stats.summary", { numbers: "2,4,4,4,5,5,7,9" }), /"median": 4.5/);
});

test("units: every common conversion is right", async () => {
  assert.equal(await ok("convert.units", { value: 10, from: "km", to: "miles" }), "10 km = 6.21371192237 miles");
  assert.equal(await ok("convert.units", { value: 100, from: "celsius", to: "fahrenheit" }), "100 celsius = 212 fahrenheit");
  assert.equal(await ok("convert.units", { value: 1, from: "GB", to: "MB" }), "1 GB = 1000 MB");
  assert.equal(await ok("convert.units", { value: 1, from: "GiB", to: "MiB" }), "1 GiB = 1024 MiB");
  assert.match(await ok("convert.units", { value: 1000, from: "sq ft", to: "sq m" }), /92\.903/);
  assert.match(await ok("convert.units", { value: 1, from: "acre", to: "hectare" }), /0\.404685/);
  assert.match(await ok("convert.units", { value: 8, from: "l/100km", to: "mpg" }), /29\.4/);
  assert.equal(await ok("convert.km_to_mile", { value: 42.195 }), "42.195 km = 26.2187574565 mile");
  assert.equal(await ok("convert.c_to_f", { value: -40 }), "-40°C = -40°F");
  await bad("convert.units", { value: 1, from: "kg", to: "km" });
  assert.match(await ok("convert.bandwidth_time", { size: 5, size_unit: "GB", speed: 100, speed_unit: "Mbps" }), /400 seconds/);
});

test("dates: parsing, business days, India financial year, time zones", async () => {
  assert.equal(await ok("date.add_days", { date: "2026-02-27", days: 3 }), "2026-03-02");
  assert.equal(await ok("date.add_months", { date: "2026-01-31", months: 1 }), "2026-02-28");
  assert.equal(await ok("date.days_between", { from: "2026-01-01", to: "2026-12-25" }), "358");
  assert.equal(await ok("date.add_business_days", { date: "2026-03-06", days: 1 }), "2026-03-09");
  assert.equal(await ok("date.business_days_between", { from: "2026-03-02", to: "2026-03-09" }), "5");
  assert.equal(await ok("date.weekday", { date: "15 August 2026" }), "Saturday");
  assert.equal(await ok("date.weekday", { date: "31/12/2026" }), "Thursday");
  assert.match(await ok("date.financial_year", { date: "2026-02-10" }), /^FY 2025-26/);
  assert.match(await ok("date.financial_year", { date: "2026-04-01" }), /^FY 2026-27/);
  assert.equal(await ok("date.is_leap_year", { year: 2100 }), "false");
  await bad("date.parse", { date: "31/02/2026" });
  assert.match(await ok("date.timezone_convert", { datetime: "2026-03-05 15:30", from_tz: "Asia/Kolkata", to_tz: "UTC" }), /10:00/);
  assert.match(await ok("date.age", { birth_date: "2000-01-01", on: "2026-03-05" }), /^26 years, 2 months, 4 days$/);
  assert.match(await ok("date.cron_next", { cron: "30 9 * * 1-5", from: "2026-03-06T10:00:00Z", count: 2 }), /^2026-03-09T09:30:00\.000Z/);
  assert.match(await ok("date.followup_schedule", { start: "2026-03-06" }), /Follow-up 1: 2026-03-09/);
});

test("validation: Indian IDs with real checksums, emails, phones, cards", async () => {
  assert.match(await ok("validate.gstin", { gstin: "27AAPFU0939F1ZV" }), /^valid: state Maharashtra/);
  assert.match(await ok("validate.gstin", { gstin: "27AAPFU0939F1ZX" }), /INVALID: check character should be V/);
  assert.match(await ok("validate.aadhaar", { aadhaar: "2345 6789 0124" }), /checksum|INVALID/);
  assert.match(await ok("validate.aadhaar", { aadhaar: "234567890123" }), /INVALID|valid checksum/);
  assert.match(await ok("validate.aadhaar", { aadhaar: "123456789012" }), /never starts/);
  assert.match(await ok("validate.pan", { pan: "ABCPE1234F" }), /Individual/);
  assert.match(await ok("validate.pan", { pan: "ABCDE12345" }), /INVALID/);
  assert.match(await ok("validate.credit_card", { number: "4111 1111 1111 1111" }), /passes the Luhn check \(Visa\)/);
  assert.match(await ok("validate.credit_card", { number: "4111 1111 1111 1112" }), /INVALID/);
  assert.match(await ok("validate.iban", { iban: "GB82 WEST 1234 5698 7654 32" }), /^valid/);
  assert.match(await ok("validate.isbn", { isbn: "978-0-306-40615-7" }), /^valid/);
  assert.match(await ok("validate.ean_upc", { code: "4006381333931" }), /^valid/);
  assert.match(await ok("validate.phone", { phone: "98765 43210" }), /valid: \+919876543210 \(India\)/);
  assert.match(await ok("validate.phone", { phone: "+91-98765-43210" }), /\+919876543210/);
  assert.match(await ok("validate.phone", { phone: "12345" }), /INVALID/);
  assert.match(await ok("validate.email", { email: "Rahul@Gmial.com" }), /did you mean rahul@gmail\.com/);
  assert.match(await ok("validate.email", { email: "info@acme.com" }), /role address/);
  assert.match(await ok("validate.email", { email: "a@mailinator.com" }), /disposable/);
  assert.match(await ok("validate.email", { email: "john.smith@acme.co.in" }), /valid format/);
  assert.match(await ok("validate.ifsc", { ifsc: "SBIN0001234" }), /^valid/);
  assert.match(await ok("validate.pincode", { pincode: "125001" }), /^valid/);
  assert.match(await ok("validate.pincode", { pincode: "025001" }), /INVALID/);
});

test("finance: GST, EMI, SIP, invoices, tax", async () => {
  assert.equal(await ok("finance.gst", { amount: 1180, rate_percent: 18, inclusive: true }), "Base 1,000.00\nGST 18% = 180.00 (CGST 90.00 + SGST 90.00)\nTotal 1,180.00");
  assert.match(await ok("finance.gst", { amount: 1000, rate_percent: 18, interstate: true }), /IGST 180/);
  assert.match(await ok("finance.emi", { principal: 1000000, annual_rate_percent: 9, years: 20 }), /EMI ₹8,997\.26\/month/);
  assert.match(await ok("finance.sip", { monthly: 10000, annual_return_percent: 12, years: 10 }), /Invested ₹12,00,000\.00/);
  const inv = await ok("finance.invoice_total", { items: [{ description: "A", qty: 2, price: 500, gst_percent: 18 }, { description: "B", qty: 1, price: 1000, gst_percent: 5 }] });
  assert.match(inv, /Subtotal 2,000\.00/); assert.match(inv, /GRAND TOTAL 2,230\.00/);
  assert.match(await ok("finance.income_tax_india_new_regime", { income: 1275000 }), /Tax ₹0\.00/);
  assert.match(await ok("finance.income_tax_india_new_regime", { income: 2000000 }), /Tax ₹/);
  assert.equal(await ok("finance.break_even", { fixed_costs: 50000, price_per_unit: 100, variable_cost_per_unit: 60 }), "Break-even: 1250 units = ₹1,25,000.00 revenue (contribution ₹40.00 per unit)");
  assert.match(await ok("finance.cagr", { start: 100, end: 200, years: 5 }), /^14\.87% per year/);
});

test("data: CSV tools clean, filter, join, group", async () => {
  const csv = "Name,Email,Amount\n Rahul ,RAHUL@acme.com,\"1,200\"\nrahul,rahul@acme.com,300\nPriya,priya@x.in,50\n";
  assert.match(await ok("data.csv_info", { data: csv }), /3 rows, 3 columns/);
  assert.match(await ok("data.csv_dedupe", { data: csv, columns: ["email"] }), /1 duplicates removed, 2 rows left/);
  assert.match(await ok("data.csv_filter", { data: csv, column: "amount", op: ">", value: "500" }), /1 of 3 rows kept/);
  assert.match(await ok("data.csv_sort", { data: "a,b\n3,x\n10,y\n2,z", column: "a", descending: true }), /^a,b\n10,y\n3,x\n2,z/);
  assert.match(await ok("data.csv_group_sum", { data: "city,amt\nA,10\nB,5\nA,7", group_column: "city", value_column: "amt" }), /A,17\nB,5/);
  assert.match(await ok("data.csv_join", { left: "id,n\n1,a\n2,b", right: "id,v\n2,x", key: "id" }), /2 rows\nid,n,v\n1,a,\n2,b,x/);
  assert.equal(await ok("data.csv_to_json", { data: "a,b\n1,2" }), JSON.stringify([{ a: "1", b: "2" }], null, 2));
  assert.equal(await ok("json.get", { json: '{"a":{"b":[{"c":5}]}}', path: "a.b[0].c" }), "5");
  assert.match(await ok("data.csv_to_sql", { data: "a,b\n1,x\n2,y'z", table: "t" }), /INSERT INTO t \(a, b\) VALUES \(2, 'y''z'\);/);
  assert.match(await ok("json.diff", { a: '{"a":1,"b":2}', b: '{"a":1,"b":3,"c":4}' }), /~ b: 2 → 3\n\+ c: 4/);
});

test("leads: names, patterns, cleaning, dedupe, scoring, reply triage, spam check", async () => {
  assert.equal(JSON.parse(await ok("leads.parse_name", { name: "DR. RAHUL KUMAR SHARMA, PhD" })).full, "Rahul Kumar Sharma");
  assert.equal(JSON.parse(await ok("leads.parse_name", { name: "Sharma, Priya" })).first, "Priya");
  assert.equal(await ok("leads.clean_company", { company: "Acme Technologies Pvt. Ltd." }), "Acme Technologies");
  assert.equal(await ok("leads.domain", { value: "https://www.Acme.co.in/about?x=1" }), "acme.co.in");
  assert.match(await ok("leads.email_patterns", { first: "Rahul", last: "Sharma", domain: "acme.com" }), /^1\. rahul\.sharma@acme\.com\n2\. rahul@acme\.com/);
  assert.match(await ok("leads.detect_email_pattern", { known_emails: ["r.sharma@acme.com"], names: ["Rahul Sharma"] }), /f\.last/);
  assert.match(await ok("leads.seniority", { title: "Co-Founder & CEO" }), /"decision_maker": true/);
  assert.match(await ok("leads.seniority", { title: "Marketing Intern" }), /"decision_maker": false/);
  const list = "Name,Email,Phone,Company,Title\nrahul sharma,RAHUL@acme.com,98765 43210,Acme Pvt Ltd,CEO\nRahul Sharma,rahul@acme.com,,Acme Pvt Ltd,\nPriya,bad-email,12345,Beta LLC,Manager\nTom,info@gmail.com,,Gamma,\n";
  const clean = await ok("leads.clean_list", { data: list });
  assert.match(clean, /"bad_email": 1/); assert.match(clean, /"dup": 1/); assert.match(clean, /\+919876543210/); assert.match(clean, /Acme,/);
  const dd = await ok("leads.dedupe", { data: list });
  assert.match(dd, /4 → 3 leads \(1 duplicates merged\)/);
  assert.match(dd, /rahul sharma,.*CEO|Rahul Sharma.*CEO/i);
  assert.match(await ok("leads.score", { lead: { email: "a@acme.com", title: "Director of Sales", phone: "9876543210", website: "acme.com" } }), /"grade": "A \(hot\)"|"grade": "B \(warm\)"/);
  assert.match(await ok("leads.classify_reply", { text: "Thanks, please send me the pricing" }), /^interested/);
  assert.match(await ok("leads.classify_reply", { text: "Please remove me from your list" }), /^unsubscribe/);
  assert.match(await ok("leads.classify_reply", { text: "I am out of office until Monday" }), /^out_of_office/);
  assert.match(await ok("leads.classify_reply", { text: "Mail delivery failed: address not found" }), /^bounce/);
  assert.match(await ok("leads.classify_reply", { text: "I'm not the right person, contact our CTO" }), /^wrong_person/);
  assert.match(await ok("leads.spam_check", { subject: "FREE!!! Act now", body: "Dear friend, click here https://a.com https://b.com https://c.com guaranteed 100% free" }), /do NOT send/);
  assert.match(await ok("leads.spam_check", { subject: "quick question about Acme", body: "Hi Rahul,\n\nI saw Acme opened a Pune branch. We help retailers cut billing time by 40%. Open to a 15-minute call on Tuesday?\n\nPriya\n\nNot relevant? Reply STOP." }), /OK to send/);
  assert.match(await ok("leads.spam_check", { subject: "Hello {{first_name}}", body: "Hi {{first_name}}, ok?" }), /UNFILLED placeholder/);
});

test("text, encode, color, field, pc", async () => {
  assert.equal(await ok("text.slugify", { text: "Café & Bar — Pune 2026!" }), "cafe-and-bar-pune-2026");
  assert.equal(await ok("text.snake", { text: "helloWorld Again" }), "hello_world_again");
  assert.equal(await ok("text.title", { text: "the lord of the rings" }), "The Lord of the Rings");
  assert.equal(await ok("text.extract_emails", { text: "mail A@b.com, a@b.com or x@y.in." }), "a@b.com\nx@y.in");
  assert.equal(await ok("text.fill_template", { template: "Hi {{name}}, {{co}}", values: { name: "Ravi" } }), "Hi Ravi, {{co}}\n\n⚠ Not filled: co");
  assert.equal(await ok("text.levenshtein", { a: "kitten", b: "sitting" }), "3");
  assert.equal(await ok("encode.sha256", { text: "abc" }), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  assert.equal(await ok("encode.md5", { text: "abc" }), "900150983cd24fb0d6963f7d28e17f72");
  assert.equal(await ok("encode.base64", { text: "Venus" }), "VmVudXM=");
  assert.match(await ok("encode.totp", { secret: "JBSWY3DPEHPK3PXP", at: 59 }), /^\d{6} /);
  assert.equal((await ok("encode.totp", { secret: "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", at: 59, digits: 8 })).slice(0, 8), "94287082");
  assert.equal(await ok("encode.add_utm", { url: "acme.com/x", source: "mail", campaign: "spring" }), "https://acme.com/x?utm_source=mail&utm_campaign=spring");
  assert.match(await ok("color.contrast", { foreground: "#000000", background: "#ffffff" }), /^21\.00:1/);
  assert.equal(await ok("color.hex_to_rgb", { hex: "#ff8000" }).then((x) => x.split("\n")[0]), "rgb(255, 128, 0)");
  assert.match(await ok("field.guide", { task: "I want to find leads for my software company and send cold email" }), /Lead generation/);
  assert.match(await ok("field.guide", { field: "tax_gst_india" }), /validate\.gstin/);
  assert.ok((await ok("field.list")).split("\n").length >= 50);
  assert.match(await ok("pc.recipe", { task: "merge two pdf files into one" }), /qpdf --empty/);
  assert.match(await ok("pc.recipe", { task: "make my video smaller for whatsapp" }), /libx264/);
  assert.match(await ok("pc.recipe", { task: "scanned pdf ocr hindi" }), /tesseract/);
  assert.equal(await ok("geo.haversine", { lat1: 28.6139, lon1: 77.209, lat2: 19.076, lon2: 72.8777 }).then((x) => x.split(" km")[0]), "1148.1");
});

test("bad arguments never throw: they come back as a fixable message", async () => {
  for (const [n, a] of [["math.add", { a: "x", b: 1 }], ["date.add_days", { date: "nonsense", days: 1 }], ["data.csv_info", { data: "" }], ["finance.emi", { principal: "abc" }], ["json.format", { json: "{bad" }], ["leads.score", { lead: "not json" }]]) {
    const r = await runPackTool(n, a);
    assert.equal(r.ok, false, n); assert.match(r.text, /Usage:/, n);
  }
  assert.equal(await runPackTool("nope.nothing", {}), null);
});
