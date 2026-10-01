import type { ProviderId } from "@/lib/providers";

const KEY = "av:model";

export function getModelPref(): { provider: ProviderId; model: string } | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function setModelPref(provider: ProviderId, model: string) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ provider, model }));
  } catch {
    // ignore
  }
}