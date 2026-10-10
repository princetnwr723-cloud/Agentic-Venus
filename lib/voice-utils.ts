import { getAdminDb } from "@/lib/firebase-admin";
import { resolveValue } from "@/lib/vault";
import type { ProviderId } from "@/lib/providers";
import { getVoiceSettings } from "@/lib/voice-server";
export async function getExistingOpenAIKey(uid: string): Promise<string | null> {
  const s = await getVoiceSettings(uid);
  if (s.openaiKey) return resolveValue(uid, s.openaiKey);
  const snap = await getAdminDb().collection("users").doc(uid).get();
  const raw = (snap.data() as { apiKeys?: Partial<Record<ProviderId, string>> } | undefined)?.apiKeys?.openai;
  return raw ? resolveValue(uid, raw) : null;
}
