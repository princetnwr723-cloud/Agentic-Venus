"use client";
// Opens one deck: preview, edit every slide, Present (full screen), and download PowerPoint / HTML / PDF.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Copy, Download, FileDown, Loader2, Play, Plus, Printer, Save, Trash2, X } from "lucide-react";
import { auth } from "@/lib/firebase";
import { DECK_THEMES, LAYOUTS, SLIDE_H, SLIDE_W, deckCss, deckToHtml, freeDoc, isFree, plainText, slideHtml, themeOf, themeVars, type Deck, type Slide } from "@/lib/decks";
import { buildPptx } from "@/lib/decks-pptx";

export async function decksApi<T = Record<string, unknown>>(body: Record<string, unknown>): Promise<T> {
  const t = await auth.currentUser?.getIdToken();
  if (!t) throw new Error("Please sign in again.");
  const res = await fetch("/api/decks", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + t }, body: JSON.stringify(body) });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(d?.error || "Request failed.");
  return d as T;
}

export const DeckStyles = () => <style>{deckCss()}</style>;

const cssVars = (theme: string): React.CSSProperties => Object.fromEntries(themeVars(themeOf(theme)).split(";").map((p) => { const i = p.indexOf(":"); return [p.slice(0, i), p.slice(i + 1)]; })) as React.CSSProperties;

