// The program that runs INSIDE the owner's hidden E2B computer (Node + playwright-core + Chrome). It listens on 127.0.0.1 only, so nothing outside the
// computer can reach it; the server talks to it with a short curl through E2B. One Chrome stays open, so every page after the first is fast.
// NOTE: this text is a String.raw template: it must contain no backtick and no dollar-brace.
export const SCOUT_DAEMON = String.raw`"use strict";
const http = require("http");
const cp = require("child_process");
const { chromium } = require("playwright-core");
const PORT = 7788;
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const PRIVATE = /^(localhost|0\.0\.0\.0|127\.|10\.|192\.168\.|169\.254\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?$|\[?f[cd][0-9a-f]{2}:|\[?fe80:)/i;
const hostBad = (h) => { h = String(h || "").toLowerCase(); return !h || PRIVATE.test(h) || /\.(local|internal|localhost)$/.test(h); };
const urlOk = (u) => { try { const x = new URL(u); return (x.protocol === "http:" || x.protocol === "https:") && !hostBad(x.hostname); } catch (e) { return false; } };
const chromePath = () => { try { return cp.execSync("command -v google-chrome || command -v google-chrome-stable", { shell: "/bin/bash" }).toString().trim(); } catch (e) { return undefined; } };

let browser = null;
async function getBrowser() {
  if (browser && browser.isConnected()) return browser;
  browser = await chromium.launch({ executablePath: chromePath(), headless: true, args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"] });
  return browser;
}
async function newCtx() {
  const b = await getBrowser();
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, userAgent: UA, locale: "en-US" });
  await ctx.route("**/*", (r) => {
    const q = r.request(), t = q.resourceType();
    if (!urlOk(q.url())) return r.abort();
    if (t === "image" || t === "media" || t === "font") return r.abort();
    return r.continue();
  });
  return ctx;
}
async function settle(page) {
  await page.waitForLoadState("domcontentloaded", { timeout: 8000 }).catch(() => {});
  await page.waitForLoadState("networkidle", { timeout: 2500 }).catch(() => {});
}
async function go(page, url) {
  if (!urlOk(url)) throw new Error("This address is not allowed.");
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 22000 });
  await settle(page);
}
async function tag(page) {
  return page.evaluate(() => {
    document.querySelectorAll("[data-av]").forEach((e) => e.removeAttribute("data-av"));
    const sel = 'a[href],button,input:not([type=hidden]),textarea,select,[role=button],[role=link],[role=tab],[onclick]';
    const out = []; let n = 0;
    for (const el of Array.from(document.querySelectorAll(sel))) {
      if (n >= 70) break;
      const r = el.getBoundingClientRect(), st = getComputedStyle(el);
      if (r.width < 2 || r.height < 2 || st.visibility === "hidden" || st.display === "none") continue;
      el.setAttribute("data-av", String(n));
      const tag = el.tagName.toLowerCase(), type = el.getAttribute("type") || "";
      const label = (el.getAttribute("aria-label") || el.placeholder || el.innerText || el.getAttribute("title") || el.getAttribute("name") || "").replace(/\s+/g, " ").trim().slice(0, 70);
      const value = type === "password" || !("value" in el) ? "" : String(el.value).slice(0, 40);
      out.push({ id: n, tag, type, label, href: tag === "a" ? (el.getAttribute("href") || "").slice(0, 80) : "", value });
      n++;
    }
    return out;
  });
}
async function snapshot(s, log) {
  s.items = await tag(s.page);
  const els = s.items.map((i) => "[" + i.id + "] " + i.tag + (i.type ? "(" + i.type + ")" : "") + ' "' + i.label + '"' + (i.value ? ' value="' + i.value + '"' : "") + (i.href ? " -> " + i.href : "")).join("\n");
  const text = await s.page.evaluate(() => (document.body ? document.body.innerText : "")).catch(() => "");
  const title = await s.page.title().catch(() => "");
  return [log.length ? "ACTIONS:\n" + log.join("\n") + "\n" : "", "URL: " + s.page.url(), "TITLE: " + title, "ELEMENTS (use these numbers in ops):\n" + (els || "(none found)"), "PAGE TEXT:\n" + text.replace(/\n\s*\n+/g, "\n").slice(0, 3500)].filter(Boolean).join("\n").slice(0, 9000);
}
function byLabel(items, label) {
  const want = String(label || "").trim().toLowerCase();
  let hits = items.filter((i) => i.label.toLowerCase() === want);
  if (!hits.length && want.length >= 3) hits = items.filter((i) => i.label.toLowerCase().includes(want));
  if (!hits.length) throw new Error('no element labelled "' + label + '"');
  return hits[0].id;
}
async function runOps(s, ops, log) {
  for (const o of (ops || []).slice(0, 15)) {
    try {
      if (o.op === "click" || o.op === "click_label") {
        const id = o.op === "click" ? Number(o.id) : byLabel(s.items, o.label);
        await s.page.locator('[data-av="' + id + '"]').first().click({ timeout: 6000 }); log.push("clicked [" + id + "]");
      } else if (o.op === "type" || o.op === "type_label") {
        const id = o.op === "type" ? Number(o.id) : byLabel(s.items, o.label);
        await s.page.locator('[data-av="' + id + '"]').first().fill(String(o.text || ""), { timeout: 6000 }); log.push("typed in [" + id + "]");
      } else if (o.op === "press") { await s.page.keyboard.press(String(o.key).slice(0, 30)); log.push("pressed " + o.key); }
      else if (o.op === "scroll") { await s.page.mouse.wheel(0, o.dir === "up" ? -700 : 700); log.push("scrolled " + (o.dir || "down")); }
      else if (o.op === "wait") { await s.page.waitForTimeout(Math.min(4000, Number(o.ms) || 800)); }
      else if (o.op === "back") { await s.page.goBack({ timeout: 8000 }).catch(() => {}); log.push("went back"); }
      await settle(s.page);
      s.items = await tag(s.page);
    } catch (e) { log.push("FAILED " + o.op + ": " + String((e && e.message) || e).split("\n")[0].slice(0, 120)); break; }
  }
}

const sessions = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [k, s] of sessions) if (now - s.at > 15 * 60000) { s.ctx.close().catch(() => {}); sessions.delete(k); }
}, 60000).unref();

async function browse(q) {
  const name = String(q.session || "main").slice(0, 32);
  let s = sessions.get(name);
  const log = [];
  if (!s) {
    if (!q.url) throw new Error("Give a url to open first.");
    const ctx = await newCtx();
    s = { ctx, page: await ctx.newPage(), items: [], at: Date.now() };
    ctx.on("page", (p) => { s.page = p; });
    sessions.set(name, s);
  }
  s.at = Date.now();
  if (q.url) { await go(s.page, String(q.url)); log.push("opened " + q.url); }
  await runOps(s, q.ops, log);
  return { ok: true, snapshot: await snapshot(s, log) };
}

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
const PHONE = /(?:\+\d{1,3}[\s-]?)?(?:\(?\d{2,5}\)?[\s-]?)?\d{3,5}[\s-]?\d{4,6}/g;
async function readOne(ctx, url) {
  const page = await ctx.newPage();
  try {
    await go(page, url);
    const d = await page.evaluate(() => ({
      title: document.title || "",
      text: document.body ? document.body.innerText : "",
      links: Array.from(document.querySelectorAll("a[href]")).slice(0, 80).map((a) => ({ t: (a.innerText || a.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim().slice(0, 60), h: a.href })).filter((l) => /^https?:/.test(l.h)),
      mail: Array.from(document.querySelectorAll('a[href^="mailto:"]')).map((a) => a.getAttribute("href").slice(7).split("?")[0]),
      tel: Array.from(document.querySelectorAll('a[href^="tel:"]')).map((a) => a.getAttribute("href").slice(4)),
    }));
    const text = d.text.replace(/\n\s*\n+/g, "\n");
    const emails = Array.from(new Set((text.match(EMAIL) || []).concat(d.mail).map((x) => x.toLowerCase()))).filter((x) => !/\.(png|jpg|gif|svg|webp)$/.test(x)).slice(0, 12);
    const phones = Array.from(new Set(d.tel.concat((text.match(PHONE) || []).filter((x) => x.replace(/\D/g, "").length >= 9 && x.replace(/\D/g, "").length <= 14)).map((x) => x.trim()))).slice(0, 8);
    return { url, title: d.title.slice(0, 150), text: text.slice(0, 4500), emails, phones, links: d.links.slice(0, 40) };
  } catch (e) { return { url, error: String((e && e.message) || e).split("\n")[0].slice(0, 160) }; }
  finally { await page.close().catch(() => {}); }
}
async function readMany(q) {
  const urls = (Array.isArray(q.urls) ? q.urls : []).slice(0, 8).map(String);
  const ctx = await newCtx();
  try {
    const out = new Array(urls.length);
    let next = 0;
    const worker = async () => { while (next < urls.length) { const i = next++; out[i] = await readOne(ctx, urls[i]); } };
    await Promise.all([worker(), worker(), worker(), worker()]);
    return { ok: true, pages: out };
  } finally { await ctx.close().catch(() => {}); }
}

http.createServer((req, res) => {
  const send = (code, obj) => { const b = typeof obj === "string" ? obj : JSON.stringify(obj); res.writeHead(code, { "Content-Type": "application/json" }); res.end(b); };
  if (req.method === "GET" && req.url === "/health") return send(200, "ok");
  if (req.method !== "POST" || req.url !== "/run") return send(404, { ok: false, error: "not found" });
  let body = "";
  req.on("data", (c) => { body += c; if (body.length > 200000) req.destroy(); });
  req.on("end", async () => {
    try {
      const q = JSON.parse(body || "{}");
      if (q.action === "read") return send(200, await readMany(q));
      if (q.action === "browse") return send(200, await browse(q));
      if (q.action === "close") { const s = sessions.get(String(q.session || "main")); if (s) { await s.ctx.close().catch(() => {}); sessions.delete(String(q.session || "main")); } return send(200, { ok: true }); }
      return send(400, { ok: false, error: "unknown action" });
    } catch (e) { send(200, { ok: false, error: String((e && e.message) || e).split("\n")[0].slice(0, 300) }); }
  });
}).listen(PORT, "127.0.0.1");
process.on("unhandledRejection", () => {});
`;
