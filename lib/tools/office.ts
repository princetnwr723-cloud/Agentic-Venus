// Server-only helpers, no library: writes real Word (.docx), Excel (.xlsx) and PowerPoint (.pptx) files and ZIP archives.
// Unicode safe (Hindi, Arabic, emoji work, unlike the built-in PDF font). Used by file.docx / file.xlsx / file.pptx.
import { deflateRawSync } from "zlib";

export type Entry = { name: string; data: Buffer };

// ---------------- ZIP ----------------
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
const crc32 = (b: Buffer): number => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };

export function zipOf(entries: Entry[]): Buffer {
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

// ---------------- XML helpers ----------------
const clean = (t: string) => t.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, "");
export const xesc = (t: unknown) => clean(String(t ?? "")).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const file = (name: string, xml: string): Entry => ({ name, data: Buffer.from(XML + xml, "utf8") });
const REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships";
const OD = "http://schemas.openxmlformats.org/officeDocument/2006";
const rels = (items: Array<[id: string, type: string, target: string]>) => `<Relationships xmlns="${REL_NS}">${items.map(([i, t, g]) => `<Relationship Id="${i}" Type="${OD}/relationships/${t}" Target="${g}"/>`).join("")}</Relationships>`;

// ---------------- XLSX ----------------
export type Sheet = { name: string; rows: unknown[][] };
const colName = (i: number) => { let s = ""; for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };
const TEXT_COL = /phone|mobile|whatsapp|contact|pin|zip|postal|aadhaar|aadhar|pan|gst|ifsc|account|acc_?no|id$|^id|code|sku|isbn|barcode|number$|no$/i;
const sheetName = (n: string, used: Set<string>) => { let b = clean(n).replace(/[\[\]:*?/\\]/g, " ").replace(/\s+/g, " ").trim().slice(0, 31) || "Sheet"; let x = b, i = 2; while (used.has(x.toLowerCase())) x = b.slice(0, 28) + " " + i++; used.add(x.toLowerCase()); return x; };

