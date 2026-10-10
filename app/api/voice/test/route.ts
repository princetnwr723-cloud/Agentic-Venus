import { NextResponse } from "next/server";
import { authFromRequest } from "@/lib/job-token";
import { getAdminDb } from "@/lib/firebase-admin";
import { resolveValue } from "@/lib/vault";
import { callProvider } from "@/lib/ai-providers-server";
import { providerMeta, PROVIDERS, type ProviderId } from "@/lib/providers";
import { getResolvedVoiceSecrets, voiceSafeError } from "@/lib/voice-server";
import { readBody, requestStatus } from "@/lib/request";

export const runtime = "nodejs";
export const maxDuration = 30;
const fail = (error: string, status = 400) => NextResponse.json({ ok: false, error }, { status });
export async function POST(req: Request) {
  try {
    const body = await readBody(req, { maxBytes: 8 * 1024 });
    const uid = body.uid as string;
    const kind = String(body.kind || "");
    if (kind === "openai-realtime") {
      const s = await getResolvedVoiceSecrets(uid);
      const key = s.openaiKey || await getExistingProviderKey(uid, "openai");
      if (!key) return fail("Connect an OpenAI API key first.");
      const r = await fetch("https://api.openai.com/v1/models", { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(12000) });
      if (!r.ok) return fail(r.status === 401 ? "OpenAI rejected this key." : `OpenAI test failed (HTTP ${r.status}).`, r.status === 401 ? 400 : 502);
      return NextResponse.json({ ok: true, label: "OpenAI API key accepted. Realtime access is checked when a voice session starts." });
    }
    if (kind === "phone") {
      const { twilioSid, twilioToken } = await getResolvedVoiceSecrets(uid);
      if (!twilioSid || !twilioToken) return fail("Save the Twilio Account SID and Auth Token first.");
      const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(twilioSid)}.json`, {
        headers: { Authorization: `Basic ${Buffer.from(`${twilioSid}:${twilioToken}`).toString("base64")}` }, signal: AbortSignal.timeout(12000),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) return fail(r.status === 401 ? "Twilio rejected these credentials." : String(d.message || `Twilio test failed (HTTP ${r.status}).`), r.status === 401 ? 400 : 502);
      return NextResponse.json({ ok: true, label: `Twilio connected${d.friendly_name ? `: ${d.friendly_name}` : ""}.` });
    }
    if (kind === "llm") {
      const provider = String(body.provider || "") as ProviderId;
      if (!PROVIDERS.some(p => p.id === provider)) return fail("Unsupported AI provider.");
      const key = provider === "openai" ? ((await getResolvedVoiceSecrets(uid)).providerKey || await getExistingProviderKey(uid, provider)) : await getExistingProviderKey(uid, provider);
      if (!key) return fail(`Add your ${providerMeta(provider).label} key in API keys settings first.`);
      const model = String(body.model || providerMeta(provider).models[0] || "").slice(0, 120);
      const answer = await callProvider({ provider, apiKey: key, model, maxTokens: 16, messages: [{ role: "user", content: "Reply with exactly: VOICE_OK" }] });
      return NextResponse.json({ ok: true, label: `${providerMeta(provider).label} responded successfully.`, sample: answer.slice(0, 80) });
    }
    return fail("Unknown connection test.");
  } catch (e) { return fail(voiceSafeError(e), requestStatus(e)); }
}
async function getExistingProviderKey(uid: string, provider: ProviderId): Promise<string | null> {
  const snap = await getAdminDb().collection("users").doc(uid).get();
  const raw = (snap.data() as { apiKeys?: Partial<Record<ProviderId, string>> } | undefined)?.apiKeys?.[provider];
  if (!raw) return null;
  return resolveValue(uid, raw);
}
