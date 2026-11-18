// Server-only. The agent makes real files itself (text files, PDF, Word, Excel, PowerPoint, ZIP) and hands the owner a private download link.
// No computer, no extra library: the PDF writer lives here, the Word / Excel / PowerPoint / ZIP writers in office.ts.
import { deflateSync } from "zlib";
import { attachmentUrl, findAttachment, markReady, signAttachment } from "@/lib/attachments-server";
import { humanSize } from "@/lib/attachments";
import type { Def } from "./plugins";
import { OFFICE_MIME, docxEntries, pptxEntries, xlsxEntries, zipOf, type Sheet, type Slide } from "./office";
import { parseCsv, toCsv } from "./pack/core";
import type { ToolCtx } from "./types";

const s = (v: unknown, n = 4000) => String(v ?? "").trim().slice(0, n);
const need = (ctx?: ToolCtx): ToolCtx => { if (!ctx) throw new Error("Files can only be made from a chat."); return ctx; };

const TEXT_MIME: Record<string, string> = {
  txt: "text/plain", md: "text/markdown", csv: "text/csv", tsv: "text/tab-separated-values", json: "application/json", html: "text/html", htm: "text/html",
  css: "text/css", js: "text/javascript", ts: "text/plain", tsx: "text/plain", jsx: "text/plain", py: "text/x-python", sql: "text/plain", xml: "application/xml",
  yaml: "text/yaml", yml: "text/yaml", svg: "image/svg+xml", ics: "text/calendar", vcf: "text/vcard", sh: "text/x-shellscript", log: "text/plain", ini: "text/plain", toml: "text/plain",
};

const cleanName = (name: string, fallbackExt: string) => {
  const base = s(name, 90).split(/[\\/]/).pop() || "file";
  return /\.[A-Za-z0-9]{1,8}$/.test(base) ? base : `${base}.${fallbackExt}`;
};

/** Stores the bytes as an attachment of this chat and returns the message for the owner (with the private link). */
async function saveFile(ctx: ToolCtx, name: string, mime: string, bytes: Buffer): Promise<string> {
  if (bytes.length === 0) throw new Error("The file would be empty.");
  const sg = await signAttachment(ctx.uid, ctx.chatId, { name, size: bytes.length, mime });
  const r = await fetch(sg.uploadUrl, {
    method: "PUT", headers: { "Content-Type": mime, "x-upsert": "true" }, body: new Uint8Array(bytes), signal: AbortSignal.timeout(90_000),
  });
  if (!r.ok) throw new Error(`Saving the file failed (HTTP ${r.status}).`);
  await markReady(ctx.uid, ctx.chatId, sg.id);
  const doc = await findAttachment(ctx.uid, ctx.chatId, sg.id);
  if (!doc) throw new Error("The file was saved but could not be found again.");
  return `📎 ${doc.name} (${humanSize(bytes.length)}): ${await attachmentUrl(doc)}\nThe chat shows this file to the owner as a file card by itself. Put the link above on its own line in your reply, exactly as given, with one short sentence about what is inside. The file is saved in this chat for good and the card opens it any time, so never say that the link expires or that the file will be deleted.`;
}

// ---------------- ZIP ----------------
const entryName = (n: string) => String(n).replace(/\\/g, "/").split("/").filter((p) => p && p !== "." && p !== "..").join("/").slice(0, 200) || "file";

// ---------------- PDF ----------------
// Widths of Helvetica for the characters 32..126 (per 1000 em).
const HELV = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, // space ! " # $ % & ' ( ) * + , - . /
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, // 0-9
  278, 278, 584, 584, 584, 556, 1015, // : ; < = > ? @
  667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, // A-Z
  278, 278, 278, 469, 556, 333, // [ \ ] ^ _ `
  556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, // a-z
  334, 260, 334, 584, // { | } ~
];
const CP1252: Record<string, string> = { "“": "\x93", "”": "\x94", "‘": "\x91", "’": "\x92", "–": "\x96", "—": "\x97", "•": "\x95", "…": "\x85", "€": "\x80", "\u00a0": " " };