export function xlsxEntries(sheetsIn: Sheet[], opts: { header?: boolean } = {}): Entry[] {
  const header = opts.header !== false;
  const sheets = sheetsIn.length ? sheetsIn : [{ name: "Sheet1", rows: [[""]] }];
  const used = new Set<string>();
  const names = sheets.map((s) => sheetName(s.name, used));
  const sheetXml = sheets.map((sh) => {
    const rows = sh.rows.slice(0, 100000).map((r) => (Array.isArray(r) ? r : [r]).slice(0, 16000));
    const ncol = Math.max(1, ...rows.map((r) => r.length));
    const textCol = new Set<number>();
    if (header && rows[0]) rows[0].forEach((h, i) => { if (TEXT_COL.test(String(h ?? ""))) textCol.add(i); });
    const widths = Array.from({ length: ncol }, (_, i) => Math.min(60, Math.max(8, ...rows.slice(0, 300).map((r) => { const v = r[i]; const t = String(v ?? ""); return v !== null && typeof v === "string" && t.startsWith("=") ? 12 : t.split("\n")[0].length + 2; }))));
    const body = rows.map((r, ri) => {
      const cells = r.map((v, ci) => {
        if (v === null || v === undefined || v === "") return "";
        const ref = colName(ci) + (ri + 1);
        const hdr = header && ri === 0;
        const st = hdr ? ' s="1"' : "";
        if (typeof v === "number" && Number.isFinite(v)) return `<c r="${ref}"${st}><v>${v}</v></c>`;
        if (typeof v === "boolean") return `<c r="${ref}"${st} t="b"><v>${v ? 1 : 0}</v></c>`;
        const t = String(v);
        if (!hdr && t.startsWith("=") && t.length > 1) return `<c r="${ref}"><f>${xesc(t.slice(1))}</f></c>`;
        if (!hdr && !textCol.has(ci) && /^-?(0|[1-9]\d{0,8})(\.\d{1,8})?$/.test(t)) return `<c r="${ref}"><v>${t}</v></c>`;
        return `<c r="${ref}"${hdr ? ' s="1"' : /\n/.test(t) ? ' s="2"' : ""} t="inlineStr"><is><t xml:space="preserve">${xesc(t)}</t></is></c>`;
      }).join("");
      return `<row r="${ri + 1}">${cells}</row>`;
    }).join("");
    const last = colName(ncol - 1) + Math.max(1, rows.length);
    const pane = header && rows.length > 1 ? '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' : '<sheetViews><sheetView workbookViewId="0"/></sheetViews>';
    const filter = header && rows.length > 1 ? `<autoFilter ref="A1:${last}"/>` : "";
    return `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${pane}<sheetFormatPr defaultRowHeight="15"/><cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("")}</cols><sheetData>${body}</sheetData>${filter}</worksheet>`;
  });
  const styles = `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF3F51B5"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
  return [
    file("[Content_Types].xml", `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>`),
    file("_rels/.rels", rels([["rId1", "officeDocument", "xl/workbook.xml"]])),
    file("xl/workbook.xml", `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${OD}/relationships"><sheets>${names.map((n, i) => `<sheet name="${xesc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>`),
    file("xl/_rels/workbook.xml.rels", rels([...sheets.map((_, i): [string, string, string] => [`rId${i + 1}`, "worksheet", `worksheets/sheet${i + 1}.xml`]), [`rId${sheets.length + 1}`, "styles", "styles.xml"]])),
    file("xl/styles.xml", styles),
    ...sheetXml.map((x, i) => file(`xl/worksheets/sheet${i + 1}.xml`, x)),
  ];
}

// ---------------- DOCX ----------------
// Simple markdown: # / ## / ### headings, - or * bullets, 1. numbered, | tables |, **bold**, *italic*, `code`, --- page break, > quote, blank line = paragraph.
const runs = (t: string, base = "") => {
  const out: string[] = []; const re = /(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g; let last = 0; let m: RegExpExecArray | null;
  const run = (txt: string, rpr: string) => out.push(`<w:r><w:rPr>${base}${rpr}</w:rPr><w:t xml:space="preserve">${xesc(txt)}</w:t></w:r>`);
  while ((m = re.exec(t))) { if (m.index > last) run(t.slice(last, m.index), ""); const x = m[0]; if (x.startsWith("**")) run(x.slice(2, -2), "<w:b/>"); else if (x.startsWith("`")) run(x.slice(1, -1), '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:shd w:val="clear" w:color="auto" w:fill="F0F0F0"/>'); else if (x.startsWith("[")) { const mm = /\[([^\]]+)\]\(([^)]+)\)/.exec(x)!; run(`${mm[1]} (${mm[2]})`, '<w:color w:val="1F4E9E"/><w:u w:val="single"/>'); } else run(x.slice(1, -1), "<w:i/>"); last = m.index + x.length; }
  if (last < t.length) run(t.slice(last), "");
  return out.join("") || `<w:r><w:t></w:t></w:r>`;
};
const para = (inner: string, ppr = "") => `<w:p>${ppr ? `<w:pPr>${ppr}</w:pPr>` : ""}${inner}</w:p>`;

export function docxEntries(title: string, content: string): Entry[] {
  const lines = content.replace(/\r/g, "").split("\n");
  const body: string[] = [];
  if (title) body.push(para(runs(title), '<w:pStyle w:val="Title"/>'));
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]; const tr = l.trim();
    if (!tr) continue;
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(tr)) { body.push('<w:p><w:r><w:br w:type="page"/></w:r></w:p>'); continue; }
    let m = /^(#{1,3})\s+(.*)$/.exec(tr);
    if (m) { body.push(para(runs(m[2]), `<w:pStyle w:val="Heading${m[1].length}"/>`)); continue; }
    if (tr.startsWith("|")) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) { const r = lines[i].trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim()); if (!r.every((c) => /^:?-{2,}:?$/.test(c))) rows.push(r); i++; }
      i--;
      const w = Math.max(...rows.map((r) => r.length));
      const bd = ["top", "left", "bottom", "right", "insideH", "insideV"].map((k) => `<w:${k} w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/>`).join("");
      body.push(`<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:tblBorders>${bd}</w:tblBorders><w:tblCellMar><w:left w:w="80" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${Array.from({ length: w }, () => `<w:gridCol w:w="${Math.floor(9000 / w)}"/>`).join("")}</w:tblGrid>${rows.map((r, ri) => `<w:tr>${ri === 0 ? "<w:trPr><w:tblHeader/></w:trPr>" : ""}${Array.from({ length: w }, (_, ci) => `<w:tc><w:tcPr><w:tcW w:w="${Math.floor(9000 / w)}" w:type="dxa"/>${ri === 0 ? '<w:shd w:val="clear" w:color="auto" w:fill="E8EAF6"/>' : ""}</w:tcPr>${para(runs(r[ci] ?? "", ri === 0 ? "<w:b/>" : ""))}</w:tc>`).join("")}</w:tr>`).join("")}</w:tbl>`, para(""));
      continue;
    }
    m = /^[-*•]\s+(.*)$/.exec(tr);
    if (m) { body.push(para(runs(m[1]), '<w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>')); continue; }
    m = /^(\d+)[.)]\s+(.*)$/.exec(tr);
    if (m) { body.push(para(runs(m[2]), '<w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="2"/></w:numPr>')); continue; }
    m = /^>\s?(.*)$/.exec(tr);
    if (m) { body.push(para(runs(m[1], "<w:i/>"), '<w:ind w:left="567"/><w:pBdr><w:left w:val="single" w:sz="18" w:space="8" w:color="9FA8DA"/></w:pBdr>')); continue; }
    body.push(para(runs(tr), '<w:spacing w:after="120"/>'));
  }
  if (!body.length) body.push(para(""));
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  const sty = (id: string, name: string, size: number, bold: boolean, color: string, before: number, after: number, extra = "") => `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="${before}" w:after="${after}"/>${extra}</w:pPr><w:rPr>${bold ? "<w:b/>" : ""}<w:color w:val="${color}"/><w:sz w:val="${size}"/></w:rPr></w:style>`;
  const styles = `<w:styles ${W}><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri" w:cs="Mangal"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="en-US" w:bidi="hi-IN"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>${sty("Title", "Title", 52, true, "1A237E", 0, 240)}${sty("Heading1", "heading 1", 36, true, "1A237E", 360, 120)}${sty("Heading2", "heading 2", 30, true, "283593", 280, 100)}${sty("Heading3", "heading 3", 26, true, "3949AB", 200, 80)}<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="60"/><w:ind w:left="720"/></w:pPr></w:style></w:styles>`;
  const abs = (id: number, fmt: string, text: string, font = "") => `<w:abstractNum w:abstractNumId="${id}"><w:multiLevelType w:val="hybridMultilevel"/><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="${fmt}"/><w:lvlText w:val="${text}"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr>${font ? `<w:rPr><w:rFonts w:ascii="${font}" w:hAnsi="${font}" w:hint="default"/></w:rPr>` : ""}</w:lvl></w:abstractNum>`;
  const numbering = `<w:numbering ${W}>${abs(1, "bullet", "•")}${abs(2, "decimal", "%1.")}<w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="2"/></w:num></w:numbering>`;
  return [
    file("[Content_Types].xml", `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/></Types>`),
    file("_rels/.rels", rels([["rId1", "officeDocument", "word/document.xml"]])),
    file("word/_rels/document.xml.rels", rels([["rId1", "styles", "styles.xml"], ["rId2", "numbering", "numbering.xml"]])),
    file("word/document.xml", `<w:document ${W}><w:body>${body.join("")}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`),
    file("word/styles.xml", styles),
    file("word/numbering.xml", numbering),
  ];
}

