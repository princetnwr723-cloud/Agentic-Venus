// Server-only. A tiny ZIP reader (no packages): lists entries and reads one. Also pulls the text out of docx / xlsx / pptx
// (they are zip files with XML inside). Bomb-safe: entries and output sizes are capped.
import { inflateRawSync } from "zlib";

export type ZipEntry = { name: string; size: number; packed: number; method: number; offset: number; dir: boolean };
const MAX_ENTRIES = 5000;
const MAX_OUT = 8 * 1024 * 1024;

export function zipEntries(buf: Buffer): ZipEntry[] {
  const min = Math.max(0, buf.length - 65_557);
  let eocd = -1;
  for (let i = buf.length - 22; i >= min; i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error("This is not a zip archive (or it is damaged).");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  if (count === 0xffff || p === 0xffffffff) throw new Error("Zip64 archives are too big to open here: ask the computer to unzip it (attachments.link gives a download link).");
  const out: ZipEntry[] = [];
  for (let n = 0; n < Math.min(count, MAX_ENTRIES); n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10), packed = buf.readUInt32LE(p + 20), size = buf.readUInt32LE(p + 24);
    const nl = buf.readUInt16LE(p + 28), el = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32);
    const offset = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nl);
    out.push({ name, size, packed, method, offset, dir: name.endsWith("/") });
    p += 46 + nl + el + cl;
  }
  return out;
}

export function zipRead(buf: Buffer, e: ZipEntry, cap = MAX_OUT): Buffer {
  if (e.dir) return Buffer.alloc(0);
  if (e.name.includes("..") || e.name.startsWith("/")) throw new Error("Unsafe file name in the zip.");
  if (e.offset + 30 > buf.length || buf.readUInt32LE(e.offset) !== 0x04034b50) throw new Error("Damaged zip entry.");
  const nl = buf.readUInt16LE(e.offset + 26), el = buf.readUInt16LE(e.offset + 28);
  const start = e.offset + 30 + nl + el;
  const raw = buf.subarray(start, start + e.packed);
  if (e.method === 0) return raw.subarray(0, cap);
  if (e.method === 8) return inflateRawSync(raw, { maxOutputLength: cap });
  throw new Error(`Unsupported zip compression (${e.method}).`);
}

const dec = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
const text = (xml: string) => dec(xml.replace(/<\/(w:p|a:p|row|si)>/g, "\n").replace(/<\/(w:tc|c)>/g, "\t").replace(/<[^>]+>/g, "")).replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();

/** Plain text of a docx / xlsx / pptx file, or null when the file is not one of those. */
export function officeText(buf: Buffer, ext: string): string | null {
  let es: ZipEntry[];
  try { es = zipEntries(buf); } catch { return null; }
  const get = (re: RegExp) => es.filter((e) => re.test(e.name)).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  const read = (e: ZipEntry) => zipRead(buf, e).toString("utf8");
  if (ext === "docx") return text(get(/^word\/document\.xml$/).map(read).join("\n"));
  if (ext === "pptx") return get(/^ppt\/slides\/slide\d+\.xml$/).map((e, i) => `--- slide ${i + 1} ---\n${text(read(e))}`).join("\n\n");
  if (ext === "xlsx") {
    const shared = get(/^xl\/sharedStrings\.xml$/).map(read).join("");
    const strings = Array.from(shared.matchAll(/<si>([\s\S]*?)<\/si>/g)).map((m) => dec(m[1].replace(/<[^>]+>/g, "")));
    return get(/^xl\/worksheets\/sheet\d+\.xml$/).map((e, i) => {
      const rows = Array.from(read(e).matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)).map((r) =>
        Array.from(r[1].matchAll(/<c([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)).map((c) => {
          const v = /<v>([\s\S]*?)<\/v>/.exec(c[2] ?? "")?.[1] ?? "";
          return /t="s"/.test(c[1]) ? strings[Number(v)] ?? "" : dec(v);
        }).join("\t"));
      return `--- sheet ${i + 1} ---\n${rows.join("\n")}`;
    }).join("\n\n");
  }
  return null;
}
