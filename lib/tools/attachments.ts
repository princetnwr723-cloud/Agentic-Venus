// Shared by the browser and the server (no server-only imports).
// An attachment is ANY file the owner puts in the chat: photo, video, audio, zip, PDF, Office file, code, text ...
// The file itself goes straight from the browser to private storage (Supabase) with a one-time upload link, so the
// Vercel request-size limit never applies. The chat only carries a short note with the file's id.

export type AttachKind = "image" | "video" | "audio" | "zip" | "pdf" | "doc" | "sheet" | "slides" | "text" | "other";

/** What one attached file looks like in the browser. `text` is filled only for small text files (sent inline). */
export type Attachment = {
  id: string; name: string; size: number; mime: string; kind: AttachKind;
  text?: string;                        // small text file: its content travels inside the message
  vision?: { mediaType: string; data: string }; // photo: a small copy the model can look at on this turn
  preview?: string;                     // photo: a local blob: address the browser shows as the card picture (browser only)
  status: "uploading" | "ready" | "error"; progress: number; error?: string;
};

export const MAX_ATTACH_BYTES = 500 * 1024 * 1024; // the storage plan can be lower: its own error is shown
export const MAX_ATTACH_FILES = 8;
export const MAX_INLINE_TEXT = 200_000;

const EXT: Record<string, AttachKind> = {
  png: "image", jpg: "image", jpeg: "image", gif: "image", webp: "image", bmp: "image", svg: "image", heic: "image", heif: "image", avif: "image", tif: "image", tiff: "image",
  mp4: "video", mov: "video", webm: "video", mkv: "video", avi: "video", m4v: "video", mpeg: "video", mpg: "video", "3gp": "video",
  mp3: "audio", wav: "audio", m4a: "audio", aac: "audio", ogg: "audio", opus: "audio", flac: "audio",
  zip: "zip", jar: "zip", apk: "zip", tar: "zip", gz: "zip", tgz: "zip", "7z": "zip", rar: "zip",
  pdf: "pdf", doc: "doc", docx: "doc", odt: "doc", rtf: "doc",
  xls: "sheet", xlsx: "sheet", ods: "sheet", csv: "text", tsv: "text",
  ppt: "slides", pptx: "slides", odp: "slides",
  txt: "text", md: "text", json: "text", js: "text", ts: "text", tsx: "text", jsx: "text", py: "text", html: "text", css: "text", log: "text", xml: "text", yml: "text", yaml: "text",
  sql: "text", sh: "text", java: "text", c: "text", cpp: "text", go: "text", rs: "text", rb: "text", php: "text", ini: "text", toml: "text", env: "text",
};

export const extOf = (name: string): string => (/\.([A-Za-z0-9]{1,8})$/.exec(String(name ?? ""))?.[1] ?? "").toLowerCase();

export function kindOf(name: string, mime = ""): AttachKind {
  const k = EXT[extOf(name)];
  if (k) return k;
  const m = String(mime).toLowerCase();
  if (m.startsWith("image/")) return "image";
  if (m.startsWith("video/")) return "video";
  if (m.startsWith("audio/")) return "audio";
  if (m === "application/pdf") return "pdf";
  if (m.includes("zip") || m.includes("tar") || m.includes("compressed")) return "zip";
  if (m.startsWith("text/") || m === "application/json") return "text";
  return "other";
}

/** A file name that is safe inside a storage path. */
export function safeFileName(name: string): string {
  const base = String(name ?? "").split(/[\\/]/).pop() ?? "";
  const clean = base.normalize("NFKD").replace(/[^\w.\- ]+/g, "_").replace(/\s+/g, "_").replace(/^\.+/, "").slice(0, 90);
  return clean || "file";
}

