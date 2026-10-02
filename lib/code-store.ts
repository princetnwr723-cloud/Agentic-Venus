import { collection, deleteDoc, doc, getDoc, getDocs, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";

export type CodeLog = { kind: string; text: string; depth?: number };
export type CodeProject = {
  id: string; name: string; createdAt: number; updatedAt: number;
  ctx: string; previewUrl?: string; backupPath?: string; log: CodeLog[];
};

export const newCodeProject = (name: string): CodeProject => ({
  id: "c" + Date.now().toString(36), name: name.trim().slice(0, 48) || "Workspace",
  createdAt: Date.now(), updatedAt: Date.now(), ctx: "", log: [],
});

export async function listCodeProjects(uid: string): Promise<CodeProject[]> {
  const snap = await getDocs(collection(db, "users", uid, "codeProjects"));
  return snap.docs.map((d) => d.data() as CodeProject).sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getCodeProject(uid: string, id: string): Promise<CodeProject | null> {
  const snap = await getDoc(doc(db, "users", uid, "codeProjects", id));
  return snap.exists() ? (snap.data() as CodeProject) : null;
}

export async function saveCodeProject(uid: string, p: CodeProject) {
  const clean = { ...p, log: (p.log ?? []).slice(-250).map((l) => ({ ...l, text: String(l.text).slice(0, 600) })) };
  await setDoc(doc(db, "users", uid, "codeProjects", p.id), JSON.parse(JSON.stringify(clean)));
}

export async function deleteCodeProject(uid: string, id: string) {
  await deleteDoc(doc(db, "users", uid, "codeProjects", id));
}

export async function getCodeComputer(uid: string): Promise<{ sandboxId?: string } | null> {
  const snap = await getDoc(doc(db, "users", uid, "codeStudio", "main"));
  return snap.exists() ? (snap.data() as { sandboxId?: string }) : null;
}

export async function saveCodeComputer(uid: string, sandboxId: string | null) {
  await setDoc(doc(db, "users", uid, "codeStudio", "main"), { sandboxId }, { merge: true });
}