// ---------------- PPTX ----------------
export type Slide = { title?: string; bullets?: string[]; text?: string; notes?: string };
export function pptxEntries(slidesIn: Slide[], opts: { accent?: string } = {}): Entry[] {
  const slides = slidesIn.length ? slidesIn.slice(0, 80) : [{ title: "Untitled" }];
  const accent = /^[0-9a-f]{6}$/i.test(opts.accent ?? "") ? opts.accent!.toUpperCase() : "3F51B5";
  const NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
  const EMU = 12700; const W = 960 * EMU, H = 540 * EMU; // 16:9, 960 x 540 pt
  const para = (t: string, sz: number, o: { bold?: boolean; color?: string; bullet?: boolean } = {}) => `<a:p><a:pPr${o.bullet ? ' marL="342900" indent="-342900"' : ' marL="0" indent="0"'}>${o.bullet ? '<a:buFont typeface="Arial"/><a:buChar char="•"/>' : "<a:buNone/>"}</a:pPr><a:r><a:rPr lang="en-US" sz="${sz}" b="${o.bold ? 1 : 0}" dirty="0"><a:solidFill><a:srgbClr val="${o.color ?? "263238"}"/></a:solidFill></a:rPr><a:t>${xesc(t)}</a:t></a:r></a:p>`;
  const box = (id: number, name: string, x: number, y: number, w: number, h: number, paras: string, anchor = "t") => `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${x * EMU}" y="${y * EMU}"/><a:ext cx="${w * EMU}" cy="${h * EMU}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr><p:txBody><a:bodyPr wrap="square" lIns="0" rIns="0" anchor="${anchor}"><a:normAutofit/></a:bodyPr><a:lstStyle/>${paras || "<a:p><a:endParaRPr lang=\"en-US\"/></a:p>"}</p:txBody></p:sp>`;
  const rect = (id: number, x: number, y: number, w: number, h: number, color: string) => `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Shape ${id}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${x * EMU}" y="${y * EMU}"/><a:ext cx="${w * EMU}" cy="${h * EMU}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="${color}"/></a:solidFill><a:ln><a:noFill/></a:ln></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="en-US"/></a:p></p:txBody></p:sp>`;
  const slideXml = slides.map((s, i) => {
    const first = i === 0 && !(s.bullets?.length) && !s.text;
    const shapes: string[] = [];
    if (first) {
      shapes.push(rect(2, 0, 0, 960, 540, accent), box(3, "Title", 80, 170, 800, 120, para(s.title ?? "", 5000, { bold: true, color: "FFFFFF" }), "b"));
    } else {
      shapes.push(rect(2, 0, 0, 960, 12, accent), box(3, "Title", 60, 36, 840, 70, para(s.title ?? "", 3400, { bold: true, color: accent }), "ctr"));
      const items = (s.bullets ?? []).map(String).filter(Boolean).slice(0, 10);
      const sz = items.length > 7 ? 1800 : items.length > 5 ? 2000 : 2400;
      const paras = [...(s.text ? s.text.split(/\n+/).map((t) => para(t, 2200)) : []), ...items.map((b) => para(b, sz, { bullet: true }))].join("");
      shapes.push(box(4, "Content", 60, 125, 840, 370, paras));
      shapes.push(box(5, "Number", 860, 500, 60, 24, para(String(i + 1), 1200, { color: "90A4AE" })));
    }
    return `<p:sld ${NS}><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>${shapes.join("")}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
  });
  const notesXml = (txt: string) => `<p:notes ${NS}><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/><p:sp><p:nvSpPr><p:cNvPr id="2" name="Notes"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US"/><a:t>${xesc(txt)}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:notes>`;
  const theme = `<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Venus"><a:themeElements><a:clrScheme name="Venus"><a:dk1><a:srgbClr val="263238"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="1A237E"/></a:dk2><a:lt2><a:srgbClr val="ECEFF1"/></a:lt2><a:accent1><a:srgbClr val="${accent}"/></a:accent1><a:accent2><a:srgbClr val="FF7043"/></a:accent2><a:accent3><a:srgbClr val="26A69A"/></a:accent3><a:accent4><a:srgbClr val="FFCA28"/></a:accent4><a:accent5><a:srgbClr val="AB47BC"/></a:accent5><a:accent6><a:srgbClr val="66BB6A"/></a:accent6><a:hlink><a:srgbClr val="1565C0"/></a:hlink><a:folHlink><a:srgbClr val="6A1B9A"/></a:folHlink></a:clrScheme><a:fontScheme name="Venus"><a:majorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="Venus"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="9525"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="28575"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`;
  const master = `<p:sldMaster ${NS}><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:effectLst/></p:bgPr></p:bg><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>`;
  const layout = `<p:sldLayout ${NS} type="blank" preserve="1"><p:cSld name="Blank"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`;
  const hasNotes = slides.map((s) => !!s.notes?.trim());
  const notesMaster = `<p:notesMaster ${NS}><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/></p:notesMaster>`;
  const anyNotes = hasNotes.some(Boolean);
  const pres = `<p:presentation ${NS}><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>${anyNotes ? '<p:notesMasterIdLst><p:notesMasterId r:id="rId' + (slides.length + 3) + '"/></p:notesMasterIdLst>' : ""}<p:sldIdLst>${slides.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 2}"/>`).join("")}</p:sldIdLst><p:sldSz cx="${W}" cy="${H}"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`;
  const out: Entry[] = [
    file("[Content_Types].xml", `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>${anyNotes ? '<Override PartName="/ppt/notesMasters/notesMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesMaster+xml"/><Override PartName="/ppt/theme/theme2.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>' : ""}${slides.map((_, i) => `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>${hasNotes[i] ? `<Override PartName="/ppt/notesSlides/notesSlide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml"/>` : ""}`).join("")}</Types>`),
    file("_rels/.rels", rels([["rId1", "officeDocument", "ppt/presentation.xml"]])),
    file("ppt/presentation.xml", pres),
    file("ppt/_rels/presentation.xml.rels", rels([["rId1", "slideMaster", "slideMasters/slideMaster1.xml"], ...slides.map((_, i): [string, string, string] => [`rId${i + 2}`, "slide", `slides/slide${i + 1}.xml`]), [`rId${slides.length + 2}`, "theme", "theme/theme1.xml"], ...(anyNotes ? [[`rId${slides.length + 3}`, "notesMaster", "notesMasters/notesMaster1.xml"] as [string, string, string]] : [])])),
    file("ppt/slideMasters/slideMaster1.xml", master),
    file("ppt/slideMasters/_rels/slideMaster1.xml.rels", rels([["rId1", "slideLayout", "../slideLayouts/slideLayout1.xml"], ["rId2", "theme", "../theme/theme1.xml"]])),
    file("ppt/slideLayouts/slideLayout1.xml", layout),
    file("ppt/slideLayouts/_rels/slideLayout1.xml.rels", rels([["rId1", "slideMaster", "../slideMasters/slideMaster1.xml"]])),
    file("ppt/theme/theme1.xml", theme),
  ];
  if (anyNotes) out.push(file("ppt/notesMasters/notesMaster1.xml", notesMaster), file("ppt/notesMasters/_rels/notesMaster1.xml.rels", rels([["rId1", "theme", "../theme/theme2.xml"]])), file("ppt/theme/theme2.xml", theme));
  slideXml.forEach((x, i) => {
    out.push(file(`ppt/slides/slide${i + 1}.xml`, x));
    out.push(file(`ppt/slides/_rels/slide${i + 1}.xml.rels`, rels([["rId1", "slideLayout", "../slideLayouts/slideLayout1.xml"], ...(hasNotes[i] ? [["rId2", "notesSlide", `../notesSlides/notesSlide${i + 1}.xml`] as [string, string, string]] : [])])));
    if (hasNotes[i]) { out.push(file(`ppt/notesSlides/notesSlide${i + 1}.xml`, notesXml(slides[i].notes!))); out.push(file(`ppt/notesSlides/_rels/notesSlide${i + 1}.xml.rels`, rels([["rId1", "notesMaster", "../notesMasters/notesMaster1.xml"], ["rId2", "slide", `../slides/slide${i + 1}.xml`]]))); }
  });
  return out;
}

export const OFFICE_MIME = {
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
} as const;
