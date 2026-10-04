// Server-only. A real headless Chromium (Playwright) running inside a Vercel function.
// The agent sees a NUMBERED list of the page's buttons/links/inputs and acts by number.
// NEW: ops can also target an element by its visible LABEL (used by recorded recipes).
import chromium from "@sparticuz/chromium";
import { chromium as pw, type Page } from "playwright-core";

export type BrowserSession = { url: string; cookies: any[] };
type Target = { label: string; tag?: string; nth?: number };
export type BrowserOp =
  | { op: "click"; id: number }
  | { op: "type"; id: number; text: string }
  | { op: "secret"; id: number; field: "email" | "password" }
  | ({ op: "click_label" } & Target)
  | ({ op: "type_label"; text: string } & Target)
  | ({ op: "secret_label"; field: "email" | "password" } & Target)
  | { op: "press"; key: string }
  | { op: "scroll"; dir?: "up" | "down" }
  | { op: "wait"; ms?: number };

type Item = { id: number; tag: string; type: string; label: string; href: string; value: string };

const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

function isPrivateHost(host: string): boolean {
  const h = host.toLowerCase();
  return (
    h === "localhost" || h.endsWith(".local") || h.endsWith(".internal") || h.startsWith("[") ||
    /^(127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h)
  );
}

function normalizeUrl(input: string): string {
  const u = new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`);
  if (!/^https?:$/.test(u.protocol) || isPrivateHost(u.hostname)) throw new Error("Only public http(s) pages can be opened.");
  return u.toString();
}

async function tagAll(page: Page): Promise<{ text: string; items: Item[] }> {
  const items: Item[] = await page.evaluate(() => {
    document.querySelectorAll("[data-av]").forEach((e) => e.removeAttribute("data-av"));
    const sel = 'a[href],button,input:not([type=hidden]),textarea,select,[role=button],[role=link],[role=tab],[onclick]';
    const out: Array<{ id: number; tag: string; type: string; label: string; href: string; value: string }> = [];
    let n = 0;
    for (const el of Array.from(document.querySelectorAll<HTMLElement>(sel))) {
      if (n >= 70) break;
      const r = el.getBoundingClientRect();
      const st = getComputedStyle(el);
      if (r.width < 2 || r.height < 2 || st.visibility === "hidden" || st.display === "none") continue;
      el.setAttribute("data-av", String(n));
      const tagName = el.tagName.toLowerCase();
      const type = el.getAttribute("type") || "";
      const label = (
        el.getAttribute("aria-label") || (el as HTMLInputElement).placeholder || el.innerText ||
        el.getAttribute("title") || el.getAttribute("name") || ""
      ).replace(/\s+/g, " ").trim().slice(0, 70);
      const value = type === "password" || !("value" in el) ? "" : String((el as HTMLInputElement).value).slice(0, 40);
      out.push({ id: n, tag: tagName, type, label, href: tagName === "a" ? (el.getAttribute("href") || "").slice(0, 80) : "", value });
      n++;
    }
    return out;
  });
  const text = items
    .map((i) => `[${i.id}] ${i.tag}${i.type ? `(${i.type})` : ""} "${i.label}"${i.value ? ` value="${i.value}"` : ""}${i.href ? ` -> ${i.href}` : ""}`)
    .join("\n");
  return { text, items };
}

async function snapshot(page: Page, log: string[]): Promise<string> {
  const { text: elements } = await tagAll(page);
  const text = await page.evaluate(() => document.body?.innerText || "").catch(() => "");
  const title = await page.title().catch(() => "");
  return [
    log.length ? `ACTIONS:\n${log.join("\n")}\n` : "",
    `URL: ${page.url()}`,
    `TITLE: ${title}`,
    `ELEMENTS (use these numbers in ops):\n${elements || "(none found)"}`,
    `PAGE TEXT:\n${text.replace(/\n\s*\n+/g, "\n").slice(0, 2500)}`,
  ].filter(Boolean).join("\n").slice(0, 7000);
}

const el = (page: Page, id: number) => page.locator(`[data-av="${Number(id)}"]`).first();

/** Finds an element id by visible label: exact match first, then a forgiving contains-match. */
function resolveLabel(items: Item[], t: Target): number {
  const want = t.label.trim().toLowerCase();
  const byTag = (i: Item) => !t.tag || i.tag === t.tag;
  let hits = items.filter((i) => i.label.toLowerCase() === want && byTag(i));
  if (!hits.length) hits = items.filter((i) => want.length >= 3 && i.label.toLowerCase().includes(want) && byTag(i));
  if (!hits.length) hits = items.filter((i) => i.label.toLowerCase() === want);
  const hit = hits[t.nth ?? 0] ?? hits[0];
  if (!hit) throw new Error(`no element labelled "${t.label}"`);
  return hit.id;
}

export async function runBrowser(input: {
  session?: BrowserSession | null;
  url?: string;
  ops?: BrowserOp[];
  creds?: { email?: string; password?: string };
}): Promise<{ snapshot: string; session: BrowserSession }> {
  const target = input.url ? normalizeUrl(input.url) : input.session?.url;
  if (!target) throw new Error("No page is open yet — give a url.");

  const browser = await pw.launch({ args: chromium.args, executablePath: await chromium.executablePath(), headless: true });
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, userAgent: UA });
    if (input.session?.cookies?.length) await ctx.addCookies(input.session.cookies).catch(() => {});
    const page = await ctx.newPage();
    page.setDefaultTimeout(8000);
    await page.goto(target, { waitUntil: "domcontentloaded", timeout: 20_000 });
    await page.waitForTimeout(800);
    const items = (await tagAll(page)).items; // numbers the elements the agent saw last time

    const log: string[] = [];
    for (const op of (input.ops ?? []).slice(0, 12)) {
      try {
        const before = page.url();
        if (op.op === "click" || op.op === "click_label") {
          const id = op.op === "click" ? op.id : resolveLabel(items, op);
          await el(page, id).click({ timeout: 6000 });
          log.push(op.op === "click" ? `clicked [${id}]` : `clicked "${op.label}"`);
          await page.waitForTimeout(1200);
          if (page.url() !== before) { log.push("page changed — remaining actions skipped, look at the new page below"); break; }
        } else if (op.op === "type" || op.op === "type_label") {
          const id = op.op === "type" ? op.id : resolveLabel(items, op);
          await el(page, id).fill(String(op.text ?? ""), { timeout: 6000 });
          log.push(op.op === "type" ? `typed into [${id}]` : `typed into "${op.label}"`);
        } else if (op.op === "secret" || op.op === "secret_label") {
          const v = op.field === "password" ? input.creds?.password : input.creds?.email;
          if (!v) throw new Error(`no saved ${op.field} — use need_login first`);
          const id = op.op === "secret" ? op.id : resolveLabel(items, op);
          await el(page, id).fill(v, { timeout: 6000 });
          log.push(`filled ${op.field} (hidden)`);
        } else if (op.op === "press") {
          await page.keyboard.press(String(op.key || "Enter"));
          log.push(`pressed ${op.key}`);
          await page.waitForTimeout(1200);
          if (page.url() !== before) { log.push("page changed — remaining actions skipped"); break; }
        } else if (op.op === "scroll") {
          await page.mouse.wheel(0, op.dir === "up" ? -700 : 700);
          log.push(`scrolled ${op.dir === "up" ? "up" : "down"}`);
          await page.waitForTimeout(400);
        } else if (op.op === "wait") {
          await page.waitForTimeout(Math.min(Math.max(Number(op.ms) || 1000, 200), 4000));
          log.push("waited");
        }
      } catch (e) {
        log.push(`FAILED ${op.op}: ${(e instanceof Error ? e.message : "error").split("\n")[0].slice(0, 120)}`);
        break;
      }
    }

    const snap = await snapshot(page, log);
    const cookies = await ctx.cookies();
    return { snapshot: snap, session: { url: page.url(), cookies } };
  } finally {
    await browser.close().catch(() => {});
  }
}