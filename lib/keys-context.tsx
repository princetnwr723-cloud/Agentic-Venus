"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import type { ProviderId } from "@/lib/providers";

type KeysState = {
  apiKeys: Partial<Record<ProviderId, string>>;
  daytonaKey: string | null;
  loading: boolean;
  saveProviderKey: (provider: ProviderId, key: string) => Promise<void>;
  saveDaytonaKey: (key: string) => Promise<void>;
};

const KeysContext = createContext<KeysState>({
  apiKeys: {},
  daytonaKey: null,
  loading: true,
  saveProviderKey: async () => {},
  saveDaytonaKey: async () => {},
});

export function KeysProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [apiKeys, setApiKeys] = useState<Partial<Record<ProviderId, string>>>({});
  const [daytonaKey, setDaytonaKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setApiKeys({});
      setDaytonaKey(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    getDoc(doc(db, "users", user.uid)).then((snap) => {
      const data = snap.data() as
        | { apiKeys?: Partial<Record<ProviderId, string>>; daytonaKey?: string }
        | undefined;
      setApiKeys(data?.apiKeys ?? {});
      setDaytonaKey(data?.daytonaKey ?? null);
      setLoading(false);
    });
  }, [user]);

  async function saveProviderKey(provider: ProviderId, key: string) {
    if (!user) return;
    const next = { ...apiKeys, [provider]: key };
    setApiKeys(next);
    await setDoc(doc(db, "users", user.uid), { apiKeys: next }, { merge: true });
  }

  async function saveDaytonaKey(key: string) {
    if (!user) return;
    setDaytonaKey(key);
    await setDoc(doc(db, "users", user.uid), { daytonaKey: key }, { merge: true });
  }

  return (
    <KeysContext.Provider
      value={{ apiKeys, daytonaKey, loading, saveProviderKey, saveDaytonaKey }}
    >
      {children}
    </KeysContext.Provider>
  );
}

export function useKeys() {
  return useContext(KeysContext);
}