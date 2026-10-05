// Server-only. Secrets are encrypted with AES-256-GCM. The ciphertext is bound to (uid, name),
// so it can't be swapped between users or slots. The browser only ever holds "vault:..." placeholders.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";
import { getAdminDb } from "@/lib/firebase-admin";

const NAME_RE = /^[a-z0-9._:-]{1,90}$/;
const PLACEHOLDER_RE = /^vault:([a-z0-9._:-]{1,90})(?:#([A-Za-z0-9]{0,8}))?$/;

function masterKey(): Buffer {
  const b64 = process.env.VAULT_KEY;
  if (!b64) throw new Error("VAULT_KEY is not set on the server. Generate one: openssl rand -base64 32");
  const k = Buffer.from(b64, "base64");
  if (k.length !== 32) throw new Error("VAULT_KEY must decode to exactly 32 bytes.");
  return k;
}
const docId = (uid: string, name: string) => createHash("sha256").update(`${uid}:${name}`).digest("hex").slice(0, 40);
const aad = (uid: string, name: string) => Buffer.from(`${uid}:${name}`);
const col = (uid: string) => getAdminDb().collection("users").doc(uid).collection("vault");

export const isPlaceholder = (v: unknown): v is string => typeof v === "string" && PLACEHOLDER_RE.test(v);

export async function vaultPut(uid: string, name: string, value: string, withHint = false): Promise<string> {
  if (!NAME_RE.test(name)) throw new Error("Bad secret name.");
  if (!value) throw new Error("Empty secret.");
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", masterKey(), iv);
  c.setAAD(aad(uid, name));
  const ct = Buffer.concat([c.update(value, "utf8"), c.final()]);
  await col(uid).doc(docId(uid, name)).set({
    name, v: 1, iv: iv.toString("base64"), ct: ct.toString("base64"), tag: c.getAuthTag().toString("base64"), at: Date.now(),
  });
  const hint = withHint ? value.replace(/[^A-Za-z0-9]/g, "").slice(-4) : "";
  return `vault:${name}${hint ? "#" + hint : ""}`;
}

export async function vaultGet(uid: string, name: string): Promise<string | null> {
  const snap = await col(uid).doc(docId(uid, name)).get();
  if (!snap.exists) return null;
  const d = snap.data() as { iv: string; ct: string; tag: string };
  const dec = createDecipheriv("aes-256-gcm", masterKey(), Buffer.from(d.iv, "base64"));
  dec.setAAD(aad(uid, name));
  dec.setAuthTag(Buffer.from(d.tag, "base64"));
  return Buffer.concat([dec.update(Buffer.from(d.ct, "base64")), dec.final()]).toString("utf8");
}

export async function vaultDelete(uid: string, name: string) {
  await col(uid).doc(docId(uid, name)).delete().catch(() => {});
}

/** "vault:x" -> the real secret. Anything else is returned unchanged. */
export async function resolveValue(uid: string, v: string): Promise<string> {
  const m = PLACEHOLDER_RE.exec(v);
  if (!m) return v;
  const plain = await vaultGet(uid, m[1]);
  if (plain === null) throw new Error(`A saved secret is missing (${m[1]}). Please enter it again in Settings.`);
  return plain;
}

// Only these fields may hold placeholders. This stops a web page or a chat message that happens
// to contain the text "vault:..." from ever being swapped for a real secret.
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
