// Shared by the browser components (no server-only imports).
// Files and videos that the agent shows in the chat live in PRIVATE storage and are found by their PATH.
// A download link is only a short-lived key to that path, so the chat never keeps a link: every card asks the
// server for a fresh one when it needs it. That is why a file shown in the chat keeps opening, also months later.
import { extOf, kindOf, type AttachKind } from "@/lib/attachments";

export type ChatFile = { path: string; name: string; ext: string; kind: AttachKind; size?: string };

const SIGNED = /\/storage\/v1\/object\/sign\/venus-videos\/([^?#\s]+)/;
const URL_RE = /https?:\/\/[^\s)\]>"'<]+\/storage\/v1\/object\/sign\/venus-videos\/[^\s)\]>"'<]+/g;
const MD_LINK = /\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/g;

/** The storage path inside a signed link ("uid/attachments/chat/att_x-report.pdf"), or null when the link is not ours. */
export function storagePath(url: string): string | null {
  const m = SIGNED.exec(url);
  if (!m) return null;
  try { const p = decodeURIComponent(m[1]); return p.includes("..") ? null : p; } catch { return null; }
}

/** The name the owner sees: the attachment id in front of the stored name is removed. */
export function niceName(path: string, label = ""): string {
  const last = path.split("/").pop() ?? "file";
  const base = last.replace(/^att_[a-z0-9]{6,20}-/, "");
  if (/\/proof\//.test(path)) return "Computer replay.mp4";
  const l = label.trim();
  if (l && /\.[A-Za-z0-9]{1,8}$/.test(l) && l.length <= 90) return l;
  return base || "file";
}

export function chatFileOf(path: string, label = "", size?: string): ChatFile {
  const name = niceName(path, label);
  return { path, name, ext: extOf(name), kind: kindOf(name), size };
}

const DECOR = /^[\s\-*•>\d.:()📎🎥⬇️🔗📄]+/u;

/** Takes every private-storage link out of a reply and returns the clean text plus the files those links pointed at. */
export function pullStorageLinks(text: string): { text: string; links: Array<{ path: string; label: string }> } {
  const links: Array<{ path: string; label: string }> = [];
  const out: string[] = [];
  let fenced = false;
  for (const line of String(text ?? "").split("\n")) {
    if (/^\s*```/.test(line)) { fenced = !fenced; out.push(line); continue; }
    if (fenced) { out.push(line); continue; }
    let hit = false;
    let label = "";
    let l = line.replace(MD_LINK, (all, lab: string, url: string) => {
      const p = storagePath(url);
      if (!p) return all;
      links.push({ path: p, label: lab });
      label = lab; hit = true;
      return "";
    });
    l = l.replace(URL_RE, (url) => {
      const p = storagePath(url);
      if (!p) return url;
      links.push({ path: p, label: "" });
      hit = true;
      return "";
    });
    if (!hit) { out.push(line); continue; }
    const rest = l.replace(/\((?:the )?link works for[^)]*\)/gi, "").replace(/\([^)]*\)/g, " ").replace(DECOR, "").replace(label, "");
    const words = rest.split(/\s+/).filter((w) => /\p{L}{3,}/u.test(w));
    if (words.length <= 2) continue; // the line was only the link ("- Download the video", "📎 report.pdf (12 KB): <link>")
    out.push(l.replace(/\s+$/, "").replace(/:\s*$/, "."));
  }
  const seen = new Set<string>();
  const uniq = links.filter((k) => (seen.has(k.path) ? false : (seen.add(k.path), true)));
  return { text: out.join("\n").replace(/\n{3,}/g, "\n\n").trim(), links: uniq };
}

// ---- fresh links (cached for 40 minutes; a link itself lasts 6 hours) ----
const cache = new Map<string, { url: string; t: number }>();

export async function freshLink(uid: string, path: string, download?: string): Promise<string> {
  const key = `${path}|${download ?? ""}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < 40 * 60_000) return hit.url;
  const res = await fetch("/api/venus/media", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "url", uid, path, download }),
  });
  const d = await res.json().catch(() => ({}));
  if (!res.ok || !d?.url) throw new Error(d?.error || "Could not open the file.");
  cache.set(key, { url: String(d.url), t: Date.now() });
  return String(d.url);
}

/** Starts a download without leaving the chat. */
export function startDownload(url: string, name: string) {
  const a = document.createElement("a");
  a.href = url; a.download = name; a.rel = "noopener";
  document.body.appendChild(a); a.click(); a.remove();
}

/** Removes the lines that are only a link to `marker` ("- [Open the Code page](/code?chat=x)"); a sentence that merely contains it stays. */
function dropLinkLines(text: string, marker: string): string {
  return text.split("\n").filter((l) => {
    if (!l.includes(marker)) return true;
    const rest = l.replace(/\[[^\]]*\]\([^)]*\)/g, " ").replace(DECOR, "");
    return rest.split(/\s+/).filter((w) => /\p{L}{3,}/u.test(w)).length > 2;
  }).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** The pieces of a finished-work reply: the clean text and the cards to draw under it. */
export type WorkParts = {
  text: string;
  files: ChatFile[];
  replay: { path: string } | null;
  video: { path: string; projectId: string; title: string } | null;
  code: { chatId: string; status: "finished" | "stopped" } | null;
};

const VIDEO_EXT = new Set(["mp4", "webm", "mov", "m4v"]);

export function parseWork(body: string): WorkParts {
  let text = String(body ?? "");
  const projectLink = /\[[^\]]*\]\(\/venus\?project=([A-Za-z0-9_-]+)\)/.exec(text);
  const codeHead = /^\s*(✅|⚠️|⚠)\s*Venus Code (finished|stopped)/i.exec(text);
  const codeLink = /\[[^\]]*\]\(\/code\?chat=([A-Za-z0-9_-]+)\)/.exec(text);

  const pulled = pullStorageLinks(text);
  text = pulled.text;

  let replay: WorkParts["replay"] = null;
  let video: WorkParts["video"] = null;
  const files: ChatFile[] = [];
  for (const k of pulled.links) {
    const ext = extOf(k.path);
    if (/^[^/]+\/proof\//.test(k.path)) { if (!replay) replay = { path: k.path }; continue; }
    if (projectLink && VIDEO_EXT.has(ext) && !video) {
      const t = /\*\*([^*]+)\*\*/.exec(body);
      video = { path: k.path, projectId: projectLink[1], title: t ? t[1].trim().slice(0, 120) : "Your video" };
      continue;
    }
    files.push(chatFileOf(k.path, k.label));
  }

  if (video && projectLink) text = dropLinkLines(text, `/venus?project=${projectLink[1]}`); // the Venus Pro button lives on the card now

  let code: WorkParts["code"] = null;
  if (codeHead && codeLink) {
    code = { chatId: codeLink[1], status: codeHead[2].toLowerCase() === "stopped" ? "stopped" : "finished" };
    text = dropLinkLines(text, `/code?chat=${codeLink[1]}`);
  }
  return { text, files, replay, video, code };
}
