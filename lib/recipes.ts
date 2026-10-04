import { collection, deleteDoc, doc, getDocs, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { bm25 } from "@/lib/bm25";

type Target = { label: string; tag?: string; nth?: number };
export type LabeledOp =
  | ({ op: "click_label" } & Target)
  | ({ op: "type_label"; text: string } & Target)
  | ({ op: "secret_label"; field: "email" | "password" } & Target)
  | { op: "press"; key: string }
  | { op: "scroll"; dir?: "up" | "down" }
  | { op: "wait"; ms?: number };
export type RecipeStep = { url?: string; ops: LabeledOp[] };
export type Recipe = {
  id: string; name: string; task: string; site: string; steps: RecipeStep[];
  createdAt: number; runs: number; fails: number; lastOk?: number;
};

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "recipe";
const col = (uid: string) => collection(db, "users", uid, "recipes");

type El = { id: number; tag: string; label: string };

/** Reads the numbered element list out of a browse snapshot. */
export function parseElements(snapshot: string): El[] {
  const start = snapshot.indexOf("ELEMENTS");
  const end = snapshot.indexOf("PAGE TEXT:");
  const block = start >= 0 ? snapshot.slice(start, end > start ? end : undefined) : snapshot;
  const out: El[] = [];
  for (const line of block.split("\n")) {
    const m = /^\[(\d+)\] ([a-z0-9]+)(?:\([^)]*\))? "([^"]*)"/.exec(line);
    if (m) out.push({ id: Number(m[1]), tag: m[2], label: m[3] });
  }
  return out;
}

/** Turns the agent's numbered ops into label-based ops. Returns null if any op can't be made stable. */
export function labelOps(ops: unknown[], prevSnapshot: string): LabeledOp[] | null {
  const els = parseElements(prevSnapshot);
  const out: LabeledOp[] = [];
  for (const raw of ops) {
    const o = raw as Record<string, unknown>;
    if (o.op === "press") { out.push({ op: "press", key: String(o.key ?? "Enter") }); continue; }
    if (o.op === "scroll") { out.push({ op: "scroll", dir: o.dir === "up" ? "up" : "down" }); continue; }
    if (o.op === "wait") { out.push({ op: "wait", ms: Number(o.ms) || 1000 }); continue; }
    if (o.op !== "click" && o.op !== "type" && o.op !== "secret") return null;
    const el = els.find((e) => e.id === Number(o.id));
    if (!el || !el.label) return null;
    const nth = els.filter((e) => e.label === el.label && e.tag === el.tag).findIndex((e) => e.id === el.id);
    const t = { label: el.label, tag: el.tag, nth: Math.max(0, nth) };
    if (o.op === "click") out.push({ op: "click_label", ...t });
    else if (o.op === "type") out.push({ op: "type_label", text: String(o.text ?? ""), ...t });
    else out.push({ op: "secret_label", field: o.field === "password" ? "password" : "email", ...t });
  }
  return out;
}

export async function saveRecipe(uid: string, r: { name: string; task: string; site: string; steps: RecipeStep[] }) {
  const id = slug(r.name); // same name = overwrite = the recipe "re-learns" itself
  const recipe: Recipe = { id, ...r, createdAt: Date.now(), runs: 0, fails: 0 };
  await setDoc(doc(col(uid), id), JSON.parse(JSON.stringify(recipe)));
  return recipe;
}
export async function listRecipes(uid: string): Promise<Recipe[]> {
  const snap = await getDocs(col(uid));
  return snap.docs.map((d) => d.data() as Recipe).sort((a, b) => b.createdAt - a.createdAt);
}
export async function markRecipe(uid: string, r: Recipe, ok: boolean) {
  await setDoc(doc(col(uid), r.id), { runs: r.runs + 1, fails: r.fails + (ok ? 0 : 1), ...(ok ? { lastOk: Date.now() } : {}) }, { merge: true });
}
export async function deleteRecipe(uid: string, id: string) { await deleteDoc(doc(col(uid), id)); }
export const matchRecipes = (list: Recipe[], text: string) => bm25(list, (r) => `${r.name} ${r.task}`, text).map((x) => x.doc);

/** Replays a recipe through /api/browser with NO AI model. Stops at the first failed op. */
export async function replayRecipe(a: {
  token: () => Promise<string>; uid: string; recipe: Recipe;
  creds?: { email?: string; password?: string }; onLine?: (l: string) => void;
}): Promise<{ ok: boolean; snapshot: string; failedAt?: number }> {
  let session: unknown = null;
  let snapshot = "";
  const n = a.recipe.steps.length;
  for (let i = 0; i < n; i++) {
    const step = a.recipe.steps[i];
    const res = await fetch("/api/browser", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + (await a.token()) },
      body: JSON.stringify({ uid: a.uid, url: step.url, ops: step.ops, session, creds: a.creds }),
    });
    const d = await res.json().catch(() => ({ error: "Bad response" }));
    if (!res.ok || d.error) return { ok: false, snapshot: String(d.error ?? ""), failedAt: i };
    session = d.session;
    snapshot = String(d.snapshot);
    if (/^FAILED /m.test(snapshot)) return { ok: false, snapshot, failedAt: i };
    a.onLine?.(`recipe step ${i + 1}/${n} ✓`);
  }
  return { ok: true, snapshot };
}