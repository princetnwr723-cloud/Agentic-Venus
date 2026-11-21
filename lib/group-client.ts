// Browser side of the group chat: live messages and shared state from Firestore, and the calls to /api/team/run.
import { collection, doc, getDoc, limit, onSnapshot, orderBy, query, setDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import type { GMsg } from "@/lib/group-core";

export type GroupStateDoc = { memory: Record<string, string[]>; pins: string[]; working: Record<string, string>; running: string[] };
const emptyState = (): GroupStateDoc => ({ memory: {}, pins: [], working: {}, running: [] });
const stateRef = (uid: string, chatId: string) => doc(db, "users", uid, "teams", chatId, "group", "state");

export function watchGroupMsgs(uid: string, chatId: string, cb: (m: GMsg[]) => void) {
  const q = query(collection(db, "users", uid, "teams", chatId, "groupMsgs"), orderBy("at", "desc"), limit(120));
  return onSnapshot(q, (s) => cb(s.docs.map((d) => d.data() as GMsg).reverse()), () => cb([]));
}

export function watchGroupState(uid: string, chatId: string, cb: (s: GroupStateDoc) => void) {
  return onSnapshot(stateRef(uid, chatId), (s) => cb({ ...emptyState(), ...(s.exists() ? (s.data() as Partial<GroupStateDoc>) : {}) }), () => cb(emptyState()));
}

export async function groupCall(uid: string, action: string, payload: Record<string, unknown>): Promise<any> {
  const token = (await auth.currentUser?.getIdToken()) ?? "";
  const res = await fetch("/api/team/run", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + token }, body: JSON.stringify({ uid, action, ...payload }) });
  const d = await res.json().catch(() => ({}));
  if (!res.ok || d.ok === false) throw new Error(d.error || "The group chat request failed.");
  return d;
}

/** The owner removes one lasting note a member has learned. */
export async function removeNote(uid: string, chatId: string, memberId: string, line: string): Promise<void> {
  const cur = ((await getDoc(stateRef(uid, chatId))).data() as Partial<GroupStateDoc> | undefined)?.memory?.[memberId] ?? [];
  await setDoc(stateRef(uid, chatId), { memory: { [memberId]: cur.filter((x) => x !== line) } }, { merge: true });
}

/** The owner removes one pinned fact. */
export async function removePin(uid: string, chatId: string, line: string): Promise<void> {
  const cur = ((await getDoc(stateRef(uid, chatId))).data() as Partial<GroupStateDoc> | undefined)?.pins ?? [];
  await setDoc(stateRef(uid, chatId), { pins: cur.filter((x) => x !== line) }, { merge: true });
}