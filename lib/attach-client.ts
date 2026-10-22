// Browser only. Prepares and uploads attached files.
import { kindOf, MAX_ATTACH_BYTES, MAX_INLINE_TEXT, type Attachment } from "@/lib/attachments";

const post = async (body: Record<string, unknown>) => {
  const res = await fetch("/api/attachments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `Request failed (${res.status}).`);
  return data;
};

/** A photo shrunk to a small JPEG the model can look at (the original is uploaded untouched). null when the browser cannot decode it. */
async function visionCopy(file: File): Promise<Attachment["vision"] | undefined> {
  try {
    if (!/^image\/(png|jpe?g|webp|gif|bmp|avif)$/i.test(file.type)) return undefined;
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 1568 / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * scale)), h = Math.max(1, Math.round(bmp.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const g = canvas.getContext("2d");
    if (!g) return undefined;
    g.fillStyle = "#fff"; g.fillRect(0, 0, w, h); g.drawImage(bmp, 0, 0, w, h);
    bmp.close?.();
    let data = canvas.toDataURL("image/jpeg", 0.8).split(",")[1] ?? "";
    if (data.length > 1_500_000) data = canvas.toDataURL("image/jpeg", 0.55).split(",")[1] ?? "";
    return data && data.length <= 2_500_000 ? { mediaType: "image/jpeg", data } : undefined;
  } catch { return undefined; }
}

let counter = 0;
const tmpId = () => `tmp_${Date.now().toString(36)}${(counter++).toString(36)}`;

/** The first step for one picked file: checks it and decides how it travels (inline text, or upload). */
export async function localAttachment(file: File): Promise<Attachment> {
  const base = { id: tmpId(), name: file.name || "file", size: file.size, mime: file.type || "application/octet-stream", kind: kindOf(file.name, file.type), progress: 0 };
  if (file.size <= 0) return { ...base, status: "error", error: "This file is empty." };
  if (file.size > MAX_ATTACH_BYTES) return { ...base, status: "error", error: `Too big (limit ${Math.round(MAX_ATTACH_BYTES / 1024 / 1024)} MB).` };
  if (base.kind === "text" && file.size <= MAX_INLINE_TEXT) {
    const text = await file.text();
    if (!/[\u0000-\u0008]/.test(text.slice(0, 2000))) return { ...base, text, status: "ready", progress: 1 };
  }
  const vision = base.kind === "image" ? await visionCopy(file) : undefined;
  return { ...base, ...(vision ? { vision } : {}), status: "uploading" };
}

/** Sends the file straight to private storage. Returns the real attachment id. */
export async function uploadAttachment(file: File, chatId: string, onProgress: (p: number) => void): Promise<string> {
  const sig = await post({ action: "sign", chatId, name: file.name, size: file.size, mime: file.type });
  await new Promise<void>((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open("PUT", String(sig.uploadUrl));
    x.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    x.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
    x.onload = () => (x.status >= 200 && x.status < 300 ? resolve() : reject(new Error(`Upload failed (${x.status}): ${String(x.responseText).slice(0, 140)}`)));
    x.onerror = () => reject(new Error("Upload failed: network error."));
    x.onabort = () => reject(new Error("Upload cancelled."));
    x.send(file);
  });
  await post({ action: "ready", chatId, id: sig.id });
  return String(sig.id);
}

/** Fresh private download links for the computer / Venus Code (never stored in the chat). */
export async function attachmentLinks(chatId: string, ids: string[]): Promise<Array<{ id: string; name: string; url: string }>> {
  if (!ids.length) return [];
  try { return (await post({ action: "links", chatId, ids })).files ?? []; } catch { return []; }
}
