import { doc, getDoc, onSnapshot, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";

export type CodeLog = { kind: string; text: string; depth?: number; path?: string; lines?: Array<{ t: string; n?: number; text: string }> };
export type CodeProject = {
  id: string; // = chat id: every chat has exactly ONE codespace
  name: string; createdAt: number; updatedAt: number; ctx: string; backupPath?: string;
  log: CodeLog[]; running?: boolean; todo?: string; stop?: boolean;
};

export const newCodeProject = (chatId: string, name: string): CodeProject => ({
  id: chatId, name: name.slice(0, 48) || "Codespace", createdAt: Date.now(), updatedAt: Date.now(), ctx: "", log: [],
});

const ref = (uid: string, id: string) => doc(db, "users", uid, "codeProjects", id);

export async function getCodeProject(uid: string, id: string): Promise<CodeProject | null> {
  const s = await getDoc(ref(uid, id));
  return s.exists() ? (s.data() as CodeProject) : null;
}
export async function saveCodeProject(uid: string, p: CodeProject) {
  const clean = { ...p, log: (p.log ?? []).slice(-300) };
  await setDoc(ref(uid, p.id), JSON.parse(JSON.stringify(clean)));
}
export function watchCodeProject(uid: string, id: string, cb: (p: CodeProject | null) => void) {
  return onSnapshot(ref(uid, id), (s) => cb(s.exists() ? (s.data() as CodeProject) : null), () => cb(null));
}
export async function setStop(uid: string, id: string, stop: boolean) {
  await setDoc(ref(uid, id), { stop }, { merge: true });
}