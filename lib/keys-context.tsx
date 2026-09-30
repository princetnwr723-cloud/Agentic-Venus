"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import type { ProviderId } from "@/lib/providers";

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
  apiKeys: {},
  e2bKey: null,
  pcSandboxId: null,
  pcCredentials: {},
  loading: true,
  saveProviderKey: async () => {},
  saveE2bKey: async () => {},
  savePcSandboxId: async () => {},
  savePcCredential: async () => {},
});

export function KeysProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [apiKeys, setApiKeys] = useState<Partial<Record<ProviderId, string>>>({});
  const [e2bKey, setE2bKey] = useState<string | null>(null);
  const [pcSandboxId, setPcSandboxId] = useState<string | null>(null);
  const [pcCredentials, setPcCredentials] = useState<Record<string, SavedLogin>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setApiKeys({});
      setE2bKey(null);
      setPcSandboxId(null);
      setPcCredentials({});
      setLoading(false);
      return;
    }
    setLoading(true);
    getDoc(doc(db, "users", user.uid)).then((snap) => {
      const data = snap.data() as
        | {
            apiKeys?: Partial<Record<ProviderId, string>>;
            e2bKey?: string;
            pcSandboxId?: string;
            pcCredentials?: Record<string, SavedLogin>;
          }
        | undefined;
      setApiKeys(data?.apiKeys ?? {});
      setE2bKey(data?.e2bKey ?? null);
      setPcSandboxId(data?.pcSandboxId ?? null);
      setPcCredentials(data?.pcCredentials ?? {});
      setLoading(false);
    });
  }, [user]);

  async function saveProviderKey(provider: ProviderId, key: string) {
    if (!user) return;
    const next = { ...apiKeys, [provider]: key };
    setApiKeys(next);
    await setDoc(doc(db, "users", user.uid), { apiKeys: next }, { merge: true });
  }

  async function saveE2bKey(key: string) {
    if (!user) return;
    setE2bKey(key);
    await setDoc(doc(db, "users", user.uid), { e2bKey: key }, { merge: true });
  }

  async function savePcSandboxId(sandboxId: string | null) {
    if (!user) return;
    setPcSandboxId(sandboxId);
    await setDoc(doc(db, "users", user.uid), { pcSandboxId: sandboxId }, { merge: true });
  }

  async function savePcCredential(siteKey: string, login: SavedLogin) {
    if (!user || !siteKey) return;
    const next = { ...pcCredentials, [siteKey]: login };
    setPcCredentials(next);
    await setDoc(doc(db, "users", user.uid), { pcCredentials: next }, { merge: true });
  }

  return (
    <KeysContext.Provider
      value={{
        apiKeys,
        e2bKey,
        pcSandboxId,
        pcCredentials,
        loading,
        saveProviderKey,
        saveE2bKey,
        savePcSandboxId,
        savePcCredential,
      }}
    >
      {children}
    </KeysContext.Provider>
  );
}

export function useKeys() {
  return useContext(KeysContext);
}