// Shared by the browser, the server and the agent tools (no imports on purpose).
// A deck is plain JSON: { title, theme, slides[] }. ONE renderer (slideHtml + deckCss) draws every slide, so the preview in
// the Decks window, the Present mode, the downloaded HTML and the PDF print all look exactly the same.
// NO FIXED TEMPLATE: the AI model designs every slide itself as free HTML on a 1280x720 canvas (layout "free", field `html`).
// The old ready-made layouts below still exist, only so that decks made earlier keep opening and can still be edited.

export const LAYOUTS = ["free", "title", "section", "bullets", "two-column", "comparison", "stats", "timeline", "quote", "closing"] as const;
export const SLIDE_W = 1280;
export const SLIDE_H = 720;
export type Layout = (typeof LAYOUTS)[number];
export type Column = { title?: string; bullets: string[] };
export type Slide = {
  layout: Layout;
  kicker?: string; title?: string; subtitle?: string; body?: string;
  bullets?: string[]; left?: Column; right?: Column;
  stats?: Array<{ value: string; label: string }>;
  steps?: Array<{ title: string; text?: string }>;
  quote?: string; by?: string; notes?: string;
  /** layout "free": the complete design of this slide, written by the model as HTML + CSS for a 1280x720 canvas. */
  html?: string;
};
export type Deck = { id: string; chatId: string; title: string; subtitle?: string; theme: string; slides: Slide[]; createdAt: number; updatedAt: number; by?: "agent" | "owner" };
export type DeckSummary = { id: string; chatId: string; title: string; theme: string; slideCount: number; createdAt: number; updatedAt: number; by?: string };

export type DeckTheme = { id: string; name: string; bg: string; bg2: string; fg: string; sub: string; ac: string; ac2: string; card: string; line: string; font: string; hf: string };
const SANS = `Inter,"Segoe UI",system-ui,-apple-system,"Helvetica Neue",Arial,sans-serif`;
const SERIF = `Georgia,"Times New Roman",serif`;
export const DECK_THEMES: DeckTheme[] = [
  { id: "venus", name: "Venus (purple night)", bg: "#120d26", bg2: "#2a1659", fg: "#f6f3ff", sub: "#b9aedd", ac: "#9b7bff", ac2: "#ff7ad9", card: "rgba(255,255,255,.07)", line: "rgba(255,255,255,.14)", font: SANS, hf: SANS },
  { id: "paper", name: "Paper (clean light)", bg: "#fbfaf7", bg2: "#efece4", fg: "#15151a", sub: "#6b6a72", ac: "#5b3fdb", ac2: "#e0457b", card: "rgba(255,255,255,.85)", line: "rgba(20,20,30,.12)", font: SANS, hf: SERIF },
  { id: "ocean", name: "Ocean (deep blue)", bg: "#06192e", bg2: "#0b3a63", fg: "#eaf6ff", sub: "#8fb8d8", ac: "#34c3ff", ac2: "#5eead4", card: "rgba(255,255,255,.07)", line: "rgba(255,255,255,.15)", font: SANS, hf: SANS },
  { id: "sunset", name: "Sunset (warm)", bg: "#2b0f1c", bg2: "#7a2e1d", fg: "#fff4ea", sub: "#f0bfa4", ac: "#ffb24a", ac2: "#ff6b8b", card: "rgba(255,255,255,.08)", line: "rgba(255,255,255,.16)", font: SANS, hf: SANS },
  { id: "forest", name: "Forest (calm green)", bg: "#0b1f17", bg2: "#14412f", fg: "#eefaf3", sub: "#9bc9b2", ac: "#4ade80", ac2: "#facc15", card: "rgba(255,255,255,.07)", line: "rgba(255,255,255,.15)", font: SANS, hf: SANS },
  { id: "mono", name: "Mono (black & white)", bg: "#0b0b0c", bg2: "#1c1c1f", fg: "#f4f4f5", sub: "#a1a1aa", ac: "#ffffff", ac2: "#a1a1aa", card: "rgba(255,255,255,.06)", line: "rgba(255,255,255,.18)", font: SANS, hf: SERIF },
];
export const themeOf = (id?: string): DeckTheme => DECK_THEMES.find((t) => t.id === id) ?? DECK_THEMES[0];

