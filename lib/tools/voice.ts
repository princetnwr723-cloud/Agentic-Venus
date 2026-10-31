import { getAdminDb } from "@/lib/firebase-admin";
import { audit } from "@/lib/audit";
import { callingCodeOf, resolveLanguage, warmLocalVoice } from "@/lib/voice-local";
import { normalizePhone, placeOutboundCall } from "@/lib/voice-calls";
import { getExistingOpenAIKey } from "@/lib/voice-utils";
import { getResolvedVoiceSecrets, saveVoiceSettings, type VoiceSettings } from "@/lib/voice-server";
import { assignNumber, buyNumber, connectProvider, describeAccount, getTele, listNumbers, patchTele } from "@/lib/telephony";
import type { ToolCtx } from "./types";
import type { Def } from "./plugins";

const s = (v: unknown, n = 2000) => String(v ?? "").trim().slice(0, n);
const reqOf = (ctx?: ToolCtx) => (ctx?.baseUrl ? new Request(ctx.baseUrl) : undefined);

const VOICES = ["local", "twilio", "openai", "gemini", "elevenlabs", "deepgram"] as const;
const KEY_FIELD: Record<string, keyof VoiceSettings> = { openai: "openaiKey", gemini: "geminiKey", elevenlabs: "elevenLabsKey", deepgram: "deepgramKey" };
const VOICE_LABEL: Record<string, string> = { twilio: "free built-in voice", local: "local voice model (aapke cloud PC pe, free)", openai: "OpenAI voice", gemini: "Gemini voice", elevenlabs: "ElevenLabs voice", deepgram: "Deepgram voice" };

async function haveKey(uid: string, vp: string): Promise<boolean> {
  if (vp === "openai") return Boolean(await getExistingOpenAIKey(uid));
  const k = await getResolvedVoiceSecrets(uid);
  return Boolean(({ gemini: k.geminiKey, elevenlabs: k.elevenLabsKey, deepgram: k.deepgramKey } as Record<string, string | null>)[vp]);
}

/** What the agent must do next: it is shown after status / connect / settings so the setup always moves forward. */
async function nextStep(uid: string): Promise<string> {
  const st = await getTele(uid);
  const sec = await getResolvedVoiceSecrets(uid);
  if (!sec.twilioSid || !sec.twilioToken) return "NEXT: calling is not connected. ASK the owner which phone company they use (Twilio, SignalWire, or another TwiML-compatible one) and for the Account SID + Auth Token (for SignalWire also the Space name; for another company its API base URL). Then call voice.connect.";
  if (!st.ownerNumber) return "NEXT: ASK the owner for THEIR OWN phone number with country code (so you can phone them when work is done). Then call voice.settings with owner_number.";
  if (!st.voiceChosen) return "NEXT: ASK the owner which voice the agent should speak with: (1) local voice model on their cloud PC (free, any language), (2) a voice key from OpenAI / ElevenLabs / Gemini / Deepgram (ask which and for the key), or (3) the free built-in voice. Then call voice.settings with voice_provider (and voice_key).";
  if (!st.fromNumber) return "NEXT: the account has no phone number. Offer to buy one (voice.number_buy) after telling the owner it costs money from the provider balance.";
  return "SETUP COMPLETE. The owner can now say things like \"call +91... and tell them ...\" or \"do X and then call me\" from ANY chat.";
}

async function statusText(uid: string): Promise<string> {
  const st = await getTele(uid);
  const sec = await getResolvedVoiceSecrets(uid);
  const lines: string[] = [];
  if (sec.twilioSid && sec.twilioToken) {
    try { lines.push(await describeAccount(uid)); } catch (e) { lines.push(`⚠️ Account details nahi mile: ${e instanceof Error ? e.message : "error"}`); }
  } else lines.push("📞 Calling abhi connect nahi hai.");
  lines.push(`Owner number: ${st.ownerNumber || "(abhi nahi diya)"}`);
  lines.push(`Voice: ${st.voiceChosen ? VOICE_LABEL[st.ttsProvider ?? "twilio"] ?? st.ttsProvider : "(abhi chuna nahi)"} · language: ${st.language ?? "en-US"}`);
  lines.push(`Phone se aane wali call par caller-ID bharosa: ${st.trustCallerId ? "ON" : "OFF (safe)"}`);
  lines.push(await nextStep(uid));
  return lines.join("\n");
}

