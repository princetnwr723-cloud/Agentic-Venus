// Builds a real PowerPoint (.pptx) from a deck. `pptx` is a `new PptxGenJS()` (passed in, so this file has no import and can run in the browser or in tests).
import { isFree, plainText, themeOf, type Deck } from "@/lib/decks";

const hex = (c: string) => {
  const m = /^#([0-9a-f]{6})$/i.exec(c.trim());
  if (m) return m[1].toUpperCase();
  return c.includes("255,255,255") ? "FFFFFF" : "FFFFFF";
};
const mix = (a: string, b: string, t: number) => {
  const p = (h: string, i: number) => parseInt(h.slice(i, i + 2), 16);
  return [0, 2, 4].map((i) => Math.round(p(a, i) * (1 - t) + p(b, i) * t).toString(16).padStart(2, "0")).join("").toUpperCase();
};

/**
 * `images[i]` is a picture (PNG data URL) of slide i. A free-form slide (designed by the model as HTML) goes into PowerPoint as that
 * picture, so it looks exactly like the preview; when no picture could be made, its text goes in as a plain slide instead.
 */
export function buildPptx(pptx: any, deck: Pick<Deck, "title" | "theme" | "slides">, images: Array<string | null | undefined> = []) {
  const t = themeOf(deck.theme);
  const bg = hex(t.bg), fg = hex(t.fg), ac = hex(t.ac), ac2 = hex(t.ac2), sub = mix(bg, fg, 0.62), card = mix(bg, fg, 0.09);
  const font = /Georgia/.test(t.hf) ? "Georgia" : "Calibri";
  pptx.layout = "LAYOUT_16x9"; // 10 x 5.625 in
  pptx.title = deck.title;
  pptx.author = "AgenticVenus";
  const W = 10;
  const total = deck.slides.length;

  deck.slides.forEach((sl, idx) => {
    if (isFree(sl)) {
      const f = pptx.addSlide();
      if (sl.notes) f.addNotes(sl.notes);
      const img = images[idx];
      f.background = { color: img ? "FFFFFF" : bg };
      if (img) { f.addImage({ data: img.replace(/^data:/, ""), x: 0, y: 0, w: 10, h: 5.625 }); return; }
      const [head, ...rest] = plainText(sl.html as string);
      f.addText(head ?? "", { x: 0.65, y: 0.5, w: 8.7, h: 1.1, fontFace: font, fontSize: 30, bold: true, color: fg, margin: 0, valign: "top" });
      if (rest.length) f.addText(rest.slice(0, 12).map((b) => ({ text: b, options: { bullet: { indent: 16 }, breakLine: true, paraSpaceAfter: 8 } })), { x: 0.65, y: 1.8, w: 8.7, h: 3.3, fontFace: font, fontSize: 16, color: fg, margin: 0, valign: "top" });
      return;
    }
    const s = pptx.addSlide();
    s.background = { color: bg };
    s.addShape(pptx.ShapeType.ellipse, { x: 7.6, y: -1.7, w: 4.2, h: 4.2, fill: { color: ac, transparency: 84 }, line: { color: ac, transparency: 100 } });
    s.addShape(pptx.ShapeType.ellipse, { x: -1.3, y: 4.1, w: 3.6, h: 3.6, fill: { color: ac2, transparency: 88 }, line: { color: ac2, transparency: 100 } });
    if (sl.notes) s.addNotes(sl.notes);
    const text = (str: string, o: Record<string, unknown>) => s.addText(str, { fontFace: font, color: fg, margin: 0, ...o });
    const title = (y = 0.45) => {
      if (sl.kicker) text(sl.kicker.toUpperCase(), { x: 0.65, y, w: 8.7, h: 0.3, fontSize: 11, bold: true, color: ac, charSpacing: 3 });
      if (sl.title) text(sl.title, { x: 0.65, y: y + (sl.kicker ? 0.32 : 0), w: 8.7, h: 0.9, fontSize: sl.title.length > 55 ? 24 : 30, bold: true, valign: "top" });
    };
    const bullets = (items: string[], x: number, y: number, w: number, h: number, size: number) =>
      text("", { x, y, w, h }) && s.addText(items.map((b) => ({ text: b, options: { bullet: { indent: 16 }, breakLine: true, paraSpaceAfter: 8 } })), { x, y, w, h, fontFace: font, color: fg, fontSize: size, valign: "top", margin: 0 });

    switch (sl.layout) {
      case "title":
      case "section":
      case "closing": {
        const mid = sl.layout === "title" ? 1.55 : 1.45;
        const align = sl.layout === "title" ? "left" : "center";
        if (sl.layout === "title") s.addShape(pptx.ShapeType.roundRect, { x: 0.65, y: 1.2, w: 1, h: 0.08, fill: { color: ac }, line: { color: ac, transparency: 100 }, rectRadius: 0.04 });
        if (sl.kicker) text(sl.kicker, { x: 0.65, y: mid - 0.55 + (sl.layout === "title" ? 0.1 : 0), w: 8.7, h: sl.layout === "section" ? 0.9 : 0.3, fontSize: sl.layout === "section" ? 44 : 12, bold: true, color: ac, align });
        text(sl.title ?? "", { x: 0.65, y: mid + 0.2, w: 8.7, h: 1.6, fontSize: (sl.title?.length ?? 0) > 40 ? 34 : 44, bold: true, align, valign: "top" });
        if (sl.subtitle) text(sl.subtitle, { x: 0.65, y: mid + 1.85, w: 8.7, h: 0.9, fontSize: 18, color: sub, align, valign: "top" });
        if (sl.body) text(sl.body, { x: 0.65, y: 4.6, w: 8.7, h: 0.4, fontSize: 13, color: ac, align });
        if (sl.layout === "closing" && sl.bullets?.length) text(sl.bullets.join("   •   "), { x: 0.65, y: 4.35, w: 8.7, h: 0.5, fontSize: 14, color: sub, align });
        break;
      }
      case "two-column":
      case "comparison": {
        title();
        [sl.left, sl.right].forEach((c, i) => {
          const x = 0.65 + i * 4.4;
          s.addShape(pptx.ShapeType.roundRect, { x, y: 1.75, w: 4.3, h: 3.2, fill: { color: card }, line: { color: mix(bg, fg, 0.18), width: 0.75 }, rectRadius: 0.15 });
          if (c?.title) text(c.title, { x: x + 0.25, y: 1.92, w: 3.8, h: 0.4, fontSize: 15, bold: true, color: i ? ac2 : ac });
          if (c?.bullets.length) bullets(c.bullets, x + 0.25, c.title ? 2.4 : 1.95, 3.8, 2.4, 13);
        });
        break;
      }
      case "stats": {
        title();
        const n = sl.stats?.length || 1, gap = 0.25, w = (8.7 - gap * (n - 1)) / n;
        (sl.stats ?? []).forEach((st, i) => {
          const x = 0.65 + i * (w + gap);
          s.addShape(pptx.ShapeType.roundRect, { x, y: 1.9, w, h: 2.1, fill: { color: card }, line: { color: mix(bg, fg, 0.18), width: 0.75 }, rectRadius: 0.18 });
          text(st.value, { x, y: 2.15, w, h: 0.9, fontSize: 38, bold: true, color: ac, align: "center" });
          text(st.label, { x: x + 0.15, y: 3.15, w: w - 0.3, h: 0.6, fontSize: 13, color: sub, align: "center", valign: "top" });
        });
        if (sl.body) text(sl.body, { x: 0.65, y: 4.25, w: 8.7, h: 0.7, fontSize: 15, color: sub, valign: "top" });
        break;
      }
      case "timeline": {
        title();
        const n = sl.steps?.length || 1, gap = 0.18, w = (8.7 - gap * (n - 1)) / n;
        (sl.steps ?? []).forEach((st, i) => {
          const x = 0.65 + i * (w + gap);
          s.addShape(pptx.ShapeType.roundRect, { x, y: 2.1, w, h: 2.6, fill: { color: card }, line: { color: mix(bg, fg, 0.18), width: 0.75 }, rectRadius: 0.15 });
          s.addShape(pptx.ShapeType.ellipse, { x: x + 0.15, y: 1.85, w: 0.5, h: 0.5, fill: { color: ac }, line: { color: ac, transparency: 100 } });
          text(String(i + 1), { x: x + 0.15, y: 1.85, w: 0.5, h: 0.5, fontSize: 14, bold: true, color: "FFFFFF", align: "center", valign: "middle" });
          text(st.title, { x: x + 0.15, y: 2.5, w: w - 0.3, h: 0.6, fontSize: 14, bold: true, valign: "top" });
          if (st.text) text(st.text, { x: x + 0.15, y: 3.15, w: w - 0.3, h: 1.4, fontSize: 11, color: sub, valign: "top" });
        });
        break;
      }
      case "quote":
        text("“", { x: 0.65, y: 0.9, w: 1.5, h: 1.2, fontSize: 90, color: ac, fontFace: "Georgia" });
        text(sl.quote ?? "", { x: 0.65, y: 1.9, w: 8.7, h: 2, fontSize: (sl.quote?.length ?? 0) > 140 ? 24 : 30, bold: true, valign: "top" });
        if (sl.by) text("— " + sl.by, { x: 0.65, y: 4.1, w: 8.7, h: 0.4, fontSize: 15, color: ac });
        break;
      default:
        title();
        if (sl.body) text(sl.body, { x: 0.65, y: 1.65, w: 8.7, h: 0.6, fontSize: 15, color: sub, valign: "top" });
        if (sl.bullets?.length) bullets(sl.bullets, 0.65, sl.body ? 2.35 : 1.75, 8.7, sl.body ? 2.7 : 3.3, sl.bullets.length > 6 || sl.bullets.join("").length > 420 ? 15 : 19);
    }
    text("AgenticVenus", { x: 0.65, y: 5.2, w: 3, h: 0.25, fontSize: 8, color: sub });
    text(`${idx + 1} / ${total}`, { x: 8.35, y: 5.2, w: 1, h: 0.25, fontSize: 9, color: sub, align: "right" });
  });
  return pptx;
}