function latin(t: string): string {
  let out = "";
  for (const ch of t) {
    const c = ch.charCodeAt(0);
    if (CP1252[ch]) out += CP1252[ch];
    else if (ch === "\t") out += "    ";
    else if (c >= 32 && c < 256) out += ch;
    else if (c < 32) out += " ";
    else throw new Error("This text has letters that the built-in PDF font cannot show (for example Hindi, Arabic or emoji). Make it with file.create as an .html file the owner can print as PDF, or use the computer (Python reportlab with a Unicode font).");
  }
  return out;
}
const width = (t: string, size: number, bold: boolean) => {
  let w = 0;
  for (const ch of t) { const c = ch.charCodeAt(0); w += c >= 32 && c <= 126 ? HELV[c - 32] : 556; }
  return (w * size / 1000) * (bold ? 1.06 : 1);
};
const esc = (t: string) => t.replace(/[\\()]/g, "\\$&");

type Block = { text: string; size: number; bold: boolean; indent: number; before: number; hang?: boolean };

function blocksOf(title: string, body: string): Block[] {
  const out: Block[] = [];
  if (title) out.push({ text: title, size: 22, bold: true, indent: 0, before: 0 });
  for (const raw of body.replace(/\r/g, "").split("\n")) {
    const line = raw.trimEnd();
    if (!line.trim()) { out.push({ text: "", size: 11, bold: false, indent: 0, before: 4 }); continue; }
    const t = line.replace(/\*\*|__/g, "");
    const h = /^(#{1,3})\s+(.*)$/.exec(t);
    if (h) { out.push({ text: h[2], size: h[1].length === 1 ? 17 : h[1].length === 2 ? 14 : 12, bold: true, indent: 0, before: h[1].length === 1 ? 12 : 8 }); continue; }
    const b = /^\s*[-*•]\s+(.*)$/.exec(t);
    if (b) { out.push({ text: "• " + b[1], size: 11, bold: false, indent: 14, before: 2, hang: true }); continue; }
    const n = /^\s*(\d+[.)])\s+(.*)$/.exec(t);
    if (n) { out.push({ text: n[1] + " " + n[2], size: 11, bold: false, indent: 14, before: 2, hang: true }); continue; }
    out.push({ text: t.trim(), size: 11, bold: false, indent: 0, before: 3 });
  }
  return out;
}

function pdfOf(title: string, body: string): Buffer {
  const W = 595, H = 842, M = 56, maxW = W - 2 * M;
  const pages: string[][] = [[]];
  let y = H - M;
  const put = (text: string, x: number, size: number, bold: boolean) => {
    pages[pages.length - 1].push(`BT /${bold ? "F2" : "F1"} ${size} Tf ${x.toFixed(1)} ${y.toFixed(1)} Td (${esc(latin(text))}) Tj ET`);
  };
  for (const blk of blocksOf(title, body)) {
    if (!blk.text) { y -= blk.before; continue; }
    const leading = blk.size * 1.35;
    const words = blk.text.split(/\s+/);
    const lines: string[] = [];
    let cur = "";
    const avail = maxW - blk.indent;
    for (const w of words) {
      const trial = cur ? cur + " " + w : w;
      if (width(trial, blk.size, blk.bold) <= avail || !cur) cur = trial; else { lines.push(cur); cur = w; }
    }
    if (cur) lines.push(cur);
    y -= blk.before;
    lines.forEach((ln, i) => {
      if (y - leading < M) { pages.push([]); y = H - M; }
      y -= leading;
      put(ln, M + blk.indent + (blk.hang && i > 0 ? 10 : 0), blk.size, blk.bold);
    });
  }
  // page numbers
  pages.forEach((p, i) => {
    const label = `${i + 1} / ${pages.length}`;
    p.push(`BT /F1 9 Tf ${(W / 2 - width(label, 9, false) / 2).toFixed(1)} 30 Td (${label}) Tj ET`);
  });

  const objs: Buffer[] = [];
  const n = pages.length;
  const kids = pages.map((_, i) => `${5 + 2 * i} 0 R`).join(" ");
  objs.push(Buffer.from("<< /Type /Catalog /Pages 2 0 R >>"));
  objs.push(Buffer.from(`<< /Type /Pages /Kids [${kids}] /Count ${n} >>`));
  objs.push(Buffer.from("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>"));
  objs.push(Buffer.from("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>"));
  pages.forEach((p, i) => {
    objs.push(Buffer.from(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${6 + 2 * i} 0 R >>`));
    const data = deflateSync(Buffer.from(p.join("\n"), "latin1"));
    objs.push(Buffer.concat([Buffer.from(`<< /Length ${data.length} /Filter /FlateDecode >>\nstream\n`), data, Buffer.from("\nendstream")]));
  });
  const chunks: Buffer[] = [Buffer.from("%PDF-1.4\n%âãÏÓ\n", "latin1")];
  const offsets: number[] = [];
  let pos = chunks[0].length;
  objs.forEach((o, i) => {
    offsets.push(pos);
    const piece = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`), o, Buffer.from("\nendobj\n")]);
    chunks.push(piece);
    pos += piece.length;
  });
  const xref = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
  chunks.push(Buffer.from(xref + `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${pos}\n%%EOF`));
  return Buffer.concat(chunks);
}

