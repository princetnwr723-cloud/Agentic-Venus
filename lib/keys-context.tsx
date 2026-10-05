"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import type { ProviderId } from "@/lib/providers";

// Both fields are vault placeholders ("vault:cred.site.e"), never the real login.
export type SavedLogin = { email: string; password: string };

type KeysState = {
  apiKeys: Partial<Record<ProviderId, string>>;
  e2bKey: string | null;
  pcSandboxId: string | null;
  pcCredentials: Record<string, SavedLogin>;
  loading: boolean;
  saveProviderKey: (provider: ProviderId, key: string) => Promise<void>;
  saveE2bKey: (key: string) => Promise<void>;
  savePcSandboxId: (sandboxId: string | null) => Promise<void>;
  savePcCredential: (siteKey: string, login: SavedLogin) => Promise<void>;
};

const KeysContext = createContext<KeysState>({
  apiKeys: {}, e2bKey: null, pcSandboxId: null, pcCredentials: {}, loading: true,
  saveProviderKey: async () => {}, saveE2bKey: async () => {}, savePcSandboxId: async () => {}, savePcCredential: async () => {},
});

type UserDoc = {
  apiKeys?: Partial<Record<ProviderId, string>>;
  e2bKey?: string;
  pcSandboxId?: string;
  pcCredentials?: Record<string, SavedLogin>;
};

const isPh = (v: unknown) => typeof v === "string" && v.startsWith("vault:");
const needsMigration = (d?: UserDoc) =>
  Boolean(d && (
    Object.values(d.apiKeys ?? {}).some((v) => v && !isPh(v)) ||
    (d.e2bKey && !isPh(d.e2bKey)) ||
    Object.values(d.pcCredentials ?? {}).some((c) => c && (!isPh(c.email) || !isPh(c.password)))
  ));

async function vault(body: Record<string, unknown>) {
  const res = await fetch("/api/vault", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(d?.error || "Could not save the secret.");
  return d;
}

export function KeysProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [apiKeys, setApiKeys] = useState<Partial<Record<ProviderId, string>>>({});
  const [e2bKey, setE2bKey] = useState<string | null>(null);
  const [pcSandboxId, setPcSandboxId] = useState<string | null>(null);
  const [pcCredentials, setPcCredentials] = useState<Record<string, SavedLogin>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setApiKeys({}); setE2bKey(null); setPcSandboxId(null); setPcCredentials({}); setLoading(false);
      return;
    }
    let alive = true;
    setLoading(true);
    const read = async () => (await getDoc(doc(db, "users", user.uid))).data() as UserDoc | undefined;
    (async () => {
      let d = await read();
      // One-time, idempotent: encrypt anything that is still stored in plain text.
      const flag = `av:vault:${user.uid}`;
      if (needsMigration(d) || !localStorage.getItem(flag)) {
        try { await vault({ action: "migrate" }); localStorage.setItem(flag, "1"); d = await read(); }
        catch { /* VAULT_KEY not set yet: keep working with the old values */ }
      }
      if (!alive) return;
      setApiKeys(d?.apiKeys ?? {});
      setE2bKey(d?.e2bKey ?? null);
      setPcSandboxId(d?.pcSandboxId ?? null);
      setPcCredentials(d?.pcCredentials ?? {});
      setLoading(false);
    })().catch(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [user]);

  async function saveProviderKey(provider: ProviderId, key: string) {
    if (!user) return;
    const d = await vault({ action: "set", name: `provider.${provider}`, value: key });
    setApiKeys((prev) => ({ ...prev, [provider]: d.placeholder as string }));
  }

  async function saveE2bKey(key: string) {
    if (!user) return;
    const d = await vault({ action: "set", name: "e2b", value: key });
    setE2bKey(d.placeholder as string);
  }

  // Not a secret, and the only field the Firestore rules let the browser write on your user document.
  async function savePcSandboxId(sandboxId: string | null) {
    if (!user) return;
    setPcSandboxId(sandboxId);
    await setDoc(doc(db, "users", user.uid), { pcSandboxId: sandboxId }, { merge: true });
  }

  async function savePcCredential(siteKey: string, login: SavedLogin) {
    if (!user || !siteKey) return;
    const d = await vault({ action: "saveCredential", site: siteKey, email: login.email, password: login.password });
    setPcCredentials((prev) => ({ ...prev, [siteKey]: { email: d.email as string, password: d.password as string } }));
  }

  return (
    <KeysContext.Provider value={{ apiKeys, e2bKey, pcSandboxId, pcCredentials, loading, saveProviderKey, saveE2bKey, savePcSandboxId, savePcCredential }}>
      {children}
    </KeysContext.Provider>
  );
}

export function useKeys() {
  return useContext(KeysContext);
}
