import {
  collection,
  addDoc,
  doc,
  getDocs,
  updateDoc,
  deleteDoc,
  query,
  orderBy,
  serverTimestamp,
  type Timestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { AvatarColor } from "@/lib/bots";
import type { ProviderId } from "@/lib/providers";

export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  at: number;
};

export type Chat = {
  id: string;
  agentName: string;
  agentColor: AvatarColor;
  provider: ProviderId;
  model: string;
  messages: ChatMessage[];
  // Each chat owns its own E2B computer.
  pcSandboxId?: string | null;
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
  init: {
    agentName: string;
    agentColor: AvatarColor;
    provider: ProviderId;
    model: string;
  }
): Promise<Chat> {
  const ref = await addDoc(chatsCol(uid), {
    ...init,
    messages: [],
    pcSandboxId: null,
    createdAt: serverTimestamp(),
  });
  return { id: ref.id, messages: [], pcSandboxId: null, ...init };
}

export async function updateChatMessages(
  uid: string,
  chatId: string,
  messages: ChatMessage[]
) {
  await updateDoc(doc(db, "users", uid, "chats", chatId), { messages });
}

export async function updateChatModel(
  uid: string,
  chatId: string,
  provider: ProviderId,
  model: string
) {
  await updateDoc(doc(db, "users", uid, "chats", chatId), { provider, model });
}

export async function updateChatPc(
  uid: string,
  chatId: string,
  pcSandboxId: string | null
) {
  await updateDoc(doc(db, "users", uid, "chats", chatId), { pcSandboxId });
}

export async function deleteChat(uid: string, chatId: string) {
  await deleteDoc(doc(db, "users", uid, "chats", chatId));
}