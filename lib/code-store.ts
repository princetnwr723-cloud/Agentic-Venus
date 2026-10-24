import { collection, deleteDoc, doc, getDoc, getDocs, onSnapshot, query, setDoc, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { updateChatCode } from "@/lib/chats";

export type CodeLog = { kind: string; text: string; depth?: number; path?: string; lines?: Array<{ t: string; n?: number; text: string }> };
/** A background job that runs inside the computer. `hb` = last time a browser tab was watching it. */
export type RunnerJob = { id: string; sandboxId: string; offset: number; hb: number };
export type CodeProject = {
  /** The workspace id. The chat's first project uses the chat id itself (older chats keep working); more projects use "<chatId>__<suffix>". */
  id: string;
  /** The chat this project belongs to. Older documents do not have it: it is derived from the id. */
  chatId?: string;
  name: string; createdAt: number; updatedAt: number; ctx: string; backupPath?: string;
  log: CodeLog[]; running?: boolean; todo?: string; stop?: boolean; runnerJob?: RunnerJob;
};

/** "<chatId>__<suffix>" -> chatId. A plain chat id is returned unchanged. */
export const chatOfProject = (id: string): string => String(id ?? "").split("__")[0];

/** A fresh workspace id for an additional project of this chat. */
export const projectIdFor = (chatId: string): string => `${chatId}__${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

export const newCodeProject = (chatId: string, name: string, id: string = chatId): CodeProject => ({
  id, chatId, name: name.slice(0, 48) || "Codespace", createdAt: Date.now(), updatedAt: Date.now(), ctx: "", log: [],
});

/** True while nothing has been done in the project yet (an empty shell that can still be renamed or reused). */
export const isPristine = (p: CodeProject): boolean => !p.ctx && (p.log ?? []).length === 0;

const col = (uid: string) => collection(db, "users", uid, "codeProjects");
const ref = (uid: string, id: string) => doc(db, "users", uid, "codeProjects", id);

export async function getCodeProject(uid: string, id: string): Promise<CodeProject | null> {
  const s = await getDoc(ref(uid, id));
  return s.exists() ? (s.data() as CodeProject) : null;
}
export async function saveCodeProject(uid: string, p: CodeProject) {
  const clean = { ...p, chatId: p.chatId ?? chatOfProject(p.id), log: (p.log ?? []).slice(-300) };
  await setDoc(ref(uid, p.id), JSON.parse(JSON.stringify(clean)));
}
export function watchCodeProject(uid: string, id: string, cb: (p: CodeProject | null) => void) {
  return onSnapshot(ref(uid, id), (s) => cb(s.exists() ? (s.data() as CodeProject) : null), () => cb(null));
}
export async function setStop(uid: string, id: string, stop: boolean) {
  await setDoc(ref(uid, id), { stop }, { merge: true });
}

const byCreated = (a: CodeProject, b: CodeProject) => (a.createdAt ?? 0) - (b.createdAt ?? 0);

/** All projects of one chat: the main one (id = chat id, may predate the chatId field) plus every "<chatId>__..." project. */
export async function listCodeProjects(uid: string, chatId: string): Promise<CodeProject[]> {
  const map = new Map<string, CodeProject>();
  const main = await getDoc(ref(uid, chatId));
  if (main.exists()) map.set(chatId, main.data() as CodeProject);
  const snap = await getDocs(query(col(uid), where("chatId", "==", chatId)));
  snap.docs.forEach((d) => map.set(d.id, d.data() as CodeProject));
  return [...map.values()].sort(byCreated);
}

/** Live list for the Code page's left side. */
export function watchCodeProjects(uid: string, chatId: string, cb: (list: CodeProject[]) => void) {
  const map = new Map<string, CodeProject>();
  const emit = () => cb([...map.values()].sort(byCreated));
  const u1 = onSnapshot(ref(uid, chatId), (s) => { if (s.exists()) map.set(chatId, s.data() as CodeProject); else map.delete(chatId); emit(); }, () => emit());
  const u2 = onSnapshot(query(col(uid), where("chatId", "==", chatId)), (snap) => {
    const keep = new Set(snap.docs.map((d) => d.id));
    for (const id of [...map.keys()]) if (id !== chatId && !keep.has(id)) map.delete(id);
    snap.docs.forEach((d) => map.set(d.id, d.data() as CodeProject));
    emit();
  }, () => emit());
  return () => { u1(); u2(); };
}

export async function renameCodeProject(uid: string, id: string, name: string) {
  await setDoc(ref(uid, id), { name: name.trim().slice(0, 48) || "Project", chatId: chatOfProject(id) }, { merge: true });
}
export async function removeCodeProject(uid: string, id: string) {
  await deleteDoc(ref(uid, id));
}

/** The project the owner (or the agent) is working in right now. Saved on the chat so the Code page and the agent agree. */
export async function getActiveProjectId(uid: string, chatId: string): Promise<string | null> {
  const s = await getDoc(doc(db, "users", uid, "chats", chatId));
  const v = s.exists() ? (s.data() as { codeWs?: string | null }).codeWs : null;
  return v ? String(v) : null;
}
export async function setActiveProject(uid: string, chatId: string, projectId: string) {
  await updateChatCode(uid, chatId, projectId);
}
