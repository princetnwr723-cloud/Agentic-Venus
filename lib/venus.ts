import { collection, deleteDoc, doc, getDoc, getDocs, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { Aspect } from "@/lib/venus-schema";
import type { ProviderId } from "@/lib/providers";

export type Stage = "studio" | "script" | "design" | "assets" | "voice" | "preview" | "review" | "final" | "done";

export type VenusProject = {
  id: string;
  title: string;
  brief: string;
  seconds: number;
  aspect: Aspect;
  theme: string;
  voice: boolean;
  voiceName: string;
  captions: boolean;
  quality: "720p" | "1080p";
  review: boolean;
  design?: "ai" | "library";
  music?: boolean;
  origin?: "venus" | "chat";
  provider: ProviderId;
  model: string;
  stage: Stage;
  status: "idle" | "running" | "done" | "error";
  error?: string;
  storyboardJson?: string;
  previewPath?: string;
  finalPath?: string;
  createdAt: number;
  updatedAt: number;
};

export async function listProjects(uid: string): Promise<VenusProject[]> {
  const snap = await getDocs(collection(db, "users", uid, "venusProjects"));
  return snap.docs.map((d) => d.data() as VenusProject).sort((a, b) => b.createdAt - a.createdAt);
}

export async function saveProject(uid: string, p: VenusProject) {
  const clean = JSON.parse(JSON.stringify(p)) as VenusProject;
  await setDoc(doc(db, "users", uid, "venusProjects", p.id), clean);
}

export async function deleteProject(uid: string, id: string) {
  await deleteDoc(doc(db, "users", uid, "venusProjects", id));
}

export async function getStudio(uid: string): Promise<{ sandboxId?: string } | null> {
  const snap = await getDoc(doc(db, "users", uid, "venusStudio", "main"));
  return snap.exists() ? (snap.data() as { sandboxId?: string }) : null;
}

export async function saveStudio(uid: string, data: { sandboxId: string | null }) {
  await setDoc(doc(db, "users", uid, "venusStudio", "main"), data, { merge: true });
}