/** One slide, drawn on a 1280x720 canvas and scaled to fit its box. */
export function SlideView({ deck, index, style }: { deck: Pick<Deck, "theme" | "slides">; index: number; style?: React.CSSProperties }) {
  const box = useRef<HTMLDivElement>(null);
  const [k, setK] = useState(0.4);
  useEffect(() => {
    const el = box.current; if (!el) return;
    const fit = () => setK(el.clientWidth / 1280);
    fit();
    const ro = new ResizeObserver(fit); ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const sl = deck.slides[index];
  const html = useMemo(() => (sl ? slideHtml(sl, index + 1, deck.slides.length) : ""), [sl, index, deck.slides.length]);
  return (
    <div ref={box} className="dk" style={{ position: "relative", width: "100%", aspectRatio: "16 / 9", overflow: "hidden", borderRadius: "inherit", ...cssVars(deck.theme), ...style }}>
      <div style={{ width: 1280, height: 720, transform: `scale(${k})`, transformOrigin: "0 0" }} dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}

const lines = (a?: string[]) => (a ?? []).join("\n");
const unlines = (t: string) => t.split("\n").map((x) => x.trim()).filter(Boolean);
const pair = (t: string) => unlines(t).map((l) => { const [a, ...b] = l.split("|"); return [a.trim(), b.join("|").trim()] as const; });
const BLANK: Slide = { layout: "bullets", title: "New slide", bullets: ["First point"] };
const BLANK_FREE: Slide = { layout: "free", html: "<div style='width:1280px;height:720px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;background:linear-gradient(135deg,#14112b,#2b1d63);color:#fff;font-family:Inter,system-ui,sans-serif;text-align:center'><div style='font-size:76px;font-weight:800'>New slide</div><div style='font-size:30px;opacity:.7'>Edit the design in the panel, or ask your agent</div></div>" };

function download(name: string, data: Blob) {
  const a = document.createElement("a"); a.href = URL.createObjectURL(data); a.download = name;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
let pptxLoad: Promise<unknown> | null = null;
function loadPptx(): Promise<new () => unknown> {
  const w = window as unknown as { PptxGenJS?: new () => unknown };
  if (w.PptxGenJS) return Promise.resolve(w.PptxGenJS);
  pptxLoad ||= new Promise((ok, no) => {
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/pptxgenjs@4.0.1/dist/pptxgen.bundle.js";
    s.onload = () => ok(null); s.onerror = () => { pptxLoad = null; no(new Error("Could not load the PowerPoint maker (check your internet).")); };
    document.head.appendChild(s);
  });
  return pptxLoad.then(() => w.PptxGenJS as new () => unknown);
}

let h2cLoad: Promise<unknown> | null = null;
type H2c = (el: HTMLElement, o: Record<string, unknown>) => Promise<HTMLCanvasElement>;
function loadH2c(): Promise<H2c> {
  const w = window as unknown as { html2canvas?: H2c };
  if (w.html2canvas) return Promise.resolve(w.html2canvas);
  h2cLoad ||= new Promise((ok, no) => {
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js";
    s.onload = () => ok(null); s.onerror = () => { h2cLoad = null; no(new Error("html2canvas failed to load")); };
    document.head.appendChild(s);
  });
  return h2cLoad.then(() => w.html2canvas as H2c);
}

/** A free-form slide as a PNG picture (for PowerPoint). Tries html2canvas first, then the browser's own SVG renderer; null when neither works. */
async function slideToPng(html: string): Promise<string | null> {
  try {
    const h2c = await loadH2c();
    const fr = document.createElement("iframe");
    fr.setAttribute("sandbox", "allow-same-origin"); // no scripts can run in it
    fr.style.cssText = `position:fixed;left:-99999px;top:0;width:${SLIDE_W}px;height:${SLIDE_H}px;border:0;opacity:0;pointer-events:none`;
    fr.srcdoc = freeDoc(html);
    const loaded = new Promise((ok) => { fr.onload = () => ok(null); window.setTimeout(() => ok(null), 4000); });
    document.body.appendChild(fr);
    try {
      await loaded;
      await new Promise((ok) => window.setTimeout(ok, 120));
      const body = fr.contentDocument?.body;
      if (body) { const c = await h2c(body, { width: SLIDE_W, height: SLIDE_H, windowWidth: SLIDE_W, windowHeight: SLIDE_H, scale: 1.5, backgroundColor: "#ffffff", logging: false }); return c.toDataURL("image/png"); }
    } finally { fr.remove(); }
  } catch { /* try the second way */ }
  try {
    const host = document.createElement("div");
    host.innerHTML = html;
    host.setAttribute("style", `width:${SLIDE_W}px;height:${SLIDE_H}px;overflow:hidden;background:#fff;font-family:Inter,'Segoe UI',system-ui,Arial,sans-serif`);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${SLIDE_W}" height="${SLIDE_H}"><foreignObject width="100%" height="100%">${new XMLSerializer().serializeToString(host)}</foreignObject></svg>`;
    const img = new Image();
    await new Promise<void>((ok, no) => { img.onload = () => ok(); img.onerror = () => no(new Error("svg")); img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg); });
    const c = document.createElement("canvas"); c.width = 1920; c.height = 1080;
    c.getContext("2d")?.drawImage(img, 0, 0, 1920, 1080);
    return c.toDataURL("image/png");
  } catch { return null; }
}

export default function DeckViewer({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const [deck, setDeck] = useState<Deck | null>(null);
  const [idx, setIdx] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [present, setPresent] = useState(false);
  const [notes, setNotes] = useState(false);
  const [raw, setRaw] = useState<Record<string, string>>({});

  useEffect(() => {
    let live = true;
    decksApi<{ deck: Deck }>({ action: "get", id }).then((d) => { if (live) setDeck(d.deck); }).catch((e) => live && setErr(e instanceof Error ? e.message : "Could not open the deck."));
    return () => { live = false; };
  }, [id]);
  useEffect(() => { setRaw({}); }, [idx]);

  const sl = deck?.slides[idx];
  const edit = useCallback((patch: Partial<Slide>) => { setDeck((d) => d && { ...d, slides: d.slides.map((s, i) => (i === idx ? { ...s, ...patch } : s)) }); setDirty(true); }, [idx]);
  const slides = (next: Slide[], at = idx) => { setDeck((d) => d && { ...d, slides: next }); setIdx(Math.max(0, Math.min(next.length - 1, at))); setDirty(true); };

  async function save() {
    if (!deck) return;
    setBusy("save"); setErr("");
    try { const r = await decksApi<{ deck: Deck }>({ action: "save", deck }); setDeck(r.deck); setDirty(false); onChanged(); }
    catch (e) { setErr(e instanceof Error ? e.message : "Could not save."); }
    setBusy("");
  }
  async function remove() {
    if (!deck || !window.confirm(`Delete the deck “${deck.title}”? This cannot be undone.`)) return;
    try { await decksApi({ action: "delete", id: deck.id }); onChanged(); onClose(); } catch (e) { setErr(e instanceof Error ? e.message : "Could not delete."); }
  }
  async function pptx() {
    if (!deck) return;
    setBusy("pptx"); setErr("");
    try {
      const P = await loadPptx();
      const images: Array<string | null> = [];
      let failed = 0;
      for (const s of deck.slides) {
        if (!isFree(s)) { images.push(null); continue; }
        const png = await slideToPng(s.html as string);
        if (!png) failed++;
        images.push(png);
      }
      const p = buildPptx(new P(), deck, images) as { write: (o: { outputType: string }) => Promise<Blob> };
      download(`${deck.title.replace(/[^\w\- ]+/g, "").trim().slice(0, 60) || "deck"}.pptx`, await p.write({ outputType: "blob" }));
      if (failed) setErr(`${failed} slide(s) could not be turned into a picture in this browser, so only their text went into the PowerPoint. Use the HTML or PDF download for the exact design.`);
    } catch (e) { setErr(e instanceof Error ? e.message : "PowerPoint export failed."); }
    setBusy("");
  }
  const html = (print: boolean) => {
    if (!deck) return;
    const blob = new Blob([deckToHtml(deck)], { type: "text/html" });
    if (print) window.open(URL.createObjectURL(blob) + "#print", "_blank");
    else download(`${deck.title.replace(/[^\w\- ]+/g, "").trim().slice(0, 60) || "deck"}.html`, blob);
  };

  // Esc closes the viewer (when not presenting and nothing is unsaved)
  useEffect(() => {
    if (present) return;
    const k = (e: KeyboardEvent) => { if (e.key === "Escape" && !dirty) onClose(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [present, dirty, onClose]);

  // Present mode keys
  useEffect(() => {
    if (!present || !deck) return;
    const k = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPresent(false);
      else if (["ArrowRight", " ", "PageDown", "Enter"].includes(e.key)) setIdx((i) => Math.min(deck.slides.length - 1, i + 1));
      else if (["ArrowLeft", "PageUp", "Backspace"].includes(e.key)) setIdx((i) => Math.max(0, i - 1));
      else if (e.key === "n" || e.key === "N") setNotes((v) => !v);
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [present, deck]);

  const inp = "w-full rounded-md border border-line bg-bg px-2.5 py-1.5 text-xs text-ink placeholder:text-faint focus:border-gold focus:outline-none";
  const lab = "mb-1 mt-3 block text-[10px] font-medium uppercase tracking-wider text-faint";
  const L = sl?.layout;
  const field = (key: string, derived: string, set: (t: string) => void, rows = 4, ph = "") => (
    <textarea rows={rows} className={`${inp} ${key === "h" ? "font-mono text-[11px]" : ""}`} placeholder={ph} value={raw[key] ?? derived} onChange={(e) => { setRaw((r) => ({ ...r, [key]: e.target.value })); set(e.target.value); }} />
  );

  return (
    <div
      className="fixed inset-0 z-[60] flex flex-col bg-bg text-ink"
      /* nothing inside the viewer may reach the windows behind it (that used to close everything) */
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <DeckStyles />
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
        <input value={deck?.title ?? ""} onChange={(e) => { setDeck((d) => d && { ...d, title: e.target.value }); setDirty(true); }} className="min-w-[160px] flex-1 rounded-md bg-transparent px-2 py-1.5 text-sm font-medium text-ink focus:bg-panel2 focus:outline-none" aria-label="Deck title" />
        {deck?.slides.some((s) => !isFree(s)) && <select value={deck?.theme ?? "venus"} onChange={(e) => { setDeck((d) => d && { ...d, theme: e.target.value }); setDirty(true); }} className="rounded-md border border-line bg-bg px-2 py-1.5 text-xs text-ink" aria-label="Theme">
          {DECK_THEMES.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>}
        <button onClick={() => { setIdx(0); setPresent(true); }} disabled={!deck} className="flex items-center gap-1.5 rounded-md bg-white px-3 py-1.5 text-xs font-medium text-bg disabled:opacity-50"><Play size={13} /> Present</button>
        <button onClick={pptx} disabled={!deck || busy === "pptx"} className="flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-xs hover:bg-panel2 disabled:opacity-50">{busy === "pptx" ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />} PowerPoint</button>
        <button onClick={() => html(false)} disabled={!deck} className="flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-xs hover:bg-panel2 disabled:opacity-50"><FileDown size={13} /> HTML</button>
        <button onClick={() => html(true)} disabled={!deck} className="flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-xs hover:bg-panel2 disabled:opacity-50"><Printer size={13} /> PDF</button>
        <button onClick={save} disabled={!dirty || busy === "save"} className="flex items-center gap-1.5 rounded-md bg-avatar-teal px-3 py-1.5 text-xs font-medium text-black disabled:opacity-40">{busy === "save" ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} {dirty ? "Save" : "Saved"}</button>
        <button onClick={remove} disabled={!deck} title="Delete deck" className="rounded-md p-1.5 text-muted hover:text-red-400"><Trash2 size={16} /></button>
        <button onClick={() => { if (!dirty || window.confirm("You have unsaved changes. Close anyway?")) onClose(); }} title="Close" className="rounded-full p-1.5 text-muted hover:bg-panel2 hover:text-ink"><X size={18} /></button>
      </div>
      {err && <p className="border-b border-red-900/50 bg-red-950/40 px-4 py-2 text-xs text-red-300">{err}</p>}
      {!deck && !err && <div className="flex flex-1 items-center justify-center text-sm text-muted"><Loader2 className="mr-2 animate-spin" size={16} /> Opening…</div>}
      {deck && deck.slides.length === 0 && <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-muted">This presentation has no slides, so it cannot be shown. Delete it with the bin icon above, then make a new one.</div>}

      {deck && sl && (
        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          <div className="hidden w-[190px] shrink-0 space-y-2 overflow-y-auto border-r border-line p-2 md:block">
            {deck.slides.map((s, i) => (
              <button key={i} onClick={() => setIdx(i)} className={`block w-full rounded-lg border p-0.5 text-left ${i === idx ? "border-gold" : "border-line hover:border-muted"}`} aria-label={`Slide ${i + 1}`}>
                <SlideView deck={{ theme: deck.theme, slides: [s] }} index={0} style={{ borderRadius: 6 }} />
                <span className="block truncate px-1 py-0.5 text-[10px] text-faint">{i + 1} · {isFree(s) ? (plainText(s.html as string)[0] ?? "slide") : s.layout}</span>
              </button>
            ))}
          </div>

          <div className="flex min-h-0 min-w-0 flex-1 flex-col items-center overflow-y-auto p-3 md:p-5">
            <div className="w-full max-w-[960px] overflow-hidden rounded-xl border border-line shadow-2xl"><SlideView deck={deck} index={idx} /></div>
            <div className="mt-3 flex flex-wrap items-center justify-center gap-2 text-xs">
              <button onClick={() => setIdx(Math.max(0, idx - 1))} className="rounded-md border border-line px-3 py-1.5 hover:bg-panel2">←</button>
              <span className="text-muted">{idx + 1} / {deck.slides.length}</span>
              <button onClick={() => setIdx(Math.min(deck.slides.length - 1, idx + 1))} className="rounded-md border border-line px-3 py-1.5 hover:bg-panel2">→</button>
              <button onClick={() => slides([...deck.slides.slice(0, idx + 1), { ...(isFree(sl) ? BLANK_FREE : BLANK) }, ...deck.slides.slice(idx + 1)], idx + 1)} className="flex items-center gap-1 rounded-md border border-line px-3 py-1.5 hover:bg-panel2"><Plus size={13} /> Slide</button>
              <button onClick={() => slides([...deck.slides.slice(0, idx + 1), JSON.parse(JSON.stringify(sl)), ...deck.slides.slice(idx + 1)], idx + 1)} className="flex items-center gap-1 rounded-md border border-line px-3 py-1.5 hover:bg-panel2"><Copy size={13} /> Duplicate</button>
              <button disabled={idx === 0} onClick={() => { const a = [...deck.slides]; [a[idx - 1], a[idx]] = [a[idx], a[idx - 1]]; slides(a, idx - 1); }} className="rounded-md border border-line p-1.5 hover:bg-panel2 disabled:opacity-30" title="Move up"><ChevronUp size={14} /></button>
              <button disabled={idx >= deck.slides.length - 1} onClick={() => { const a = [...deck.slides]; [a[idx + 1], a[idx]] = [a[idx], a[idx + 1]]; slides(a, idx + 1); }} className="rounded-md border border-line p-1.5 hover:bg-panel2 disabled:opacity-30" title="Move down"><ChevronDown size={14} /></button>
              <button disabled={deck.slides.length < 2} onClick={() => slides(deck.slides.filter((_, i) => i !== idx), Math.min(idx, deck.slides.length - 2))} className="rounded-md border border-line p-1.5 text-red-400 hover:bg-panel2 disabled:opacity-30" title="Delete slide"><Trash2 size={14} /></button>
            </div>
            {sl.notes && <p className="mt-3 max-w-[960px] rounded-lg border border-line bg-panel px-3 py-2 text-xs text-muted"><b className="text-ink">Speaker notes:</b> {sl.notes}</p>}
          </div>

          <div className="max-h-[42vh] w-full shrink-0 overflow-y-auto border-t border-line bg-panel p-4 md:max-h-none md:w-[300px] md:border-l md:border-t-0">
            <p className="text-xs font-medium text-ink">Edit slide {idx + 1}</p>
            <label className={lab}>Layout</label>
            <select value={sl.layout} onChange={(e) => { const l = e.target.value as Slide["layout"]; edit(l === "free" ? { layout: l, html: sl.html || BLANK_FREE.html } : { layout: l, html: undefined, title: sl.title || plainText(sl.html ?? "")[0] || "New slide" }); }} className={inp}>{LAYOUTS.map((l) => <option key={l} value={l}>{l === "free" ? "free design (HTML)" : `${l} (old layout)`}</option>)}</select>
            {L === "free" && <><label className={lab}>Slide design (HTML + CSS, 1280 × 720)</label>{field("h", sl.html ?? "", (t) => edit({ html: t }), 14, "<div style=\"width:1280px;height:720px\">…</div>")}<p className="mt-1 text-[10px] leading-relaxed text-faint">Scripts and outside links are removed when you save. Easiest: tell your agent “redesign slide {idx + 1}: …”.</p></>}
            {L !== "free" && <><label className={lab}>Small label (kicker)</label><input className={inp} value={sl.kicker ?? ""} onChange={(e) => edit({ kicker: e.target.value })} /></>}
            {L !== "quote" && L !== "free" && <><label className={lab}>Title</label><input className={inp} value={sl.title ?? ""} onChange={(e) => edit({ title: e.target.value })} /></>}
            {["title", "section", "closing"].includes(L as string) && <><label className={lab}>Subtitle</label><input className={inp} value={sl.subtitle ?? ""} onChange={(e) => edit({ subtitle: e.target.value })} /></>}
            {["title", "bullets", "stats"].includes(L as string) && <><label className={lab}>{L === "title" ? "Presenter / date" : "Lead sentence"}</label><input className={inp} value={sl.body ?? ""} onChange={(e) => edit({ body: e.target.value })} /></>}
            {["bullets", "closing"].includes(L as string) && <><label className={lab}>{L === "closing" ? "Contact lines (one per line)" : "Bullets (one per line)"}</label>{field("b", lines(sl.bullets), (t) => edit({ bullets: unlines(t) }), 6)}</>}
            {["two-column", "comparison"].includes(L as string) && (["left", "right"] as const).map((side) => (
              <div key={side}>
                <label className={lab}>{side} column title</label><input className={inp} value={sl[side]?.title ?? ""} onChange={(e) => edit({ [side]: { title: e.target.value, bullets: sl[side]?.bullets ?? [] } })} />
                <label className={lab}>{side} bullets</label>{field(side, lines(sl[side]?.bullets), (t) => edit({ [side]: { title: sl[side]?.title, bullets: unlines(t) } }), 4)}
              </div>
            ))}
            {L === "stats" && <><label className={lab}>Numbers (value | label)</label>{field("st", (sl.stats ?? []).map((x) => `${x.value} | ${x.label}`).join("\n"), (t) => edit({ stats: pair(t).map(([value, label]) => ({ value, label })) }), 4, "4x | faster")}</>}
            {L === "timeline" && <><label className={lab}>Steps (title | text)</label>{field("sp", (sl.steps ?? []).map((x) => `${x.title} | ${x.text ?? ""}`).join("\n"), (t) => edit({ steps: pair(t).map(([title, text]) => ({ title, text: text || undefined })) }), 5, "Plan | what happens")}</>}
            {L === "quote" && <><label className={lab}>Quote</label>{field("q", sl.quote ?? "", (t) => edit({ quote: t }), 3)}<label className={lab}>Said by</label><input className={inp} value={sl.by ?? ""} onChange={(e) => edit({ by: e.target.value })} /></>}
            <label className={lab}>Speaker notes</label>{field("n", sl.notes ?? "", (t) => edit({ notes: t }), 3)}
            <p className="mt-4 text-[11px] leading-relaxed text-faint">Tip: you can also ask your agent in the chat — “change slide 3 to a timeline”, “make the deck shorter”.</p>
          </div>
        </div>
      )}

      {present && deck && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black" onClick={(e) => { const x = e.clientX / window.innerWidth; setIdx((i) => (x > 0.5 ? Math.min(deck.slides.length - 1, i + 1) : Math.max(0, i - 1))); }}>
          <div style={{ width: "min(100vw, calc(100vh * 16 / 9))" }}><SlideView deck={deck} index={idx} style={{ borderRadius: 0 }} /></div>
          <button onClick={(e) => { e.stopPropagation(); setPresent(false); }} className="absolute right-3 top-3 rounded-full bg-white/15 p-2 text-white hover:bg-white/25" aria-label="Exit"><X size={18} /></button>
          <div className="absolute bottom-0 left-0 h-1 bg-avatar-violet transition-all" style={{ width: `${((idx + 1) / deck.slides.length) * 100}%` }} />
          {notes && <div className="absolute inset-x-0 bottom-0 bg-black/85 px-6 py-4 text-base leading-relaxed text-white">{sl?.notes || "No notes for this slide."}</div>}
          <p className="absolute bottom-2 right-4 text-[11px] text-white/50">← → · N notes · Esc</p>
        </div>
      )}
    </div>
  );
}
