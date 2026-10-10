import { getAdminDb } from "@/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { callProvider, type ChatMsg } from "@/lib/ai-providers-server";
import { getVoiceSettings, getResolvedVoiceSecrets, verifyVoiceToken, verifyTwilioSignature, appBaseUrl, gatherXml, hangupXml, sayTag, twimlResponse } from "@/lib/voice-server";
import { loadAgent, parseSpoken, speechXml, voicePrompt, type CallDoc } from "@/lib/voice-calls";
import { buildCatalog, callTool } from "@/lib/tools/registry";
import { makeCtx } from "@/lib/tools/connectors";
import { extractToolCalls, toolPrompt } from "@/lib/tools/prompt";
import type { ToolResult, ToolSpec } from "@/lib/tools/types";
import { audit } from "@/lib/audit";

export const runtime = "nodejs";
export const maxDuration = 25;

// The tool list (MCP servers can be slow) is cached for a few minutes so a turn stays fast.
const catCache = new Map<string, { t: number; specs: ToolSpec[] }>();
async function readSpecs(key: string, connectors: Record<string, string>): Promise<ToolSpec[]> {
  const hit = catCache.get(key);
  if (hit && Date.now() - hit.t < 5 * 60_000) return hit.specs;
  const specs = await Promise.race([
    buildCatalog(connectors).then((c) => c.specs),
    new Promise<ToolSpec[]>((res) => setTimeout(() => res([]), 3000)),
  ]);
  const onCall = specs.filter((s) => s.risk === "read" && !s.name.startsWith("voice.call") && !s.name.startsWith("identity."));
  if (onCall.length) catCache.set(key, { t: Date.now(), specs: onCall });
  return onCall;
}

export async function POST(req: Request) {
  const t0 = Date.now();
  const token = new URL(req.url).searchParams.get("token") || "";
  const claims = verifyVoiceToken(token);
  let language = "en-US";
  let nextAction = "";
  try {
    if (!claims || claims.purpose !== "call" || !claims.callId) return twimlResponse(`<?xml version="1.0" encoding="UTF-8"?><Response>${sayTag("Invalid session.", "en-US")}<Hangup/></Response>`, 403);
    const uid = claims.uid;
    const form = await req.formData();
    const sec = await getResolvedVoiceSecrets(uid);
    if (!sec.twilioToken || !verifyTwilioSignature(req, sec.twilioToken, form)) return twimlResponse(`<?xml version="1.0" encoding="UTF-8"?><Response>${sayTag("Webhook signature is invalid.", "en-US")}<Hangup/></Response>`, 403);

    const speech = String(form.get("SpeechResult") || "").trim().slice(0, 2000);
    const callSid = String(form.get("CallSid") || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 80);
    const callRef = getAdminDb().collection("users").doc(uid).collection("voiceCalls").doc(claims.callId);
    const snap = await callRef.get();
    const call = (snap.data() ?? {}) as CallDoc & { providerCallId?: string };
    if (!snap.exists || (callSid && call.providerCallId && call.providerCallId !== callSid)) return twimlResponse(`<?xml version="1.0" encoding="UTF-8"?><Response>${sayTag("Call session not found.", "en-US")}<Hangup/></Response>`, 404);

    const settings = sec.settings;
    language = settings.language ?? "en-US";
    const base = appBaseUrl(req);
    nextAction = `${base}/api/voice/turn?token=${encodeURIComponent(token)}`;
    if (!speech) return twimlResponse(gatherXml(sayTag("Sorry, I did not catch that. Please say it again.", language), language, nextAction));

    // The call is answered by one of YOUR chats: its model, role, memory and connected tools.
    const agent = await loadAgent(uid, call.chatId);
    const specs = await readSpecs(`${uid}:${agent.chatId}:${Object.keys(agent.connectors).sort().join(",")}`, agent.connectors);
    const system = (await voicePrompt(uid, agent, call, settings)) + toolPrompt(specs);
    const history = (call.history ?? []).slice(-8);
    const messages: ChatMsg[] = [{ role: "system", content: system }, ...history, { role: "user", content: speech }];
    const ask = (m: ChatMsg[]) => callProvider({ provider: agent.provider, apiKey: agent.apiKey, model: agent.model, messages: m, maxTokens: 350 });

    let reply = (await ask(messages)).trim();
    const tc = extractToolCalls(reply);
    if (tc.calls.length && Date.now() - t0 < 7000) {
      const ctx = makeCtx(uid, agent.chatId);
      const results: string[] = [];
      for (const c of tc.calls.slice(0, 2)) {
        const spec = specs.find((x) => x.name === c.name);
        if (!spec) { results.push(`### ${c.name}\nThis tool is not available on a phone call.`); continue; }
        const r = await Promise.race([
          callTool(agent.connectors, c.name, c.args, false, { ctx }),
          new Promise<ToolResult>((res) => setTimeout(() => res({ ok: false, text: "The tool took too long." }), 4000)),
        ]);
        results.push(`### ${c.name}\n${r.text.slice(0, 1800)}`);
      }
      reply = (await ask([...messages, { role: "assistant", content: reply }, { role: "user", content: `TOOL RESULTS:\n${results.join("\n\n")}\n\nNow answer the caller in 1-3 short spoken sentences.` }])).trim();
    }

    const sp = parseSpoken(extractToolCalls(reply).clean || reply);
    await callRef.set({
      history: [...history, { role: "user", content: speech }, { role: "assistant", content: sp.say }].slice(-10),
      transcript: FieldValue.arrayUnion({ role: "user", text: speech.slice(0, 600), at: Date.now() }, { role: "assistant", text: sp.say, at: Date.now() + 1 }),
      ...(sp.todos.length ? { followUps: FieldValue.arrayUnion(...sp.todos) } : {}),
      updatedAt: Date.now(),
    }, { merge: true });
    await audit(uid, { kind: "voice_turn", chatId: agent.chatId, text: `Call ${claims.callId}: ${agent.provider} handled a turn` });

    const inner = await speechXml(uid, base, sp.say, settings);
    return twimlResponse(sp.hangup ? hangupXml(inner) : gatherXml(inner, language, nextAction));
  } catch {
    // never leave the caller in silence
    const action = nextAction || `${new URL(req.url).origin}/api/voice/turn?token=${encodeURIComponent(token)}`;
    return twimlResponse(gatherXml(sayTag("Sorry, I had a small problem. Could you say that again?", language), language, action), 200);
  }
}