// ---------------------------------------------------------------- cleaning (used for everything that comes from the agent, a model or the browser)
const s = (v: unknown, n: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const long = (v: unknown, n: number) => String(v ?? "").replace(/\r/g, "").trim().slice(0, n);
const list = (v: unknown, max: number, n: number): string[] => (Array.isArray(v) ? v : typeof v === "string" ? v.split("\n") : []).map((x) => s(typeof x === "object" && x ? (x as { text?: unknown }).text ?? "" : x, n).replace(/^[-•*]\s*/, "")).filter(Boolean).slice(0, max);
const col = (v: unknown): Column | undefined => {
  if (!v || typeof v !== "object") return undefined;
  const o = v as { title?: unknown; heading?: unknown; bullets?: unknown; points?: unknown; items?: unknown };
  const bullets = list(o.bullets ?? o.points ?? o.items, 6, 160);
  const title = s(o.title ?? o.heading, 60);
  return bullets.length || title ? { title: title || undefined, bullets } : undefined;
};


// ---------------------------------------------------------------- free-form slide HTML (written by a model: always cleaned, always shown inside a sandboxed frame)
export const MAX_SLIDE_HTML = 16000;

/** Keeps the design (tags, inline styles, <style>, inline SVG) and removes everything that could run code or load a page. */
export function cleanHtml(raw: unknown, max = MAX_SLIDE_HTML): string {
  let h = String(raw ?? "").replace(/\r/g, "").replace(/```(?:html|xml)?/gi, "");
  h = h.replace(/<!doctype[^>]*>/gi, "").replace(/<\/?(?:html|head|body)\b[^>]*>/gi, "");
  h = h.replace(/<title\b[\s\S]*?<\/title>/gi, "").replace(/<(?:meta|link|base)\b[^>]*>/gi, "");
  h = h.replace(/<(script|iframe|object|embed|applet|frameset|frame|noscript)\b[\s\S]*?<\/\1\s*>/gi, "").replace(/<\/?(?:script|iframe|object|embed|applet|frameset|frame|noscript)\b[^>]*>/gi, "");
  h = h.replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
  h = h.replace(/(href|src|xlink:href|action)\s*=\s*(["']?)\s*(?:javascript|vbscript|data:text\/html)[^"'>\s]*/gi, "$1=$2#");
  h = h.replace(/@import[^;{]*;?/gi, "").replace(/expression\s*\(/gi, "(").replace(/behavior\s*:[^;"']*/gi, "");
  return h.trim().slice(0, max);
}

/** The text of a free slide without its markup (used for the PowerPoint fallback and for the thumbnails' titles). */
export function plainText(html: string): string[] {
  return String(html ?? "")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<(?:br|\/p|\/div|\/h[1-6]|\/li|\/tr)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .split("\n").map((x) => x.replace(/\s+/g, " ").trim()).filter(Boolean);
}

/** The full page of one free slide: this is what the sandboxed frame shows (and what is turned into a picture for PowerPoint). */
export function freeDoc(html: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=${SLIDE_W}"><style>*{box-sizing:border-box}html,body{margin:0;padding:0;width:${SLIDE_W}px;height:${SLIDE_H}px;overflow:hidden;background:#fff}body{font-family:Inter,"Segoe UI",system-ui,-apple-system,"Helvetica Neue",Arial,sans-serif;-webkit-font-smoothing:antialiased}</style></head><body>${html}</body></html>`;
}

/** Reads the reply of a model that was asked for <deck-title>, <deck-subtitle> and one <slide><notes>..</notes> HTML </slide> per slide. */
export function parseDeckText(raw: string): { title: string; subtitle: string; slides: Array<{ layout: "free"; html: string; notes: string }> } | null {
  const text = String(raw ?? "");
  if (!/<slide\b/i.test(text)) return null;
  const tag = (n: string) => new RegExp(`<${n}>([\\s\\S]*?)</${n}>`, "i").exec(text)?.[1]?.replace(/\s+/g, " ").trim() ?? "";
  const slides = text.split(/<slide\b[^>]*>/i).slice(1).map((part) => {
    const body = part.replace(/<\/slide>[\s\S]*$/i, "");
    const notes = /<notes>([\s\S]*?)<\/notes>/i.exec(body)?.[1]?.trim() ?? "";
    return { layout: "free" as const, html: cleanHtml(body.replace(/<notes>[\s\S]*?<\/notes>/i, "")), notes: notes.slice(0, 900) };
  }).filter((x) => x.html.length > 40);
  return slides.length ? { title: tag("deck-title"), subtitle: tag("deck-subtitle"), slides } : null;
}

export const isFree = (sl: Slide | undefined) => Boolean(sl && sl.layout === "free" && sl.html);

export function cleanSlide(raw: unknown): Slide | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const html = cleanHtml(o.html ?? o.markup);
  if (html.length > 40) return { layout: "free", html, ...(long(o.notes ?? o.speaker_notes, 900) ? { notes: long(o.notes ?? o.speaker_notes, 900) } : {}), ...(s(o.title, 120) ? { title: s(o.title, 120) } : {}) };
  let layout = s(o.layout ?? o.type, 20).toLowerCase().replace(/[_\s]+/g, "-") as Layout;
  if (layout === ("two-columns" as string) || layout === ("columns" as string)) layout = "two-column";
  if (!LAYOUTS.includes(layout) || layout === "free") layout = "bullets";
  const sl: Slide = { layout };
  const put = <K extends keyof Slide>(k: K, v: Slide[K] | undefined | "") => { if (v !== undefined && v !== "" && !(Array.isArray(v) && !v.length)) sl[k] = v as Slide[K]; };
  put("kicker", s(o.kicker, 40)); put("title", s(o.title, 120)); put("subtitle", s(o.subtitle, 220)); put("body", long(o.body ?? o.text, 500));
  put("bullets", list(o.bullets ?? o.points, 8, 200)); put("left", col(o.left)); put("right", col(o.right));
  put("stats", (Array.isArray(o.stats) ? o.stats : []).slice(0, 4).map((x) => { const r = (x ?? {}) as { value?: unknown; label?: unknown }; return { value: s(r.value, 18), label: s(r.label, 60) }; }).filter((x) => x.value));
  put("steps", (Array.isArray(o.steps) ? o.steps : []).slice(0, 6).map((x) => { const r = (x ?? {}) as { title?: unknown; text?: unknown }; return { title: s(r.title, 60), text: s(r.text, 150) || undefined }; }).filter((x) => x.title));
  put("quote", s(o.quote, 320)); put("by", s(o.by ?? o.author, 80)); put("notes", long(o.notes ?? o.speaker_notes, 900));
  // a slide with nothing to show is dropped
  return sl.title || sl.quote || sl.bullets || sl.left || sl.right || sl.stats || sl.steps || sl.subtitle ? sl : null;
}

export function cleanDeck(raw: unknown): { title: string; subtitle: string; theme: string; slides: Slide[] } {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const slides = (Array.isArray(o.slides) ? o.slides : []).map(cleanSlide).filter((x): x is Slide => Boolean(x)).slice(0, 40);
  const theme = DECK_THEMES.some((t) => t.id === o.theme) ? String(o.theme) : "venus";
  return { title: s(o.title, 120) || slides[0]?.title || "Untitled deck", subtitle: s(o.subtitle, 200), theme, slides };
}

// ---------------------------------------------------------------- one renderer
const esc = (x: unknown) => String(x ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
const chars = (a: string[] = []) => a.reduce((n, x) => n + x.length, 0);

/** How much to shrink the text of a crowded slide so nothing runs off the page. */
function scale(sl: Slide): number {
  const n = Math.max(chars(sl.bullets), chars(sl.left?.bullets) + chars(sl.right?.bullets), (sl.steps ?? []).reduce((a, x) => a + x.title.length + (x.text?.length ?? 0), 0));
  const rows = Math.max(sl.bullets?.length ?? 0, sl.left?.bullets.length ?? 0, sl.right?.bullets.length ?? 0);
  let k = 1;
  if (n > 360 || rows > 5) k = 0.9;
  if (n > 520 || rows > 6) k = 0.8;
  if (n > 720 || rows > 7) k = 0.7;
  if ((sl.title?.length ?? 0) > 60) k = Math.min(k, 0.88);
  return k;
}

const ul = (a?: string[]) => (a?.length ? `<ul class="b">${a.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : "");
const colHtml = (c: Column | undefined, cls = "") => `<div class="col ${cls}">${c?.title ? `<h3>${esc(c.title)}</h3>` : ""}${ul(c?.bullets)}</div>`;

export function slideHtml(sl: Slide, n: number, total: number, brand = "AgenticVenus"): string {
  if (isFree(sl)) return `<div class="s l-free"><iframe title="Slide ${n}" sandbox="" referrerpolicy="no-referrer" srcdoc="${esc(freeDoc(sl.html as string))}" style="display:block;width:${SLIDE_W}px;height:${SLIDE_H}px;border:0;background:#fff;pointer-events:none"></iframe></div>`;
  const head = `${sl.kicker ? `<div class="k">${esc(sl.kicker)}</div>` : ""}${sl.title ? `<h2 class="t">${esc(sl.title)}</h2>` : ""}`;
  let body = "";
  switch (sl.layout) {
    case "title":
      body = `<div class="mid"><div class="bar"></div>${sl.kicker ? `<div class="k">${esc(sl.kicker)}</div>` : ""}<h1 class="big">${esc(sl.title)}</h1>${sl.subtitle ? `<p class="sub">${esc(sl.subtitle)}</p>` : ""}${sl.body ? `<p class="by2">${esc(sl.body)}</p>` : ""}</div>`;
      break;
    case "section":
      body = `<div class="mid ctr">${sl.kicker ? `<div class="num">${esc(sl.kicker)}</div>` : ""}<h1 class="big">${esc(sl.title)}</h1>${sl.subtitle ? `<p class="sub">${esc(sl.subtitle)}</p>` : ""}</div>`;
      break;
    case "two-column":
      body = `${head}<div class="cols">${colHtml(sl.left)}${colHtml(sl.right)}</div>`;
      break;
    case "comparison":
      body = `${head}<div class="cols vs">${colHtml(sl.left, "l")}<span class="vsb">VS</span>${colHtml(sl.right, "r")}</div>`;
      break;
    case "stats":
      body = `${head}<div class="stats" style="--n:${sl.stats?.length || 1}">${(sl.stats ?? []).map((x) => `<div class="stat"><div class="v">${esc(x.value)}</div><div class="l">${esc(x.label)}</div></div>`).join("")}</div>${sl.body ? `<p class="lead">${esc(sl.body)}</p>` : ""}`;
      break;
    case "timeline":
      body = `${head}<div class="tl" style="--n:${sl.steps?.length || 1}">${(sl.steps ?? []).map((x, i) => `<div class="st"><span class="dot">${i + 1}</span><h4>${esc(x.title)}</h4>${x.text ? `<p>${esc(x.text)}</p>` : ""}</div>`).join("")}</div>`;
      break;
    case "quote":
      body = `<div class="mid"><div class="qm">“</div><p class="q">${esc(sl.quote)}</p>${sl.by ? `<div class="qb">— ${esc(sl.by)}</div>` : ""}</div>`;
      break;
    case "closing":
      body = `<div class="mid ctr"><h1 class="big">${esc(sl.title)}</h1>${sl.subtitle ? `<p class="sub">${esc(sl.subtitle)}</p>` : ""}${sl.bullets?.length ? `<div class="chips">${sl.bullets.map((x) => `<span>${esc(x)}</span>`).join("")}</div>` : ""}</div>`;
      break;
    default:
      body = `${head}${sl.body ? `<p class="lead">${esc(sl.body)}</p>` : ""}${ul(sl.bullets)}`;
  }
  return `<div class="s l-${sl.layout}" style="--sc:${scale(sl)}"><div class="in">${body}</div><div class="brand">${esc(brand)}</div><div class="pg">${n} / ${total}</div></div>`;
}

export const themeVars = (t: DeckTheme) => `--bg:${t.bg};--bg2:${t.bg2};--fg:${t.fg};--sub:${t.sub};--ac:${t.ac};--ac2:${t.ac2};--card:${t.card};--line:${t.line};--font:${t.font};--hf:${t.hf}`;

export const deckCss = () => `
.dk .s{position:relative;width:1280px;height:720px;overflow:hidden;background:linear-gradient(135deg,var(--bg),var(--bg2));color:var(--fg);font-family:var(--font);--sc:1;text-align:left}
.dk .s.l-free{background:none}
.dk .s.l-free::before,.dk .s.l-free::after{display:none}
.dk .s::before{content:"";position:absolute;right:-190px;top:-190px;width:540px;height:540px;border-radius:50%;background:radial-gradient(circle,var(--ac) 0,transparent 68%);opacity:.26}
.dk .s::after{content:"";position:absolute;left:-150px;bottom:-210px;width:470px;height:470px;border-radius:50%;background:radial-gradient(circle,var(--ac2) 0,transparent 70%);opacity:.17}
.dk .in{position:relative;z-index:1;height:100%;padding:64px 84px 70px;display:flex;flex-direction:column}
.dk .k{font-size:17px;letter-spacing:.2em;text-transform:uppercase;color:var(--ac);font-weight:700;margin-bottom:14px}
.dk .t{font-family:var(--hf);font-size:calc(54px*var(--sc));line-height:1.08;font-weight:800;letter-spacing:-.02em;margin:0 0 30px}
.dk .brand{position:absolute;left:84px;bottom:26px;font-size:14px;color:var(--sub);z-index:2;letter-spacing:.06em}
.dk .pg{position:absolute;right:46px;bottom:26px;font-size:15px;color:var(--sub);z-index:2}
.dk .mid{margin:auto 0;display:flex;flex-direction:column;align-items:flex-start}
.dk .mid.ctr{align-items:center;text-align:center}
.dk .bar{width:92px;height:8px;border-radius:8px;background:linear-gradient(90deg,var(--ac),var(--ac2));margin-bottom:34px}
.dk .big{font-family:var(--hf);font-size:calc(84px*var(--sc));line-height:1.04;font-weight:800;letter-spacing:-.03em;margin:0}
.dk .sub{font-size:32px;line-height:1.35;color:var(--sub);margin:26px 0 0;max-width:900px}
.dk .by2{font-size:22px;color:var(--ac);margin:34px 0 0;letter-spacing:.04em}
.dk .num{font-size:150px;font-weight:800;line-height:1;background:linear-gradient(90deg,var(--ac),var(--ac2));-webkit-background-clip:text;background-clip:text;color:transparent;margin-bottom:10px}
.dk .lead{font-size:30px;line-height:1.4;color:var(--sub);margin:0 0 24px;max-width:1000px}
.dk ul.b{list-style:none;margin:0;padding:0}
.dk ul.b li{position:relative;font-size:calc(31px*var(--sc));line-height:1.34;padding-left:40px;margin-bottom:calc(20px*var(--sc))}
.dk ul.b li::before{content:"";position:absolute;left:0;top:calc(.5em*var(--sc) + 6px);width:14px;height:14px;border-radius:4px;background:linear-gradient(135deg,var(--ac),var(--ac2))}
.dk .cols{display:grid;grid-template-columns:1fr 1fr;gap:34px;position:relative}
.dk .col{background:var(--card);border:1px solid var(--line);border-radius:26px;padding:32px 38px}
.dk .col h3{font-size:calc(28px*var(--sc));margin:0 0 18px;color:var(--ac);font-weight:700}
.dk .col.r h3{color:var(--ac2)}
.dk .col ul.b li{font-size:calc(26px*var(--sc))}
.dk .vsb{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:66px;height:66px;border-radius:50%;background:linear-gradient(135deg,var(--ac),var(--ac2));display:flex;align-items:center;justify-content:center;font-weight:800;font-size:20px;color:#fff;box-shadow:0 8px 24px rgba(0,0,0,.3)}
.dk .stats{display:grid;grid-template-columns:repeat(var(--n),1fr);gap:26px;margin:6px 0 26px}
.dk .stat{background:var(--card);border:1px solid var(--line);border-radius:28px;padding:44px 20px;text-align:center}
.dk .stat .v{font-size:78px;font-weight:800;line-height:1;color:var(--ac);letter-spacing:-.02em}
.dk .stat .l{font-size:24px;color:var(--sub);margin-top:16px}
.dk .tl{display:grid;grid-template-columns:repeat(var(--n),1fr);gap:22px;position:relative;margin-top:28px}
.dk .st{position:relative;background:var(--card);border:1px solid var(--line);border-radius:24px;padding:60px 22px 26px;min-height:300px}
.dk .st .dot{position:absolute;left:22px;top:0;transform:translateY(-14px);width:54px;height:54px;border-radius:50%;background:linear-gradient(135deg,var(--ac),var(--ac2));display:flex;align-items:center;justify-content:center;font-weight:800;font-size:22px;color:#fff}
.dk .st h4{font-size:calc(25px*var(--sc));margin:0 0 10px;font-weight:700}
.dk .st p{font-size:calc(19px*var(--sc));line-height:1.4;color:var(--sub);margin:0}
.dk .qm{font-size:170px;line-height:.7;color:var(--ac);font-family:Georgia,serif;height:90px}
.dk .q{font-family:var(--hf);font-size:calc(50px*var(--sc));line-height:1.26;font-weight:600;margin:10px 0 0;max-width:1000px}
.dk .qb{margin-top:30px;font-size:26px;color:var(--ac)}
.dk .chips{display:flex;flex-wrap:wrap;gap:14px;justify-content:center;margin-top:40px}
.dk .chips span{padding:14px 26px;border-radius:999px;background:var(--card);border:1px solid var(--line);font-size:24px}
`;

/** One self-contained HTML file: open it in any browser, arrows / space / swipe to move, F = full screen, N = speaker notes. Add #print to print as PDF. */
export function deckToHtml(deck: Pick<Deck, "title" | "theme" | "slides">): string {
  const t = themeOf(deck.theme);
  const total = deck.slides.length;
  const slides = deck.slides.map((sl, i) => `<section class="sl${i === 0 ? " on" : ""}" data-notes="${esc(sl.notes ?? "")}">${slideHtml(sl, i + 1, total)}</section>`).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(deck.title)}</title><style>
html,body{margin:0;height:100%;background:#07070b;overflow:hidden;font-family:system-ui,sans-serif}
.stage{position:fixed;inset:0}
.sl{position:absolute;left:50%;top:50%;width:1280px;height:720px;margin:-360px 0 0 -640px;transform-origin:center center;display:none}
.sl.on{display:block}
.prog{position:fixed;left:0;bottom:0;height:4px;background:${t.ac};transition:width .3s;z-index:9}
.notes{position:fixed;left:0;right:0;bottom:0;background:rgba(0,0,0,.88);color:#fff;padding:18px 28px;font-size:18px;line-height:1.5;display:none;z-index:8}
.help{position:fixed;right:14px;top:12px;color:#9a9aa8;font-size:12px;z-index:9;opacity:.8}
${deckCss()}
.print,.print body{overflow:visible;height:auto;background:#fff}
.print .stage{position:static}
.print .sl{position:relative;display:block;left:0;top:0;margin:0;transform:none!important;page-break-after:always;break-after:page}
.print .prog,.print .help,.print .notes{display:none}
@page{size:1280px 720px;margin:0}
</style></head><body><div class="dk" style="${themeVars(t)}"><div class="stage">${slides}</div></div><div class="prog"></div><div class="help">← → · F full screen · N notes</div><div class="notes"></div><script>
(function(){var S=[].slice.call(document.querySelectorAll(".sl")),i=0,P=document.querySelector(".prog"),N=document.querySelector(".notes");
function fit(){var k=Math.min(innerWidth/1280,innerHeight/720);S.forEach(function(s){s.style.transform="scale("+k+")"})}
function go(n){i=Math.max(0,Math.min(S.length-1,n));S.forEach(function(s,j){s.classList.toggle("on",j===i)});P.style.width=((i+1)/S.length*100)+"%";N.textContent=S[i].getAttribute("data-notes")||"";try{history.replaceState(null,"","#"+(i+1))}catch(e){}}
addEventListener("resize",fit);fit();
addEventListener("keydown",function(e){var k=e.key;if(k==="ArrowRight"||k===" "||k==="PageDown"||k==="Enter")go(i+1);else if(k==="ArrowLeft"||k==="PageUp"||k==="Backspace")go(i-1);else if(k==="Home")go(0);else if(k==="End")go(S.length-1);else if(k==="f"||k==="F"){document.fullscreenElement?document.exitFullscreen():document.documentElement.requestFullscreen&&document.documentElement.requestFullscreen()}else if(k==="n"||k==="N"){N.style.display=N.style.display==="block"?"none":"block"}});
addEventListener("click",function(e){go(e.clientX>innerWidth/2?i+1:i-1)});
var x0=null;addEventListener("touchstart",function(e){x0=e.touches[0].clientX},{passive:true});addEventListener("touchend",function(e){if(x0===null)return;var d=e.changedTouches[0].clientX-x0;if(Math.abs(d)>40)go(d<0?i+1:i-1);x0=null});
if(location.hash==="#print"){document.documentElement.className="print";setTimeout(function(){print()},500)}else{var h=parseInt(location.hash.slice(1),10);go(h>0?h-1:0)}
})();
</script></body></html>`;
}
