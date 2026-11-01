// Server-only. The agent makes real files itself (text files, PDF, ZIP) and hands the owner a private download link.
// No computer, no extra library: the PDF and ZIP writers are small and live here.
import { deflateRawSync, deflateSync } from "zlib";
import { attachmentUrl, findAttachment, markReady, signAttachment } from "@/lib/attachments-server";
import { humanSize } from "@/lib/attachments";
import type { Def } from "./plugins";
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
  return `📎 ${doc.name} (${humanSize(bytes.length)}): ${await attachmentUrl(doc)}\nGive the owner this link. It works for 1 hour; the file stays in this chat (attachments.link makes a new link).`;
}

// ---------------- ZIP ----------------
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
const crc32 = (b: Buffer): number => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };

function zipOf(entries: Array<{ name: string; data: Buffer }>): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  const d = new Date();
  const dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const dosDate = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  for (const e of entries) {
    const name = Buffer.from(e.name, "utf8");
    const crc = crc32(e.data);
    const packed = deflateRawSync(e.data);
    const deflated = packed.length < e.data.length;
    const body = deflated ? packed : e.data;
    const method = deflated ? 8 : 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(method, 8);
    local.writeUInt16LE(dosTime, 10); local.writeUInt16LE(dosDate, 12); local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18); local.writeUInt32LE(e.data.length, 22); local.writeUInt16LE(name.length, 26); local.writeUInt16LE(0, 28);
    parts.push(local, name, body);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(method, 10);
    c.writeUInt16LE(dosTime, 12); c.writeUInt16LE(dosDate, 14); c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(body.length, 20); c.writeUInt32LE(e.data.length, 24); c.writeUInt16LE(name.length, 28);
    c.writeUInt32LE(offset, 42);
    central.push(c, name);
    offset += 30 + name.length + body.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cd, end]);
}

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
      if (!TEXT_MIME[ext]) throw new Error(`file.create makes text files only (${Object.keys(TEXT_MIME).join(", ")}). For PDF use file.pdf, for several files file.zip, for Word/Excel/PowerPoint or images use the computer.`);
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
];