// ---------------- tools ----------------
export const FILE_TOOLS: Def[] = [
  {
    name: "file.create", risk: "read", params: "name:string (with extension: report.md, data.csv, page.html, notes.txt, config.json, logo.svg, calendar.ics ...), content:string (the whole file)",
    description: "Make a text-based file yourself (txt, md, csv, json, html, css, js, py, sql, xml, yaml, svg, ics, vcf ...) and give the owner a private download link. Use it whenever the owner wants a file, a document, a spreadsheet as CSV, a web page, a config or a script. No computer needed.",
    run: async (a, _c, ctx) => {
      const c = need(ctx);
      const name = cleanName(s(a.name, 90), "txt");
      const ext = (/\.([A-Za-z0-9]{1,8})$/.exec(name)?.[1] ?? "").toLowerCase();
      if (!TEXT_MIME[ext]) throw new Error(`file.create makes text files only (${Object.keys(TEXT_MIME).join(", ")}). For PDF use file.pdf, for Word file.docx, for Excel file.xlsx, for PowerPoint file.pptx, for several files file.zip, for images use the computer.`);
      const content = String(a.content ?? "");
      if (!content.trim()) throw new Error("content is empty.");
      if (content.length > 2_000_000) throw new Error("The file is too big for this tool (2 MB). Use the computer for it.");
      return saveFile(c, name, TEXT_MIME[ext], Buffer.from(content, "utf8"));
    },
  },
  {
    name: "file.pdf", risk: "read", params: "name:string (e.g. invoice.pdf), title?:string, content:string (simple markdown: # heading, ## subheading, - bullet, 1. step, blank line = new paragraph)",
    description: "Make a real PDF document yourself (report, letter, invoice text, notes, checklist, guide) and give the owner a private download link. Latin letters only (English and European languages): for Hindi or other scripts make an .html with file.create or use the computer.",
    run: async (a, _c, ctx) => {
      const c = need(ctx);
      const content = String(a.content ?? "").trim();
      if (!content) throw new Error("content is empty.");
      if (content.length > 200_000) throw new Error("The text is too long for one PDF here (200,000 characters).");
      const bytes = pdfOf(s(a.title, 200), content);
      return saveFile(c, cleanName(s(a.name, 90), "pdf").replace(/\.[A-Za-z0-9]{1,8}$/, ".pdf"), "application/pdf", bytes);
    },
  },
  {
    name: "file.zip", risk: "read", params: "name?:string (e.g. bundle.zip), files?:[{name:string, content:string}] (files to create inside the zip, folders allowed: \"src/app.js\"), attachments?:string[] (files attached to this chat: id or exact name)",
    description: "Make a ZIP archive yourself from files you write and/or files the owner attached to this chat, and give the owner a private download link.",
    run: async (a, _c, ctx) => {
      const c = need(ctx);
      const entries: Array<{ name: string; data: Buffer }> = [];
      let total = 0;
      const add = (name: string, data: Buffer) => {
        total += data.length;
        if (total > 60 * 1024 * 1024) throw new Error("The zip would be bigger than 60 MB. Use the computer for it.");
        entries.push({ name: entryName(name), data });
      };
      for (const f of Array.isArray(a.files) ? (a.files as Array<Record<string, unknown>>).slice(0, 200) : []) {
        if (f && typeof f.name === "string") add(f.name, Buffer.from(String(f.content ?? ""), "utf8"));
      }
      for (const ref of Array.isArray(a.attachments) ? (a.attachments as unknown[]).slice(0, 50) : []) {
        const doc = await findAttachment(c.uid, c.chatId, String(ref));
        if (!doc) throw new Error(`Attachment "${String(ref)}" was not found in this chat.`);
        const r = await fetch(await attachmentUrl(doc), { signal: AbortSignal.timeout(60_000) });
        if (!r.ok) throw new Error(`Could not read "${doc.name}" (HTTP ${r.status}).`);
        add(doc.name, Buffer.from(await r.arrayBuffer()));
      }
      if (!entries.length) throw new Error("Nothing to zip: give files and/or attachments.");
      return saveFile(c, cleanName(s(a.name, 90), "zip").replace(/\.[A-Za-z0-9]{1,8}$/, ".zip"), "application/zip", zipOf(entries));
    },
  },
  {
    name: "file.docx", risk: "read", params: "name:string (e.g. proposal.docx), title?:string, content:string (simple markdown: # ## ### headings, - bullets, 1. steps, | tables |, **bold**, *italic*, > quote, --- page break)",
    description: "Make a real Word document (.docx) yourself: letters, proposals, quotations, reports, contracts drafts, resumes. Hindi and every other script work. The owner can edit it in Word / Google Docs. Gives a private download link.",
    run: async (a, _c, ctx) => {
      const c = need(ctx);
      const content = String(a.content ?? "").trim();
      if (!content) throw new Error("content is empty.");
      if (content.length > 400_000) throw new Error("The text is too long for one Word file here (400,000 characters).");
      return saveFile(c, cleanName(s(a.name, 90), "docx").replace(/\.[A-Za-z0-9]{1,8}$/, ".docx"), OFFICE_MIME.docx, zipOf(docxEntries(s(a.title, 200), content)));
    },
  },
  {
    name: "file.xlsx", risk: "read", params: "name:string (e.g. leads.xlsx), rows?:[[...]] | [{...}] (first row = header; a cell starting with = is a formula, e.g. \"=B2*C2\"), csv?:string, sheets?:[{name:string, rows?:[...], csv?:string}], header?:boolean (default true)",
    description: "Make a real Excel workbook (.xlsx) yourself: styled header row, frozen header, filters, auto column widths, several sheets, working formulas (=SUM(D2:D20)), numbers stored as numbers, phone / PIN / ID columns kept as text. Use it for lead lists, price lists, reports, trackers. Gives a private download link.",
    run: async (a, _c, ctx) => {
      const c = need(ctx);
      const toRows = (v: unknown, csv: unknown): unknown[][] => {
        if (typeof csv === "string" && csv.trim()) return parseCsv(csv);
        let arr: unknown = v;
        if (typeof arr === "string") { try { arr = JSON.parse(arr); } catch { return parseCsv(arr as string); } }
        if (!Array.isArray(arr) || !arr.length) return [];
        if (arr.every((r) => Array.isArray(r))) return arr as unknown[][];
        const objs = arr.filter((r) => r && typeof r === "object" && !Array.isArray(r)) as Array<Record<string, unknown>>;
        if (objs.length) { const keys: string[] = []; for (const o of objs) for (const k of Object.keys(o)) if (!keys.includes(k)) keys.push(k); return [keys, ...objs.map((o) => keys.map((k) => { const x = o[k]; return x !== null && typeof x === "object" ? JSON.stringify(x) : x; }))]; }
        return arr.map((x) => [x]);
      };
      const sheets: Sheet[] = [];
      if (Array.isArray(a.sheets)) for (const sh of (a.sheets as Array<Record<string, unknown>>).slice(0, 30)) { const rows = toRows(sh?.rows, sh?.csv); if (rows.length) sheets.push({ name: s(sh?.name, 31) || `Sheet${sheets.length + 1}`, rows }); }
      if (!sheets.length) { const rows = toRows(a.rows, a.csv); if (rows.length) sheets.push({ name: s(a.sheet, 31) || "Sheet1", rows }); }
      if (!sheets.length) throw new Error("Give rows (list of lists or list of objects), csv text, or sheets.");
      if (sheets.reduce((n, sh) => n + sh.rows.length, 0) > 200_000) throw new Error("Too many rows for this tool (200,000). Use the computer with pandas.");
      const header = !(a.header === false || String(a.header).toLowerCase() === "false");
      return saveFile(c, cleanName(s(a.name, 90), "xlsx").replace(/\.[A-Za-z0-9]{1,8}$/, ".xlsx"), OFFICE_MIME.xlsx, zipOf(xlsxEntries(sheets, { header })));
    },
  },
  {
    name: "file.pptx", risk: "read", params: "name:string (e.g. pitch.pptx), slides?:[{title:string, bullets?:[string], text?:string, notes?:string}] (the first slide with only a title becomes the cover), content?:string (markdown: each # or ## heading = one slide, lines under it = bullets), accent?:string (hex colour like 3F51B5)",
    description: "Make a real PowerPoint (.pptx) yourself: clean 16:9 slides with title, bullets, text, speaker notes and a colour theme. Hindi and every other script work. For a deck with photos or charts use the computer or Venus Pro. Gives a private download link.",
    run: async (a, _c, ctx) => {
      const c = need(ctx);
      let slides: Slide[] = [];
      if (Array.isArray(a.slides)) slides = (a.slides as Array<Record<string, unknown>>).slice(0, 80).map((x) => ({ title: s(x?.title, 200), bullets: Array.isArray(x?.bullets) ? (x.bullets as unknown[]).map((b) => s(b, 400)).filter(Boolean) : undefined, text: x?.text ? s(x.text, 1500) : undefined, notes: x?.notes ? s(x.notes, 3000) : undefined }));
      else if (typeof a.content === "string" && a.content.trim()) {
        let cur: Slide | null = null;
        for (const line of a.content.replace(/\r/g, "").split("\n")) {
          const m = /^#{1,2}\s+(.*)$/.exec(line.trim());
          if (m) { cur = { title: m[1].trim(), bullets: [] }; slides.push(cur); continue; }
          const t = line.trim().replace(/^[-*•]\s+/, "");
          if (t && cur) cur.bullets!.push(t.slice(0, 400));
        }
        slides = slides.map((x) => (x.bullets && x.bullets.length ? x : { title: x.title })).slice(0, 80);
      }
      if (!slides.length) throw new Error("Give slides ([{title, bullets}]) or markdown content with # headings.");
      return saveFile(c, cleanName(s(a.name, 90), "pptx").replace(/\.[A-Za-z0-9]{1,8}$/, ".pptx"), OFFICE_MIME.pptx, zipOf(pptxEntries(slides, { accent: s(a.accent, 7).replace("#", "") })));
    },
  },
  {
    name: "file.csv", risk: "read", params: "name:string (e.g. leads.csv), rows:[[...]] | [{...}] (first row = header), delimiter?:string",
    description: "Make a CSV file from rows (list of lists or list of objects) with correct quoting, and give the owner a private download link. For a styled spreadsheet use file.xlsx.",
    run: async (a, _c, ctx) => {
      const c = need(ctx);
      let arr: unknown = a.rows;
      if (typeof arr === "string") { try { arr = JSON.parse(arr); } catch { arr = parseCsv(arr as string); } }
      if (!Array.isArray(arr) || !arr.length) throw new Error("rows is empty.");
      let rows: unknown[][];
      if (arr.every((r) => Array.isArray(r))) rows = arr as unknown[][];
      else { const objs = arr.filter((r) => r && typeof r === "object") as Array<Record<string, unknown>>; const keys: string[] = []; for (const o of objs) for (const k of Object.keys(o)) if (!keys.includes(k)) keys.push(k); rows = [keys, ...objs.map((o) => keys.map((k) => o[k]))]; }
      const text = "\uFEFF" + toCsv(rows, s(a.delimiter, 1) || ",");
      return saveFile(c, cleanName(s(a.name, 90), "csv").replace(/\.[A-Za-z0-9]{1,8}$/, ".csv"), "text/csv", Buffer.from(text, "utf8"));
    },
  },
];
