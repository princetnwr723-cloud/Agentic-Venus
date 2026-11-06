// More calling tools, chat-managed like the rest of calling: Telnyx as the phone company (beta) and the REAL-TIME call mode (beta).
// They are registered through lib/tools/mission.ts, so the tool registry itself needs no change.
import { audit } from "@/lib/audit";
import { saveVoiceSettings } from "@/lib/voice-server";
import { connectProvider, describeAccount, getTele, patchTele } from "@/lib/telephony";
import { ensureBridge, RT_DEFAULT_MODEL } from "@/lib/voice-rt";
import { getExistingOpenAIKey } from "@/lib/voice-utils";
import { getResolvedVoiceSecrets } from "@/lib/voice-server";
import type { ToolCtx } from "./types";
import type { Def } from "./plugins";

const s = (v: unknown, n = 300) => String(v ?? "").trim().slice(0, n);
const reqOf = (ctx?: ToolCtx) => (ctx?.baseUrl ? new Request(ctx.baseUrl) : undefined);
const VOICES = ["marin", "cedar", "alloy", "ash", "ballad", "coral", "echo", "sage", "shimmer", "verse"];

export const VOICE_EXTRA_TOOLS: Def[] = [
  {
    name: "voice.connect_telnyx", risk: "write", params: "api_key:string (Telnyx v2 API key), application_id:string (the TeXML Application ID)",
    description: "Connect TELNYX as the phone company for calling (beta). The owner first creates a TeXML Application in the Telnyx portal (Voice → TeXML Applications) and assigns a phone number to it. This tool checks the key and the application, points the application at this app, picks the number and shows the account details. One setup works in every chat. Tell the owner they may delete the message that contained the key.",
    run: async (a, _cred, ctx) => {
      if (!ctx) throw new Error("Calls can only be set up from a chat.");
      const r = await connectProvider(ctx.uid, { provider: "telnyx", sid: s(a.application_id, 120), token: s(a.api_key, 300) }, reqOf(ctx));
      const head = r.number
        ? `✅ Telnyx connected. Number: ${r.number}.${r.webhook ? " The address for incoming calls was set on the TeXML Application." : " (The incoming address could not be set: set the Voice URL of the TeXML Application yourself in the Telnyx portal.)"}`
        : "✅ Telnyx connected, but no number was found: buy a number in the portal and attach it to the TeXML Application.";
      return `${head}\nTelnyx is in beta: after the first call, tell me how it went.\n\n${await describeAccount(ctx.uid)}`;
    },
  },
  {
    name: "voice.realtime", risk: "write", params: "enabled:boolean, model?:string (default gpt-realtime), voice?:string (marin, cedar, alloy, ash, ballad, coral, echo, sage, shimmer, verse)",
    description: "Switch phone calls to REAL-TIME mode (beta): the other person can interrupt the agent in the middle of a sentence and there is almost no delay. Needs an OpenAI key and the cloud PC (a small bridge program is installed on it automatically). If the bridge is not ready when a call starts, that call runs in the normal mode by itself. Turn it on only when the owner asks.",
    run: async (a, _cred, ctx) => {
      if (!ctx) throw new Error("Not available here.");
      const uid = ctx.uid;
      if (a.enabled === false) {
        await patchTele(uid, { realtime: false });
        await audit(uid, { kind: "voice_settings_saved", chatId: ctx.chatId, text: "realtime off" });
        return "Real-time mode is off. Calls run in the normal mode now.";
      }
      const k = await getResolvedVoiceSecrets(uid);
      if (!(k.openaiKey || (await getExistingOpenAIKey(uid)))) throw new Error("Real-time mode needs an OpenAI API key (add it under API keys, or give it to me).");
      const voice = s(a.voice, 20).toLowerCase();
      if (voice && !VOICES.includes(voice)) throw new Error(`The voice must be one of: ${VOICES.join(", ")}.`);
      await patchTele(uid, { realtime: true, rtModel: s(a.model, 60) || RT_DEFAULT_MODEL, ...(voice ? { rtVoice: voice } : {}) });
      await saveVoiceSettings(uid, { inboundEnabled: true });
      await audit(uid, { kind: "voice_settings_saved", chatId: ctx.chatId, text: "realtime on" });
      let base = "";
      try { base = new URL(ctx.baseUrl || "").origin; } catch { /* env is used */ }
      const url = await ensureBridge(uid, ctx.chatId, base || (process.env.NEXT_PUBLIC_APP_URL ?? ""), 40_000);
      const cur = await getTele(uid);
      return url
        ? `✅ Real-time mode ON (beta). The bridge is ready on the cloud PC. Model: ${cur.rtModel}. You can now interrupt the agent during calls.`
        : "✅ Real-time mode ON, but the bridge is not ready on the cloud PC yet (the PC may be asleep or the first install is running). Until it is ready, calls run in the normal mode. Ask me to \"check real-time\" again in 1-2 minutes.";
    },
  },
];