export function humanSize(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "?";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

export const ATTACH_ID = /^att_[a-z0-9]{6,20}$/;

/** The note that goes into the chat message. It never contains a download link (links expire and must not be stored). */
export function attachmentBlock(list: Attachment[]): string {
  const ok = list.filter((a) => a.status === "ready");
  if (!ok.length) return "";
  const lines = ok.map((a) => `- ${a.name} · ${a.kind} · ${humanSize(a.size)}${a.text !== undefined ? " · content below" : ` · id=${a.id}`}`);
  let room = 300_000; // all inline text together stays small enough for the chat document
  const inline = ok.filter((a) => a.text !== undefined).map((a) => {
    const body = String(a.text).slice(0, Math.max(0, room));
    room -= body.length;
    return `\n📄 ${a.name}\n\`\`\`\n${body}${body.length < String(a.text).length ? "\n…(cut)" : ""}\n\`\`\``;
  }).join("");
  const seen = ok.find((a) => a.vision);
  const other = ok.filter((a) => a.kind === "image" && a !== seen).length;
  const notes = [
    seen ? `(The photo "${seen.name}" is shown to you in this message.)` : "",
    other ? `(${other} more photo(s) were NOT shown to you. Tell the owner to send them one at a time if you must see them.)` : "",
    ok.some((a) => a.text === undefined) ? "(Files are stored privately. Tools: attachments.list, attachments.read, attachments.link. A video can be posted with social.post_video {video_id:\"<id>\"}.)" : "",
  ].filter(Boolean).join("\n");
  return `\n\n📎 Attached files:\n${lines.join("\n")}${inline}${notes ? "\n" + notes : ""}`;
}

export const attachmentIdsIn = (text: string): string[] => Array.from(String(text ?? "").matchAll(/\bid=(att_[a-z0-9]{6,20})\b/g)).map((m) => m[1]);

/** The little name shown on a card: long names keep their start and their ending (so the file type stays visible). */
export function shortName(name: string, max = 24): string {
  const n = String(name ?? "");
  if (n.length <= max) return n;
  const keep = max - 1;
  const tail = Math.min(10, Math.floor(keep / 2));
  return `${n.slice(0, keep - tail)}…${n.slice(n.length - tail)}`;
}

/** The label on a card's badge: ZIP, PNG, MP4, PDF ... */
export const badgeOf = (name: string, kind: AttachKind): string => (extOf(name) || kind).toUpperCase().slice(0, 5);

export type SentFile = { id: string; name: string; kind: string; size: string; inline: boolean };
const BLOCK_MARK = "\n\n📎 Attached files:\n";

/** Splits a sent message into the owner's own words and the files list that attachmentBlock() added (shown as cards, not as text). */
export function splitAttachmentBlock(content: string): { text: string; files: SentFile[] } {
  const c = String(content ?? "");
  const i = c.indexOf(BLOCK_MARK);
  if (i < 0) return { text: c, files: [] };
  const files: SentFile[] = [];
  for (const line of c.slice(i + BLOCK_MARK.length).split("\n")) {
    if (!line.startsWith("- ")) break;
    const parts = line.slice(2).split(" · ");
    const last = parts[parts.length - 1] ?? "";
    const inline = last === "content below";
    const id = last.startsWith("id=") ? last.slice(3) : "";
    if (inline || id) parts.pop();
    const size = parts.pop() ?? "";
    const kind = parts.pop() ?? "other";
    const name = parts.join(" · ");
    if (name) files.push({ id, name, kind, size, inline });
  }
  return { text: c.slice(0, i), files };
}

import type { Def } from "./plugins";
import type { ToolCtx } from "./types";
import { attachmentUrl, findAttachment, listAttachments } from "@/lib/attachments-server";

const needCtx = (ctx: ToolCtx | undefined): ToolCtx => { if (!ctx) throw new Error("This tool only works from a chat."); return ctx; };
const arg = (a: Record<string, unknown>, key: string) => String(a[key] ?? "").trim();

export const ATTACHMENT_TOOLS: Def[] = [
  {
    name: "attachments.list", risk: "read", params: "limit?:number",
    description: "List files attached to this chat. Returns file names, types, sizes and IDs.",
    run: async (a, _c, ctx) => {
      const c = needCtx(ctx);
      const limit = Math.max(1, Math.min(40, Number(a.limit) || 20));
      const files = await listAttachments(c.uid, c.chatId, limit);
      return files.length ? files.map(f => `- ${f.name} | ${f.kind} | ${f.size} bytes | id=${f.id}`).join("\n") : "No ready attachments in this chat.";
    },
  },
  {
    name: "attachments.link", risk: "read", params: "file:string (attachment ID, exact name, partial name, or latest)",
    description: "Create a temporary download link for a file attached to this chat.",
    run: async (a, _c, ctx) => {
      const c = needCtx(ctx);
      const file = await findAttachment(c.uid, c.chatId, arg(a, "file"));
      if (!file) throw new Error("Attachment not found in this chat.");
      return `${file.name}: ${await attachmentUrl(file)}`;
    },
  },
  {
    name: "attachments.read", risk: "read", params: "file:string (attachment ID, exact name, partial name, or latest)",
    description: "Read a text-based attachment from this chat. Binary files should be opened with the computer/browser tools.",
    run: async (a, _c, ctx) => {
      const c = needCtx(ctx);
      const file = await findAttachment(c.uid, c.chatId, arg(a, "file"));
      if (!file) throw new Error("Attachment not found in this chat.");
      if (!/^(text|application\/(json|xml|javascript|x-yaml)|application\/pdf)$/i.test(file.mime) && !/\.(txt|md|json|csv|tsv|log|xml|html|css|js|ts|tsx|jsx|py|sql|yaml|yml|sh|java|c|cpp|go|rs|rb|php)$/i.test(file.name)) {
        return `${file.name} is a ${file.kind} file. Use attachments.link or the computer/browser tools to inspect it.`;
      }
      const url = await attachmentUrl(file);
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Could not download attachment (HTTP ${response.status}).`);
      const body = await response.text();
      return body.slice(0, 30000) + (body.length > 30000 ? "\n\n[Output truncated at 30,000 characters.]" : "");
    },
  },
];
