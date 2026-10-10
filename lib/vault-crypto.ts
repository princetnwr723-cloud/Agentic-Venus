// Pure crypto helpers for the vault (no database, no Next.js). Kept separate so they can be unit-tested.
// AES-256-GCM. The ciphertext is bound to (uid, name) through the AAD, so it cannot be moved to another user or slot.
import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from "crypto";

export type Sealed = { iv: string; ct: string; tag: string };
export type KeyEnv = {
  VAULT_KEY?: string;
  /** Previous VAULT_KEY value(s), comma separated. Only used to OPEN old secrets (they are re-encrypted with VAULT_KEY on first read). */
  VAULT_KEY_OLD?: string;
  ROUTINE_RUNNER_SECRET?: string;
  NODE_ENV?: string;
  ALLOW_DERIVED_VAULT_KEY?: string;
};

export type KeyRing = {
  /** Key used for new secrets. */
  primary: Buffer;
  /** Every key that may open old secrets: [VAULT_KEY?, ...VAULT_KEY_OLD, derived-from-ROUTINE_RUNNER_SECRET?]. */
  all: Buffer[];
  /** True when there is NO dedicated VAULT_KEY and the key is derived from ROUTINE_RUNNER_SECRET. */
  derivedOnly: boolean;
};

function parseKey(raw: string, label: string): Buffer {
  const k = Buffer.from(raw.trim(), "base64");
  if (k.length !== 32) {
    throw new Error(`${label} must be a base64 string of exactly 32 bytes. Open /setup in the app to generate a valid one.`);
  }
  return k;
}

export function loadKeys(env: KeyEnv = process.env as KeyEnv): KeyRing {
  const all: Buffer[] = [];
  let dedicated = false;

  const raw = env.VAULT_KEY?.trim();
  if (raw) {
    all.push(parseKey(raw, "VAULT_KEY"));
    dedicated = true;
  }

  // Older VAULT_KEY values: they can only open secrets, never write new ones.
  for (const part of (env.VAULT_KEY_OLD ?? "").split(",")) {
    const p = part.trim();
    if (!p) continue;
    const k = parseKey(p, "VAULT_KEY_OLD");
    if (!all.some((x) => x.equals(k))) all.push(k);
  }

  const s = env.ROUTINE_RUNNER_SECRET;
  if (s) all.push(Buffer.from(hkdfSync("sha256", s, "agenticvenus-vault-salt", "agenticvenus-vault-v1", 32)));

  if (!all.length) throw new Error("No encryption key is available. Set VAULT_KEY (generate one at /setup).");
  return { primary: all[0], all, derivedOnly: !dedicated };
}

/** The key for NEW secrets. In production a dedicated VAULT_KEY is required (unless ALLOW_DERIVED_VAULT_KEY=1). */
export function writeKey(env: KeyEnv = process.env as KeyEnv): Buffer {
  const ring = loadKeys(env);
  if (ring.derivedOnly && env.NODE_ENV === "production" && env.ALLOW_DERIVED_VAULT_KEY !== "1") {
    throw new Error("VAULT_KEY is required in production, so the vault key is not the same secret as the cron secret. Generate one at /setup and add it as VAULT_KEY.");
  }
  return ring.primary;
}

export const aadOf = (uid: string, name: string) => Buffer.from(`${uid}:${name}`);
export const docIdOf = (uid: string, name: string) => createHash("sha256").update(`${uid}:${name}`).digest("hex").slice(0, 40);

export function seal(plain: string, uid: string, name: string, key: Buffer): Sealed {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  c.setAAD(aadOf(uid, name));
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return { iv: iv.toString("base64"), ct: ct.toString("base64"), tag: c.getAuthTag().toString("base64") };
}

/** Tries every key. Returns the text and the index of the key that worked (0 = primary). Throws if none works. */
export function unseal(s: Sealed, uid: string, name: string, keys: Buffer[]): { plain: string; keyIndex: number } {
  for (let i = 0; i < keys.length; i++) {
    try {
      const d = createDecipheriv("aes-256-gcm", keys[i], Buffer.from(s.iv, "base64"));
      d.setAAD(aadOf(uid, name));
      d.setAuthTag(Buffer.from(s.tag, "base64"));
      const plain = Buffer.concat([d.update(Buffer.from(s.ct, "base64")), d.final()]).toString("utf8");
      return { plain, keyIndex: i };
    } catch { /* try the next key */ }
  }
  throw new Error("A saved secret could not be decrypted: the server key changed. Enter that secret again.");
}