export const VOICE_TOOLS: Def[] = [
  {
    name: "voice.status", risk: "read", params: "",
    description: "START HERE whenever the owner talks about phone calls, calling setup, call limits, balance or numbers. Shows the connected phone company, account details, balance and limits, numbers, owner number and voice, and tells you the next setup step to ask the owner.",
    run: async (_a, _cred, ctx) => {
      if (!ctx) throw new Error("Not available here.");
      return statusText(ctx.uid);
    },
  },
  {
    name: "voice.connect", risk: "write", params: "provider:twilio|signalwire|custom, sid:string (Account SID / Project ID), token:string (Auth Token / API token), space?:string (SignalWire space name), api_base?:string (custom provider: https://host/api/laml/2010-04-01)",
    description: "Connect (or replace) the phone company for calling. One setup works in every chat. Verifies the credentials, picks a number, points it at this app and returns the account details, balance and limits. Only call it with credentials the owner just gave you.",
    run: async (a, _cred, ctx) => {
      if (!ctx) throw new Error("Calls can only be set up from a chat.");
      const r = await connectProvider(ctx.uid, { provider: s(a.provider, 20).toLowerCase(), sid: s(a.sid, 200), token: s(a.token, 400), space: s(a.space, 80), apiBase: s(a.api_base, 300) }, reqOf(ctx));
      const head = r.number
        ? `✅ Connected. Number: ${r.number}.${r.webhook ? " Incoming calls ka webhook automatically set ho gaya." : " (Incoming webhook set nahi hua: provider dashboard me number ka Voice webhook khud set karna padega.)"}`
        : "✅ Connected, par is account me koi phone number nahi hai.";
      return `${head}\nTell the owner their credentials are now stored encrypted and they can delete the message that contained them.\n\n${await statusText(ctx.uid)}`;
    },
  },
  {
    name: "voice.settings", risk: "write",
    params: "owner_number?:string (owner's own number with country code), voice_provider?:local|builtin|openai|gemini|elevenlabs|deepgram, voice_key?:string, voice_name?:string, voice_model?:string, language?:string (hi-IN, en-IN, auto ...), daily_limit?:number, trust_caller_id?:boolean",
    description: "Change calling settings for ALL chats: the owner's own phone number (used when you must phone the owner), the voice model (local on the cloud PC, or a provider with the owner's key), language, the daily outbound call limit, and whether calls that come IN from the owner's number are trusted as the owner (default off: caller ID can be faked).",
    run: async (a, _cred, ctx) => {
      if (!ctx) throw new Error("Not available here.");
      const uid = ctx.uid;
      const cur = await getTele(uid);
      const patch: Partial<VoiceSettings> & Record<string, unknown> = {};
      const done: string[] = [];

      if (a.owner_number !== undefined) {
        const n = normalizePhone(s(a.owner_number, 30), callingCodeOf(cur.fromNumber) || "91");
        if (!/^\+[1-9]\d{5,14}$/.test(n)) throw new Error("Owner number galat hai. Country code ke saath do, jaise +919876543210.");
        patch.ownerNumber = n; done.push(`owner number ${n}`);
      }
      let vp = s(a.voice_provider, 20).toLowerCase();
      if (vp === "builtin" || vp === "free") vp = "twilio";
      if (vp) {
        if (!(VOICES as readonly string[]).includes(vp)) throw new Error(`Voice provider ye hona chahiye: local, builtin, ${VOICES.slice(2).join(", ")}.`);
        const key = s(a.voice_key, 4096);
        if (KEY_FIELD[vp]) {
          if (key) patch[KEY_FIELD[vp] as string] = key;
          else if (!(await haveKey(uid, vp))) throw new Error(`${vp} ke liye voice key chahiye. Owner se key maango.`);
        }
        patch.ttsProvider = vp as VoiceSettings["ttsProvider"];
        // a voice name of another provider would break this one
        patch.ttsVoice = s(a.voice_name, 160); patch.ttsModel = s(a.voice_model, 120);
        done.push(`voice: ${VOICE_LABEL[vp]}`);
      } else {
        if (a.voice_name !== undefined) patch.ttsVoice = s(a.voice_name, 160);
        if (a.voice_model !== undefined) patch.ttsModel = s(a.voice_model, 120);
      }
      if (a.language !== undefined) {
        const l = s(a.language, 12);
        if (!/^(?:auto|[a-z]{2,3}(?:-[A-Z]{2})?)$/.test(l)) throw new Error("Language tag galat hai (jaise en-IN, hi-IN ya auto).");
        patch.language = l; done.push(`language ${l}`);
      }
      if (a.daily_limit !== undefined) {
        const n = Number(a.daily_limit);
        if (!Number.isInteger(n) || n < 1 || n > 500) throw new Error("Daily limit 1 se 500 ke beech rakho.");
        patch.dailyLimit = n; done.push(`daily limit ${n}`);
      }
      if (!done.length && a.trust_caller_id === undefined && a.voice_name === undefined && a.voice_model === undefined) throw new Error("Kuch badalne ko nahi diya.");
      if (Object.keys(patch).length) await saveVoiceSettings(uid, patch);
      const extra: { voiceChosen?: boolean; trustCallerId?: boolean } = {};
      if (vp) extra.voiceChosen = true;
      if (typeof a.trust_caller_id === "boolean") { extra.trustCallerId = a.trust_caller_id; done.push(`caller-ID bharosa ${a.trust_caller_id ? "ON" : "OFF"}`); }
      if (Object.keys(extra).length) await patchTele(uid, extra);
      await audit(uid, { kind: "voice_settings_saved", chatId: ctx.chatId, text: done.join("; ").slice(0, 200) });

      let local = "";
      if (vp === "local") {
        const lang = resolveLanguage(patch.language ?? cur.language, "");
        const st = await warmLocalVoice(uid, ctx.chatId, lang, 25_000);
        local = st.state === "ready" ? "\n✅ Local voice taiyaar hai." : `\nℹ️ Local voice: ${st.detail} Tab tak built-in voice chalegi.`;
      }
      return `✅ Saved: ${done.join(", ")}.${local}\n\n${await nextStep(uid)}`;
    },
  },
  {
    name: "voice.numbers", risk: "read", params: "",
    description: "List the phone numbers of the connected account and which agent each one belongs to.",
    run: async (_a, _cred, ctx) => {
      if (!ctx) throw new Error("Not available here.");
      const list = await listNumbers(ctx.uid);
      return list.length ? list.map((n) => `${n.number}${n.agent ? ` → ${n.agent}` : " (free)"}`).join("\n") : "Account me koi number nahi hai.";
    },
  },
  {
    name: "voice.number_assign", risk: "write", params: "number:+E164 number of the account, or \"default\" to give this agent's own number back",
    description: "Give a number the account already owns to THIS agent (this chat), so it phones from and answers on its own number. One number belongs to one agent. Agents without a number use the default one.",
    run: async (a, _cred, ctx) => {
      if (!ctx) throw new Error("Not available here.");
      const n = await assignNumber(ctx.uid, ctx.chatId, s(a.number, 30), reqOf(ctx));
      return n ? `Ab ye agent ${n} se call karega aur isi number par aane wali calls yahi uthayega.` : "Is agent ka alag number hata diya: ab default number use hoga.";
    },
  },
  {
    name: "voice.number_buy", risk: "write", params: "country:string (2 letters, IN / US / GB ...), area_code?:string, assign?:boolean (give it to this agent)",
    description: "BUY a new phone number from the connected provider (costs money from the provider balance; tell the owner first). Optionally gives it to this agent.",
    run: async (a, _cred, ctx) => {
      if (!ctx) throw new Error("Not available here.");
      const n = await buyNumber(ctx.uid, { country: s(a.country, 2), areaCode: s(a.area_code, 8) }, reqOf(ctx));
      if (a.assign === true) await assignNumber(ctx.uid, ctx.chatId, n, reqOf(ctx));
      const cur = await getTele(ctx.uid);
      if (!cur.fromNumber) await saveVoiceSettings(ctx.uid, { fromNumber: n });
      return `✅ Naya number mil gaya: ${n}${a.assign === true ? " (is agent ko de diya)" : ""}.`;
    },
  },
  {
    name: "voice.call", risk: "write", params: "to:+E164 number, goal:string (what to achieve on the call), context?:string (facts the caller needs: names, offer, prices)",
    description: "Make a real PHONE CALL with your own voice to a person (client, lead, vendor), from this agent's number. The user approves every call first. You talk to them live; when the call ends, a summary and the follow-up tasks are posted in this chat.",
    run: async (a, _cred, ctx) => {
      if (!ctx) throw new Error("Calls can only be started from a chat.");
      const to = /^(|me|my number|myself|owner|mujhe|mera number|mere number pe)$/i.test(s(a.to, 40)) ? await ownerNumber(ctx.uid) : s(a.to, 20);
      const r = await placeOutboundCall(ctx.uid, { to, goal: s(a.goal), context: s(a.context, 3000), chatId: ctx.chatId, approved: true });
      return `Call started to ${r.to} (id ${r.id}, status ${r.status}). The conversation happens live; the summary will be posted in this chat when it ends.`;
    },
  },
  {
    name: "voice.call_me", risk: "read", params: "goal:string (exactly what to tell the owner: the result of the work, with the key facts), context?:string (details the owner may ask about)",
    description: "PHONE THE OWNER on their saved number and tell them something by voice. Use it whenever the owner says \"call me when it is done\", \"kaam ke baad call karna\", \"mujhe call karke batao\". Finish the work FIRST, then call with the real result in goal. No approval needed: it only rings the owner's own number. On that call the owner can ask follow-up questions and give new orders. For a long BACKGROUND job use mission.start with max_calls:1 and write in its goal to phone the owner at the end (voice.status shows the owner number). If the owner number is missing, ask for it and save it with voice.settings.",
    run: async (a, _cred, ctx) => {
      if (!ctx) throw new Error("Calls can only be started from a chat.");
      const to = await ownerNumber(ctx.uid);
      const r = await placeOutboundCall(ctx.uid, { to, goal: `Report to your owner (they asked you to call them): ${s(a.goal)}`, context: s(a.context, 3000), chatId: ctx.chatId, approved: true });
      return `Calling the owner on ${r.to} now (id ${r.id}). The summary will be posted in this chat when the call ends.`;
    },
  },
  {
    name: "voice.calls", risk: "read", params: "id?:string",
    description: "Recent phone calls with status and summary (or one call by id with its transcript).",
    run: async (a, _cred, ctx) => {
      if (!ctx) throw new Error("Not available here.");
      const col = getAdminDb().collection("users").doc(ctx.uid).collection("voiceCalls");
      if (s(a.id)) {
        const d = (await col.doc(s(a.id, 60)).get()).data() as { status?: string; summary?: string; to?: string; from?: string; transcript?: Array<{ role: string; text: string }> } | undefined;
        if (!d) return "No call with that id.";
        return `${d.to ?? d.from} · ${d.status}\n${d.summary ?? ""}\n\n${(d.transcript ?? []).slice(-30).map((t) => `${t.role}: ${t.text}`).join("\n")}`;
      }
      const snap = await col.orderBy("createdAt", "desc").limit(6).get();
      return snap.docs.map((x) => { const d = x.data(); return `id=${x.id} · ${d.direction} ${d.to ?? d.from} · ${d.status}${d.summary ? "\n   " + String(d.summary).slice(0, 220) : ""}`; }).join("\n") || "No calls yet.";
    },
  },
];

async function ownerNumber(uid: string): Promise<string> {
  const n = (await getTele(uid)).ownerNumber;
  if (!n) throw new Error("Owner ka number abhi saved nahi hai. Owner se uska number maango aur voice.settings (owner_number) se save karo.");
  return n;
}
