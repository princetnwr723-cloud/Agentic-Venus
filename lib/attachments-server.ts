// Server-only. Where attachments live: private Supabase Storage (the file) + Firestore (the note about it).
import { getAdminDb } from "@/lib/firebase-admin";
import { createSignedDownload, createSignedUpload, supabaseConfigured } from "@/lib/supabase-server";
import { ATTACH_ID, kindOf, MAX_ATTACH_BYTES, safeFileName, type AttachKind } from "@/lib/attachments";

export type AttachDoc = { id: string; name: string; size: number; mime: string; kind: AttachKind; path: string; createdAt: number; status: "pending" | "ready" };

const col = (uid: string, chatId: string) => getAdminDb().collection("users").doc(uid).collection("chats").doc(chatId).collection("attachments");
const cleanId = (v: unknown) => String(v ?? "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 80);
const rand = () => Math.random().toString(36).slice(2, 10).padEnd(8, "0");

/** A one-time upload link for one file. The file goes from the browser straight to storage. */
export async function signAttachment(uid: string, chatIdRaw: string, input: { name: unknown; size: unknown; mime: unknown }): Promise<{ id: string; uploadUrl: string; path: string; kind: AttachKind }> {
  if (!supabaseConfigured()) throw new Error("File storage is not set up: add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Vercel and redeploy.");
  const chatId = cleanId(chatIdRaw);
  if (!chatId) throw new Error("chatId is missing.");
  const size = Math.floor(Number(input.size));
  if (!Number.isFinite(size) || size <= 0) throw new Error("This file is empty.");
  if (size > MAX_ATTACH_BYTES) throw new Error(`This file is too big (limit ${Math.round(MAX_ATTACH_BYTES / 1024 / 1024)} MB).`);
  const name = safeFileName(String(input.name ?? ""));
  const mime = String(input.mime ?? "").slice(0, 100) || "application/octet-stream";
  const id = `att_${rand()}`;
  const path = `${uid}/attachments/${chatId}/${id}-${name}`;
  const uploadUrl = await createSignedUpload(path);
  const kind = kindOf(name, mime);
  const doc: AttachDoc = { id, name, size, mime, kind, path, createdAt: Date.now(), status: "pending" };
  await col(uid, chatId).doc(id).set(doc);
  return { id, uploadUrl, path, kind };
}

export async function markReady(uid: string, chatIdRaw: string, id: string): Promise<void> {
  const chatId = cleanId(chatIdRaw);
  if (!ATTACH_ID.test(id)) throw new Error("Bad attachment id.");
  const ref = col(uid, chatId).doc(id);
  const snap = await ref.get();
  if (!snap.exists) throw new Error("Unknown attachment.");
  await ref.set({ ...(snap.data() as AttachDoc), status: "ready" });
}

export async function listAttachments(uid: string, chatIdRaw: string, limit = 40): Promise<AttachDoc[]> {
  const snap = await col(uid, cleanId(chatIdRaw)).orderBy("createdAt", "desc").limit(limit).get();
  return snap.docs.map((d: any) => d.data() as AttachDoc).filter((d: AttachDoc) => d.status === "ready");
}

/** One attachment of THIS chat (id, exact file name, or "latest"). */
export async function findAttachment(uid: string, chatIdRaw: string, want: unknown): Promise<AttachDoc | null> {
  const w = String(want ?? "").trim();
  const all = await listAttachments(uid, chatIdRaw);
  if (!w || /^(latest|last|newest|recent|new)\b/i.test(w)) return all[0] ?? null;
  const wl = w.toLowerCase();
  const hit = all.find((a) => a.id === w) ?? all.find((a) => a.name.toLowerCase() === wl) ?? all.find((a) => a.name.toLowerCase().includes(wl));
  if (hit) return hit;
  return null;
}

export const attachmentUrl = (a: AttachDoc, seconds = 3600): Promise<string> => {
  if (!a.path.includes("/attachments/") || a.path.includes("..")) throw new Error("Bad attachment path.");
  return createSignedDownload(a.path, seconds);
};
