import { collection, deleteDoc, doc, getDoc, getDocs, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { Aspect, SourceInfo } from "@/lib/venus-schema";
import type { ProviderId } from "@/lib/providers";

export type Stage = "studio" | "ingest" | "script" | "design" | "assets" | "voice" | "preview" | "review" | "final" | "done";

/** Where the user's own video comes from (edit mode). The file lives in Supabase until the studio computer has it. */
export type SourceRef = { kind: "upload" | "url"; path?: string; url?: string; name?: string };

export type VenusProject = {
  id: string; title: string; brief: string; seconds: number; aspect: Aspect; theme: string;
  voice: boolean; voiceName: string; captions: boolean; quality: "720p" | "1080p"; review: boolean;
  design?: "ai" | "mixed" | "library"; music?: boolean; origin?: "venus" | "chat"; chatId?: string;
  /** "edit" = the user supplied a video and wants it edited; "make" (default) = built from scratch with motion graphics. */
  voiceMode?: "auto" | "on" | "off"; script?: boolean; mode?: "make" | "edit"; source?: SourceRef; sourceInfo?: SourceInfo; keepAll?: boolean; matchSource?: boolean;
  provider: ProviderId; model: string; stage: Stage; status: "idle" | "running" | "done" | "error";
  error?: string; storyboardJson?: string; previewPath?: string; finalPath?: string; createdAt: number; updatedAt: number;
  /** Set when the code of the designed scenes is kept in separate documents (long videos do not fit in one Firestore document). */
  codeChunks?: number;
};

const CHUNK_BYTES = 600_000;
const SPLIT_ABOVE = 500_000;

type Sb = { scenes?: Array<Record<string, unknown>> };

export async function listProjects(uid: string): Promise<VenusProject[]> {
  const snap = await getDocs(collection(db, "users", uid, "venusProjects"));
  return snap.docs.map((d) => d.data() as VenusProject).sort((a, b) => b.createdAt - a.createdAt);
}

async function readCodes(uid: string, pid: string, chunks: number): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (let i = 0; i < chunks; i++) {
    const snap = await getDoc(doc(db, "users", uid, "venusProjects", pid, "code", "c" + i)).catch(() => null);
    const d = snap && snap.exists() ? (snap.data() as { codes?: Record<string, string> }) : null;
    if (d?.codes) Object.assign(out, d.codes);
  }
  return out;
}

/** Puts the scene code back into a project whose code is stored in separate documents. */
export async function hydrateProject(uid: string, p: VenusProject): Promise<VenusProject> {
  if (!p.codeChunks || !p.storyboardJson) return p;
  try {
    const sb = JSON.parse(p.storyboardJson) as Sb;
    const need = (sb.scenes ?? []).some((s) => s.type === "custom" && !s.code);
    if (!need) return p;
    const codes = await readCodes(uid, p.id, p.codeChunks);
    for (const s of sb.scenes ?? []) if (s.type === "custom" && !s.code && typeof s.id === "string" && codes[s.id]) s.code = codes[s.id];
    return { ...p, storyboardJson: JSON.stringify(sb) };
  } catch { return p; }
}

export async function saveProject(uid: string, p: VenusProject) {
  const clean = JSON.parse(JSON.stringify(p)) as VenusProject;
  if (clean.storyboardJson && clean.storyboardJson.length > SPLIT_ABOVE) {
    try {
      const sb = JSON.parse(clean.storyboardJson) as Sb;
      const fresh: Record<string, string> = {};
      for (const s of sb.scenes ?? []) {
        if (s.type === "custom" && typeof s.code === "string" && s.code) { fresh[String(s.id)] = s.code; delete s.code; }
      }
      if (Object.keys(fresh).length > 0) {
        // merge with what is already stored (the browser may hold a copy without code), drop codes of deleted scenes
        const ids = new Set((sb.scenes ?? []).map((s) => String(s.id)));
        const old = clean.codeChunks ? await readCodes(uid, clean.id, clean.codeChunks) : {};
        const all: Record<string, string> = {};
        for (const [k, v] of Object.entries({ ...old, ...fresh })) if (ids.has(k)) all[k] = v;
        const chunks: Array<Record<string, string>> = [];
        let cur: Record<string, string> = {};
        let size = 0;
        for (const [k, v] of Object.entries(all)) {
          if (size + v.length > CHUNK_BYTES && Object.keys(cur).length) { chunks.push(cur); cur = {}; size = 0; }
          cur[k] = v; size += v.length + 40;
        }
        if (Object.keys(cur).length) chunks.push(cur);
        for (let i = 0; i < chunks.length; i++) await setDoc(doc(db, "users", uid, "venusProjects", clean.id, "code", "c" + i), { codes: chunks[i] });
        for (let i = chunks.length; i < (clean.codeChunks ?? 0); i++) await deleteDoc(doc(db, "users", uid, "venusProjects", clean.id, "code", "c" + i)).catch(() => {});
        clean.codeChunks = chunks.length;
      }
      clean.storyboardJson = JSON.stringify(sb);
    } catch { /* fall through: save as it is */ }
  }
  await setDoc(doc(db, "users", uid, "venusProjects", clean.id), clean);
}

export async function deleteProject(uid: string, id: string) {
  for (let i = 0; i < 40; i++) {
    const r = await getDoc(doc(db, "users", uid, "venusProjects", id, "code", "c" + i)).catch(() => null);
    if (!r || !r.exists()) break;
    await deleteDoc(doc(db, "users", uid, "venusProjects", id, "code", "c" + i)).catch(() => {});
  }
  await deleteDoc(doc(db, "users", uid, "venusProjects", id));
}
export async function getStudio(uid: string): Promise<{ sandboxId?: string } | null> {
  const snap = await getDoc(doc(db, "users", uid, "venusStudio", "main"));
  return snap.exists() ? (snap.data() as { sandboxId?: string }) : null;
}
export async function saveStudio(uid: string, data: { sandboxId: string | null }) {
  await setDoc(doc(db, "users", uid, "venusStudio", "main"), data, { merge: true });
}
