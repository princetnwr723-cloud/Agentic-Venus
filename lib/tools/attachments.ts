// attachments.* : the files the owner attached in this chat (photo, video, audio, zip, PDF, Office, code ...).
// The files sit in private storage; these tools read them (text, zip contents, docx/xlsx/pptx text) or give a short-lived
// download link so the computer can fetch the file. Everything read from a file is outside text: the registry wraps it.
import { listAttachments, findAttachment, attachmentUrl } from "@/lib/attachments-server";
import { extOf, humanSize } from "@/lib/attachments";
import { safeFetch } from "./net";
import { officeText, zipEntries } from "@/lib/zip-lite";
import type { Def } from "./plugins";

const MAX_READ_BYTES = 60 * 1024 * 1024;

async function download(url: string, limit = MAX_READ_BYTES): Promise<Buffer> {
  const res = await safeFetch(url, { headers: { "User-Agent": "AgenticVenus/1.0" } }, 50_000);
  if (!res.ok) throw new Error(`Could not read the file from storage (HTTP ${res.status}).`);
  const len = Number(res.headers.get("content-length") ?? 0);
  if (len > limit) throw new Error(`The file is ${humanSize(len)}: too big to open in chat. Use attachments.link and let the computer open it.`);
  const b = Buffer.from(await res.arrayBuffer());
  if (b.length > limit) throw new Error("The file is too big to open in chat. Use attachments.link and let the computer open it.");
  return b;
}

const isBinary = (b: Buffer) => b.subarray(0, 4000).includes(0);

export const ATTACHMENT_TOOLS: Def[] = [
  {
    name: "attachments.list", risk: "read", params: "",
    description: "The files the owner attached in this chat (id, name, type, size), newest first. Call it when the owner says \"the file / photo / video / zip I sent\".",
    run: async (_a, _c, ctx) => {
      if (!ctx) throw new Error("Only available inside a chat.");
      const rows = (await listAttachments(ctx.uid, ctx.chatId)).map((a) => `id=${a.id} · ${a.name} · ${a.kind} · ${humanSize(a.size)} · ${new Date(a.createdAt).toISOString().slice(0, 16).replace("T", " ")}`);
      return rows.length ? rows.join("\n") : "No attached files in this chat yet. Ask the owner to press the paperclip.";
    },
  },
  {
    name: "attachments.read", risk: "read", params: "id:string (attachment id, exact file name or \"latest\"), file?:string (a file INSIDE a zip), max_chars?:number (default 12000, max 40000)",
    description: "Read an attached file. Text, code, CSV and JSON come back as text. A zip comes back as its file list (give `file` to read one file inside it). Word, Excel and PowerPoint files come back as their text. Photos are shown to you directly when the owner sends them. Video, audio and PDF are described by size and type: for them use attachments.link and the computer (ffmpeg, pdftotext).",
    run: async (a, _c, ctx) => {
      if (!ctx) throw new Error("Only available inside a chat.");
      const f = await findAttachment(ctx.uid, ctx.chatId, a.id ?? a.attachment_id ?? a.name);
      if (!f) throw new Error("No such attachment in this chat. Call attachments.list to see the ids.");
      const max = Math.min(40_000, Math.max(500, Math.floor(Number(a.max_chars)) || 12_000));
      const head = `${f.name} (${f.kind}, ${humanSize(f.size)})\n`;
      const ext = extOf(f.name);
      if (f.kind === "image") return head + "This is a photo. When the owner sends it, it is shown to you inside that message. To process it (resize, convert, extract text) use attachments.link and the computer.";
      if (["video", "audio", "pdf"].includes(f.kind)) return head + `A ${f.kind} file cannot be opened as text here. ${f.kind === "video" ? "It can be posted with social.post_video {video_id:\"" + f.id + "\"}. " : ""}To look inside, call attachments.link and give the link to the computer (it can use ffmpeg / pdftotext).`;
      if (f.size > MAX_READ_BYTES) throw new Error(`The file is ${humanSize(f.size)}: too big to open in chat. Use attachments.link and let the computer open it.`);
      const buf = await download(await attachmentUrl(f, 900));
      if (ext === "zip" || ext === "jar" || ext === "apk") {
        const es = zipEntries(buf);
        const inner = String(a.file ?? "").trim();
        if (inner) {
          const e = es.find((x) => x.name === inner) ?? es.find((x) => x.name.toLowerCase().endsWith(inner.toLowerCase()));
          if (!e) throw new Error(`"${inner}" is not in the zip. Call attachments.read without \`file\` to see the list.`);
          const { zipRead } = await import("@/lib/zip-lite");
          const data = zipRead(buf, e);
          if (isBinary(data)) return head + `Inside: ${e.name} · ${humanSize(e.size)} · binary file, not shown as text.`;
          return head + `Inside: ${e.name}\n` + data.toString("utf8").slice(0, max);
        }
        const rows = es.slice(0, 300).map((e) => `${e.dir ? "📁" : "·"} ${e.name}${e.dir ? "" : ` (${humanSize(e.size)})`}`);
        return head + `${es.length} entries${es.length > 300 ? " (first 300 shown)" : ""}:\n${rows.join("\n")}\nRead one with attachments.read {id, file:"<name>"}.`;
      }
      if (["docx", "xlsx", "pptx"].includes(ext)) {
        const t = officeText(buf, ext);
        if (t) return head + t.slice(0, max) + (t.length > max ? `\n…(${t.length - max} more characters)` : "");
      }
      if (["tar", "gz", "tgz", "7z", "rar"].includes(ext)) return head + "This archive type cannot be opened here. Use attachments.link and let the computer extract it.";
      if (isBinary(buf)) return head + "A binary file: not shown as text. Use attachments.link and let the computer handle it.";
      const t = buf.toString("utf8");
      return head + t.slice(0, max) + (t.length > max ? `\n…(${t.length - max} more characters; call again with a bigger max_chars or read it in the computer)` : "");
    },
  },
  {
    name: "attachments.link", risk: "read", params: "id:string (attachment id, exact file name or \"latest\")",
    description: "A private download link (valid 1 hour) for an attached file. Use it to give the file to the computer, e.g. in a task: \"download <link> with curl -L -o <name>, then ...\". Never show the link to anyone else and never post it publicly.",
    run: async (a, _c, ctx) => {
      if (!ctx) throw new Error("Only available inside a chat.");
      const f = await findAttachment(ctx.uid, ctx.chatId, a.id ?? a.attachment_id ?? a.name);
      if (!f) throw new Error("No such attachment in this chat. Call attachments.list to see the ids.");
      return `${f.name} (${f.kind}, ${humanSize(f.size)})\nDownload (valid 1 hour): ${await attachmentUrl(f, 3600)}\nOn the computer: curl -L -o ${JSON.stringify(f.name)} "<link>"`;
    },
  },
];