import { collection, addDoc, getDocs, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { AvatarColor } from "@/lib/bots";

export type CustomAgent = {
  id: string;
  name: string;
  color: AvatarColor;
};

function agentsCol(uid: string) {
  return collection(db, "users", uid, "agents");
}

export async function listCustomAgents(uid: string): Promise<CustomAgent[]> {
  const snap = await getDocs(agentsCol(uid));
  return snap.docs.map((d) => {
    const data = d.data() as { name: string; color: AvatarColor };
    return { id: d.id, name: data.name, color: data.color };
  });
}

export async function createCustomAgent(
  uid: string,
  name: string,
  color: AvatarColor
): Promise<CustomAgent> {
  const ref = await addDoc(agentsCol(uid), {
    name,
    color,
    createdAt: serverTimestamp(),
  });
  return { id: ref.id, name, color };
}