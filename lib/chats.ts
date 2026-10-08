import {
  collection, addDoc, doc, getDoc, getDocs, updateDoc, deleteDoc, query, orderBy, serverTimestamp, type Timestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { AvatarColor } from "@/lib/bots";
import type { ProviderId } from "@/lib/providers";

export type ChatMessage = { role: "user" | "assistant"; content: string; at: number };

export type Chat = {
  id: string;
  agentName: string;
  agentColor: AvatarColor;
  provider: ProviderId;
  model: string;
  messages: ChatMessage[];
  pcSandboxId?: string | null;
  pcPaused?: boolean;
  pcPersistence?: "lifecycle" | "autoPause" | "none";
  pcLastSeenAt?: number;
  pcRecoveryCount?: number;
  codeWs?: string | null;
  connectors?: Record<string, string>;
  createdAt?: Timestamp;
};

function chatsCol(uid: string) {
  return collection(db, "users", uid, "chats");
}

export async function listChats(uid: string): Promise<Chat[]> {
  const q = query(chatsCol(uid), orderBy("createdAt", "desc"));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Chat, "id">) }));
}

export async function createChat(
  uid: string,
  init: { agentName: string; agentColor: AvatarColor; provider: ProviderId; model: string }
): Promise<Chat> {
  const ref = await addDoc(chatsCol(uid), {
    ...init, messages: [], pcSandboxId: null, pcPaused: false, codeWs: null, createdAt: serverTimestamp(),
  });
  return { id: ref.id, messages: [], pcSandboxId: null, pcPaused: false, codeWs: null, ...init };
}

export async function updateChatMessages(uid: string, chatId: string, messages: ChatMessage[]) {
  await updateDoc(doc(db, "users", uid, "chats", chatId), { messages });
}

export async function updateChatModel(uid: string, chatId: string, provider: ProviderId, model: string) {
  await updateDoc(doc(db, "users", uid, "chats", chatId), { provider, model });
}

export async function updateChatPc(
  uid: string,
  chatId: string,
  pcSandboxId: string | null,
  pcPaused = false,
  meta?: { persistence?: Chat["pcPersistence"]; recovery?: boolean },
) {
  const patch: Record<string, unknown> = { pcSandboxId, pcPaused, pcLastSeenAt: Date.now() };
  if (meta?.persistence) patch.pcPersistence = meta.persistence;
  if (meta?.recovery) {
    const current = await getDoc(doc(db, "users", uid, "chats", chatId));
    const row = current.exists() ? current.data() as { pcRecoveryCount?: number } : undefined;
    patch.pcRecoveryCount = Number(row?.pcRecoveryCount ?? 0) + 1;
  }
  await updateDoc(doc(db, "users", uid, "chats", chatId), patch);
}

export async function updateChatCode(uid: string, chatId: string, codeWs: string | null) {
  await updateDoc(doc(db, "users", uid, "chats", chatId), { codeWs });
}

export async function updateChatConnectors(uid: string, chatId: string, connectors: Record<string, string>) {
  await updateDoc(doc(db, "users", uid, "chats", chatId), { connectors });
}

export async function deleteChat(uid: string, chatId: string) {
  await deleteDoc(doc(db, "users", uid, "chats", chatId));
}