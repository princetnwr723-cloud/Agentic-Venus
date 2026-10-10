// Server-only. Secrets are encrypted with AES-256-GCM. The ciphertext is bound to (uid, name),
// so it can't be swapped between users or slots. The browser only ever holds "vault:..." placeholders.
// Key: VAULT_KEY (required in production). Secrets saved earlier with a key derived from ROUTINE_RUNNER_SECRET
// still open, and are re-encrypted with VAULT_KEY the first time they are read.
import { getAdminDb } from "@/lib/firebase-admin";
import { docIdOf, loadKeys, seal, unseal, writeKey } from "@/lib/vault-crypto";

// "_" is allowed: connector names such as github_oauth or mcp:my_crm contain it.
const NAME_RE = /^[a-z0-9._:_-]{1,90}$/;
const PLACEHOLDER_RE = /^vault:([a-z0-9._:_-]{1,90})(?:#([A-Za-z0-9]{0,8}))?$/;

const col = (uid: string) => getAdminDb().collection("users").doc(uid).collection("vault");

// A plain boolean on purpose: as a type guard TypeScript narrows the negated branch to `never`.
export const isPlaceholder = (v: unknown): boolean => typeof v === "string" && PLACEHOLDER_RE.test(v);

async function store(uid: string, name: string, value: string) {
  const s = seal(value, uid, name, writeKey());
  await col(uid).doc(docIdOf(uid, name)).set({ name, v: 1, ...s, at: Date.now() });
}

export async function vaultPut(uid: string, name: string, value: string, withHint = false): Promise<string> {
  if (!NAME_RE.test(name)) throw new Error("Bad secret name.");
  if (!value) throw new Error("Empty secret.");
  await store(uid, name, value);
  const hint = withHint ? value.replace(/[^A-Za-z0-9]/g, "").slice(-4) : "";
  return `vault:${name}${hint ? "#" + hint : ""}`;
}

export async function vaultGet(uid: string, name: string): Promise<string | null> {
  const snap = await col(uid).doc(docIdOf(uid, name)).get();
  if (!snap.exists) return null;
  const d = snap.data() as { iv: string; ct: string; tag: string };
  const ring = loadKeys();
  const { plain, keyIndex } = unseal(d, uid, name, ring.all);
  // Opened with the old derived key while a dedicated VAULT_KEY exists: upgrade it quietly.
  if (keyIndex > 0 && !ring.derivedOnly) await store(uid, name, plain).catch(() => {});
  return plain;
}

export async function vaultDelete(uid: string, name: string) {
  await col(uid).doc(docIdOf(uid, name)).delete().catch(() => {});
}

/** "vault:x" -> the real secret. Anything else is returned unchanged. */
export async function resolveValue(uid: string, v: string): Promise<string> {
  const m = PLACEHOLDER_RE.exec(v);
  if (!m) return v;
  const plain = await vaultGet(uid, m[1]);
  if (plain === null) throw new Error(`A saved secret is missing (${m[1]}). Please enter it again in Settings.`);
  return plain;
}

// Only these fields may hold placeholders: a web page or chat message containing "vault:..." can never be swapped for a secret.
const SECRET_KEYS = new Set(["apiKey", "e2bKey", "vercelToken", "openaiKey", "password", "email", "token", "auth", "value"]);

async function walk(uid: string, v: unknown, key: string, parent: string, depth: number): Promise<unknown> {
  if (typeof v === "string") return (SECRET_KEYS.has(key) || parent === "connectors") && isPlaceholder(v) ? resolveValue(uid, v) : v;
  if (depth > 6 || v === null || typeof v !== "object") return v;
  if (Array.isArray(v)) return Promise.all(v.map((x) => walk(uid, x, key, parent, depth + 1)));
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) out[k] = await walk(uid, val, k, key, depth + 1);
  return out;
}
export const resolveDeep = <T,>(uid: string, v: T): Promise<T> => walk(uid, v, "", "", 0) as Promise<T>;