import {
  collection,
  addDoc,
  doc,
  getDocs,
  updateDoc,
  deleteDoc,
  query,
  where,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";

export type Routine = {
  id: string;
  chatId: string;
  name: string;
  instructions: string;
  everyMinutes: number;
  nextRunAt: number;
  enabled: boolean;
  lastRunAt?: number;
  lastResult?: string;
};

function routinesCol(uid: string) {
  return collection(db, "users", uid, "routines");
}

export async function listRoutinesForChat(
  uid: string,
  chatId: string
): Promise<Routine[]> {
  const q = query(routinesCol(uid), where("chatId", "==", chatId));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Routine, "id">) }));
}

export async function createRoutine(
  uid: string,
  init: {
    chatId: string;
    name: string;
    instructions: string;
    everyMinutes: number;
    startAt: number;
  }
): Promise<Routine> {
  const ref = await addDoc(routinesCol(uid), {
    chatId: init.chatId,
    name: init.name,
    instructions: init.instructions,
    everyMinutes: init.everyMinutes,
    nextRunAt: init.startAt,
    enabled: true,
    createdAt: serverTimestamp(),
  });
  return {
    id: ref.id,
    chatId: init.chatId,
    name: init.name,
    instructions: init.instructions,
    everyMinutes: init.everyMinutes,
    nextRunAt: init.startAt,
    enabled: true,
  };
}

export async function setRoutineEnabled(uid: string, id: string, enabled: boolean) {
  await updateDoc(doc(db, "users", uid, "routines", id), { enabled });
}

export async function recordManualRun(
  uid: string,
  id: string,
  result: string
) {
  await updateDoc(doc(db, "users", uid, "routines", id), {
    lastRunAt: Date.now(),
    lastResult: result.slice(0, 200),
  });
}

export async function deleteRoutine(uid: string, id: string) {
  await deleteDoc(doc(db, "users", uid, "routines", id));
}