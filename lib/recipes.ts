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

export type BrowseStep = { kind?: "browse"; url?: string; ops: LabeledOp[] };
export type ToolStep = { kind: "tool"; name: string; args: Record<string, unknown> };
export type ShellStep = { kind: "shell"; command: string };
export type RecipeStep = BrowseStep | ToolStep | ShellStep;

export type Recipe = {
  id: string; name: string; task: string; site: string; steps: RecipeStep[];
  createdAt: number; runs: number; fails: number; lastOk?: number;
};

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "recipe";
const col = (uid: string) => collection(db, "users", uid, "recipes");

type El = { id: number; tag: string; label: string };

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

export function describeStep(s: RecipeStep): string {
  if (s.kind === "tool") return `use tool ${s.name}`;
  if (s.kind === "shell") return `run \`${s.command.slice(0, 60)}\``;
  const bits = s.ops.map((o) =>
    o.op === "click_label" ? `click "${o.label}"` : o.op === "type_label" ? `type into "${o.label}"` :
    o.op === "secret_label" ? `fill ${o.field} in "${o.label}"` : o.op === "press" ? `press ${o.key}` : o.op);
  return `${s.url ? `open ${s.url}, ` : ""}${bits.join(", ") || "look at the page"}`;
}

export async function saveRecipe(uid: string, r: { name: string; task: string; site: string; steps: RecipeStep[] }) {
  const id = slug(r.name); // same name = overwrite = the recipe re-learns / heals itself
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

/** Replays a recipe with NO AI model: browser steps, tool calls and shell commands. Stops at the first failure. */
export async function replayRecipe(a: {
  token: () => Promise<string>; uid: string; chatId: string; connectors: Record<string, string>; recipe: Recipe;
  creds?: { email?: string; password?: string };
  shell?: (command: string) => Promise<{ ok: boolean; text: string }>;
  approve?: (summary: string) => Promise<boolean>;
  onLine?: (l: string) => void;
}): Promise<{ ok: boolean; snapshot: string; failedAt?: number; session: unknown; url: string }> {
  let session: unknown = null;
  let snapshot = "";
  const n = a.recipe.steps.length;
  const fail = (i: number, text: string) => ({ ok: false, snapshot: text || snapshot, failedAt: i, session, url: (session as { url?: string } | null)?.url ?? "" });

  for (let i = 0; i < n; i++) {
    const step = a.recipe.steps[i];
    const headers = { "Content-Type": "application/json", Authorization: "Bearer " + (await a.token()) };

    if (step.kind === "tool") {
      const call = async (approved: boolean) =>
        (await fetch("/api/tools", { method: "POST", headers, body: JSON.stringify({ action: "call", uid: a.uid, chatId: a.chatId, connectors: a.connectors, name: step.name, args: step.args, approved }) })).json().catch(() => ({ ok: false, text: "Bad response" }));
      let r = await call(false);
      if (r.needsApproval) {
        if (!a.approve || !(await a.approve(r.needsApproval.summary))) return fail(i, "You declined this action.");
        r = await call(true);
      }
      if (!r.ok) return fail(i, String(r.text ?? ""));
      snapshot = String(r.text ?? "");
    } else if (step.kind === "shell") {
      if (!a.shell) return fail(i, "This recipe needs the computer.");
      const r = await a.shell(step.command);
      if (!r.ok) return fail(i, r.text);
      snapshot = r.text;
    } else {
      const res = await fetch("/api/browser", { method: "POST", headers, body: JSON.stringify({ uid: a.uid, chatId: a.chatId, persistProfile: true, url: step.url, ops: step.ops, session, creds: a.creds }) });
      const d = await res.json().catch(() => ({ error: "Bad response" }));
      if (!res.ok || d.error) return fail(i, String(d.error ?? ""));
      session = d.session;
      snapshot = String(d.snapshot);
      if (/^FAILED /m.test(snapshot)) return fail(i, snapshot);
    }
    a.onLine?.(`recipe step ${i + 1}/${n} ✓`);
  }
  return { ok: true, snapshot, session, url: (session as { url?: string } | null)?.url ?? "" };
}
