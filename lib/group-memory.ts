// Server side of the group's shared state: what each member has learned (notes), what the whole group pinned, who is busy.
// Stored in users/{uid}/teams/{chatId}/group/state (a sub-document, so the Team panel's own document is never touched).
import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase-admin";
import { MAX_NOTES, MAX_PINS, memoryBlock, mergeLines } from "@/lib/group-core";

export type GroupState = { memory: Record<string, string[]>; pins: string[]; working: Record<string, string>; running: string[] };

const ref = (uid: string, chatId: string) => getAdminDb().collection("users").doc(uid).collection("teams").doc(chatId).collection("group").doc("state");

export async function readGroupState(uid: string, chatId: string): Promise<GroupState> {
  try {
    const d = (await ref(uid, chatId).get()).data() as Partial<GroupState> | undefined;
    return { memory: d?.memory ?? {}, pins: Array.isArray(d?.pins) ? d!.pins! : [], working: d?.working ?? {}, running: Array.isArray(d?.running) ? d!.running! : [] };
  } catch { return { memory: {}, pins: [], working: {}, running: [] }; }
}

/** The text block a member sees in every prompt: the group's pins and the member's own notes. Empty string when there is nothing. */
export async function memoryFor(uid: string, chatId: string, memberId: string): Promise<string> {
  const s = await readGroupState(uid, chatId);
  return memoryBlock(s.memory[memberId] ?? [], s.pins);
}

export async function saveNotes(uid: string, chatId: string, memberId: string, notes: string[]): Promise<void> {
  if (!notes.length) return;
  const r = ref(uid, chatId);
  await getAdminDb().runTransaction(async (tx) => {
    const cur = ((await tx.get(r)).data() as Partial<GroupState> | undefined)?.memory?.[memberId] ?? [];
    tx.set(r, { memory: { [memberId]: mergeLines(cur, notes, MAX_NOTES) } }, { merge: true });
  }).catch(() => {});
}

export async function savePins(uid: string, chatId: string, pins: string[]): Promise<void> {
  if (!pins.length) return;
  const r = ref(uid, chatId);
  await getAdminDb().runTransaction(async (tx) => {
    const cur = ((await tx.get(r)).data() as Partial<GroupState> | undefined)?.pins ?? [];
    tx.set(r, { pins: mergeLines(cur, pins, MAX_PINS) }, { merge: true });
  }).catch(() => {});
}

export async function setWorking(uid: string, chatId: string, memberId: string, text: string | null): Promise<void> {
  await ref(uid, chatId).set({ working: { [memberId]: text === null ? FieldValue.delete() : text.slice(0, 140) } }, { merge: true }).catch(() => {});
}

export async function setRunning(uid: string, chatId: string, turnId: string, on: boolean): Promise<void> {
  await ref(uid, chatId).set({ running: on ? FieldValue.arrayUnion(turnId) : FieldValue.arrayRemove(turnId) }, { merge: true }).catch(() => {});
}