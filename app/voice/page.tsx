"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, AudioLines, CheckCircle2, ChevronDown, CircleAlert, Copy, LoaderCircle, Mic, Phone, PhoneCall, RefreshCw, ShieldCheck, Square, TestTube2, Unplug } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { PROVIDERS, type ProviderId } from "@/lib/providers";

type Settings = {
  openaiConnected: boolean; twilioConnected: boolean; ttsProvider: TtsProvider; ttsModel: string; ttsVoice: string; ttsConnected: Partial<Record<TtsProvider, boolean>>; fromNumber: string; llmProvider: ProviderId; llmModel: string;
  language: string; inboundEnabled: boolean; outboundEnabled: boolean; approvalRequired: boolean; dailyLimit: number;
};
type ProviderOption = { id: ProviderId; label: string; models: string[] };
type TtsProvider = "openai" | "gemini" | "elevenlabs" | "azure" | "deepgram" | "cartesia" | "playht";
const TTS_OPTIONS: Record<TtsProvider, { label: string; keyField: string; models: string[]; voices: string[] }> = {
  openai: { label: "OpenAI", keyField: "openaiKey", models: ["gpt-4o-mini-tts", "tts-1", "tts-1-hd"], voices: ["alloy", "ash", "ballad", "coral", "echo", "fable", "nova", "onyx", "sage", "shimmer", "verse", "marin", "cedar"] },
  gemini: { label: "Google Gemini", keyField: "geminiKey", models: ["gemini-2.5-flash-preview-tts", "gemini-2.5-pro-preview-tts"], voices: ["Zephyr", "Puck", "Charon", "Kore", "Fenrir", "Leda", "Orus", "Aoede", "Callirrhoe", "Autonoe", "Enceladus", "Iapetus", "Umbriel", "Algieba", "Despina", "Erinome", "Algenib", "Rasalgethi", "Laomedeia", "Achernar", "Alnilam", "Schedar", "Gacrux", "Pulcherrima", "Achird", "Zubenelgenubi", "Vindemiatrix", "Sadachbia", "Sadaltager", "Sulafat"] },
  elevenlabs: { label: "ElevenLabs", keyField: "elevenLabsKey", models: ["eleven_multilingual_v2", "eleven_turbo_v2_5", "eleven_flash_v2_5"], voices: ["Rachel", "Domi", "Bella", "Antoni", "Elli", "Josh", "Arnold", "Adam", "Sam"] },
  azure: { label: "Azure Speech", keyField: "azureSpeechKey", models: ["neural"], voices: ["en-US-JennyNeural", "en-US-GuyNeural", "en-IN-NeerjaNeural", "hi-IN-SwaraNeural", "hi-IN-MadhurNeural"] },
  deepgram: { label: "Deepgram", keyField: "deepgramKey", models: ["aura-2"], voices: ["aura-2-thalia-en", "aura-2-andromeda-en", "aura-2-helena-en", "aura-2-arcas-en", "aura-2-orpheus-en", "aura-2-amalthea-en"] },
  cartesia: { label: "Cartesia", keyField: "cartesiaKey", models: ["sonic-3", "sonic-2"], voices: ["Katie", "Barbershop Man", "Reading Lady", "Newsman", "Friendly Sidekick"] },
  playht: { label: "PlayHT", keyField: "playhtKey", models: ["PlayDialog", "Play3.0-mini"], voices: ["Jennifer", "Aria", "Atlas", "Mika", "Will"] },
};
type Call = { id: string; direction: string; to: string; from: string; status: string; createdAt: number; durationSeconds: number; provider: string; estimatedCost: number | null };
const DEFAULTS: Settings = { openaiConnected: false, twilioConnected: false, ttsProvider: "openai", ttsModel: "gpt-4o-mini-tts", ttsVoice: "alloy", ttsConnected: {}, fromNumber: "", llmProvider: "openai", llmModel: "gpt-4o-mini", language: "en-US", inboundEnabled: false, outboundEnabled: false, approvalRequired: true, dailyLimit: 50 };
const inputClass = "w-full rounded-xl border border-line bg-bg px-3 py-2.5 text-sm text-ink outline-none transition focus:border-ink/40";
const labelClass = "mb-1.5 block text-xs font-semibold uppercase tracking-wide text-muted";

export default function VoiceSettingsPage() {
  const { user, loading: authLoading } = useAuth();
  const [settings, setSettings] = useState<Settings>(DEFAULTS);
  const [providers, setProviders] = useState<ProviderOption[]>(PROVIDERS as ProviderOption[]);
  const [inboundWebhookUrl, setInboundWebhookUrl] = useState("");
  const [openaiKey, setOpenaiKey] = useState("");
  const [ttsKey, setTtsKey] = useState("");
  const [twilioSid, setTwilioSid] = useState("");
  const [twilioToken, setTwilioToken] = useState("");
  const [phone, setPhone] = useState("");
  const [calls, setCalls] = useState<Call[]>([]);
  const [todayCount, setTodayCount] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: "ok" | "error" | "info"; text: string } | null>(null);
  const [voiceActive, setVoiceActive] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState("Voice chat is off");
  const [approval, setApproval] = useState(true);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);

  const api = useCallback(async (url: string, init: RequestInit = {}) => {
    if (!user) throw new Error("Sign in to manage voice settings.");
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${await user.getIdToken()}`);
    if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    const response = await fetch(url, { ...init, headers, cache: "no-store" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Request failed (HTTP ${response.status}).`);
    return data;
  }, [user]);

  const refresh = useCallback(async () => {
    const [d, h] = await Promise.all([api("/api/voice/settings"), api("/api/voice/calls")]);
    setSettings({ ...DEFAULTS, ...d.settings });
    setProviders(d.providers?.length ? d.providers : PROVIDERS as ProviderOption[]);
    setInboundWebhookUrl(d.inboundWebhookUrl || "");
    setCalls(h.calls || []); setTodayCount(h.todayCount || 0);
    setPhone(d.settings?.fromNumber || "");
  }, [api]);

  useEffect(() => { if (user) refresh().catch(e => setNotice({ kind: "error", text: e.message })); }, [user, refresh]);

  async function save() {
    setBusy("save"); setNotice(null);
    try {
      const patch: Record<string, unknown> = {
        action: "save", fromNumber: phone, llmProvider: settings.llmProvider, llmModel: settings.llmModel,
        language: settings.language, inboundEnabled: settings.inboundEnabled, outboundEnabled: settings.outboundEnabled,
        approvalRequired: settings.approvalRequired, dailyLimit: Number(settings.dailyLimit),
      };
      if (openaiKey.trim()) patch.openaiKey = openaiKey.trim();
      if (ttsKey.trim()) patch[TTS_OPTIONS[settings.ttsProvider].keyField] = ttsKey.trim();
      patch.ttsProvider = settings.ttsProvider; patch.ttsModel = settings.ttsModel; patch.ttsVoice = settings.ttsVoice;
      if (twilioSid.trim()) patch.twilioSid = twilioSid.trim();
      if (twilioToken.trim()) patch.twilioToken = twilioToken.trim();
      await api("/api/voice/settings", { method: "POST", body: JSON.stringify(patch) });
      setOpenaiKey(""); setTtsKey(""); setTwilioSid(""); setTwilioToken("");
      await refresh(); setNotice({ kind: "ok", text: "Settings saved securely. Run connection tests before making calls." });
    } catch (e) { setNotice({ kind: "error", text: e instanceof Error ? e.message : "Could not save settings." }); }
    finally { setBusy(null); }
  }

  async function test(kind: string, provider?: ProviderId) {
    setBusy(`test-${kind}`); setNotice(null);
    try {
      const d = await api("/api/voice/test", { method: "POST", body: JSON.stringify({ kind, provider, model: provider === settings.llmProvider ? settings.llmModel : undefined }) });
      setNotice({ kind: "ok", text: d.label || "Connection test passed." });
      await refresh();
    } catch (e) { setNotice({ kind: "error", text: e instanceof Error ? e.message : "Connection test failed." }); }
    finally { setBusy(null); }
  }

  async function disconnect(field: "openaiKey" | "twilioSid" | "twilioToken") {
    setBusy(`disconnect-${field}`); setNotice(null);
    try { await api("/api/voice/settings", { method: "POST", body: JSON.stringify({ action: "disconnect", field }) }); await refresh(); setNotice({ kind: "ok", text: "Credential disconnected." }); }
    catch (e) { setNotice({ kind: "error", text: e instanceof Error ? e.message : "Could not disconnect." }); }
    finally { setBusy(null); }
  }

  async function startCall() {
    if (!phone.trim()) { setNotice({ kind: "error", text: "Set your verified caller ID in settings first." }); return; }
    const to = window.prompt("Enter the destination number in international format (e.g. +14155550123):");
    if (!to) return;
    const approved = settings.approvalRequired ? window.confirm(`Start an AI call to ${to}? Make sure you have the recipient's required consent.`) : true;
    if (!approved) return;
    setBusy("call"); setNotice(null);
    try {
      const d = await api("/api/voice/calls", { method: "POST", body: JSON.stringify({ to, approved }) });
      setNotice({ kind: "ok", text: `Call request accepted. Status: ${d.call.status}.` });
      await refresh();
    } catch (e) { setNotice({ kind: "error", text: e instanceof Error ? e.message : "Could not start call." }); }
    finally { setBusy(null); }
  }

  async function startVoice() {
    setBusy("voice"); setNotice(null); setVoiceStatus("Requesting a secure, short-lived voice session…");
    try {
      const d = await api("/api/voice/realtime", { method: "POST", body: "{}" });
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const pc = new RTCPeerConnection(); pcRef.current = pc;
      const audio = new Audio(); audio.autoplay = true; audioRef.current = audio;
      pc.ontrack = event => { audio.srcObject = event.streams[0]; void audio.play().catch(() => {}); };
      stream.getTracks().forEach(track => pc.addTrack(track, stream));
      const dc = pc.createDataChannel("oai-events"); dcRef.current = dc;
      dc.onopen = () => { setVoiceActive(true); setVoiceStatus("Connected · speak naturally"); };
      dc.onclose = () => { setVoiceActive(false); setVoiceStatus("Voice chat disconnected"); };
      const offer = await pc.createOffer(); await pc.setLocalDescription(offer);
      const answerRes = await fetch("https://api.openai.com/v1/realtime/calls", { method: "POST", headers: { Authorization: `Bearer ${d.value}`, "Content-Type": "application/sdp" }, body: offer.sdp });
      if (!answerRes.ok) throw new Error(`Realtime connection failed (HTTP ${answerRes.status}). Check Realtime API access and key permissions.`);
      await pc.setRemoteDescription({ type: "answer", sdp: await answerRes.text() });
      setVoiceStatus("Connecting microphone and audio…");
    } catch (e) { stopVoice(); setNotice({ kind: "error", text: e instanceof Error ? e.message : "Could not start voice chat." }); setVoiceStatus("Voice chat is off"); }
    finally { setBusy(null); }
  }

  function stopVoice() {
    dcRef.current?.close(); dcRef.current = null;
    pcRef.current?.getSenders().forEach(s => s.track?.stop()); pcRef.current?.close(); pcRef.current = null;
    streamRef.current?.getTracks().forEach(t => t.stop()); streamRef.current = null;
    if (audioRef.current) { audioRef.current.pause(); audioRef.current.srcObject = null; audioRef.current = null; }
    setVoiceActive(false); setVoiceStatus("Voice chat is off");
  }
  useEffect(() => () => { dcRef.current?.close(); pcRef.current?.close(); streamRef.current?.getTracks().forEach(t => t.stop()); }, []);

  if (authLoading) return <main className="min-h-screen bg-bg p-8 text-ink">Loading your account…</main>;
  if (!user) return <main className="min-h-screen bg-bg p-8 text-ink"><Link href="/" className="text-sm text-muted">Sign in to configure Voice & Calling</Link></main>;
  const selected = providers.find(p => p.id === settings.llmProvider) || providers[0];
  const fmtDate = (n: number) => n ? new Date(n).toLocaleString() : "—";
  const fmtDuration = (n: number) => `${Math.floor(n / 60)}m ${n % 60}s`;
  const statusTone = (s: string) => ["completed", "in-progress", "answered"].includes(s) ? "text-emerald-600" : ["failed", "busy", "no-answer", "canceled"].includes(s) ? "text-red-500" : "text-muted";

  return (
    <main className="min-h-screen bg-bg px-4 py-6 text-ink sm:px-8 sm:py-10">
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-2">
            <Link href="/dashboard" className="inline-flex items-center gap-2 text-sm text-muted hover:text-ink"><ArrowLeft size={15}/> Back to Agentic-Venus</Link>
            <div className="flex items-center gap-3"><div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-line bg-panel"><AudioLines size={22}/></div><div><h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Voice & Calling</h1><p className="mt-1 text-sm text-muted">Connect your own keys. Voice usage is billed by your chosen providers.</p></div></div>
          </div>
          <button onClick={() => refresh().catch(e => setNotice({ kind: "error", text: e.message }))} className="inline-flex items-center gap-2 rounded-xl border border-line bg-panel px-3 py-2 text-sm hover:bg-panel2"><RefreshCw size={15}/> Refresh</button>
        </div>

        {notice && <div role="status" className={`flex items-start gap-2 rounded-xl border px-4 py-3 text-sm ${notice.kind === "error" ? "border-red-500/30 bg-red-500/5 text-red-600" : notice.kind === "ok" ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-700" : "border-line bg-panel text-muted"}`}>{notice.kind === "error" ? <CircleAlert size={17} className="mt-0.5 shrink-0"/> : <CheckCircle2 size={17} className="mt-0.5 shrink-0"/>}<span>{notice.text}</span></div>}

        <section className="grid gap-3 sm:grid-cols-3">
          <StatusCard icon={<Mic size={18}/>} title="Browser voice" status={voiceActive ? "Connected" : settings.openaiConnected ? "Ready to test" : "Needs OpenAI key"} ok={voiceActive || settings.openaiConnected}/>
          <StatusCard icon={<Phone size={18}/>} title="Phone provider" status={settings.twilioConnected ? "Credentials saved" : "Not connected"} ok={settings.twilioConnected}/>
          <StatusCard icon={<ShieldCheck size={18}/>} title="AI reasoning" status={`${providers.length} providers supported`} ok={providers.length >= 11}/>
        </section>

        <section className="grid gap-5 lg:grid-cols-2">
          <div className="space-y-4 rounded-2xl border border-line bg-panel p-4 sm:p-5">
            <div className="flex items-start justify-between gap-3"><div><h2 className="font-semibold">1. Browser voice</h2><p className="mt-1 text-sm text-muted">OpenAI Realtime · low-latency speech-to-speech</p></div><span className={`rounded-full px-2.5 py-1 text-xs ${settings.openaiConnected ? "bg-emerald-500/10 text-emerald-700" : "bg-panel2 text-muted"}`}>{settings.openaiConnected ? "Key saved" : "Not connected"}</span></div>
            <div><label className={labelClass}>OpenAI API key</label><input className={inputClass} type="password" autoComplete="new-password" value={openaiKey} onChange={e => setOpenaiKey(e.target.value)} placeholder={settings.openaiConnected ? "Saved securely · enter only to rotate" : "sk-…"}/><p className="mt-1.5 text-xs text-muted">Permanent key stays server-side. The browser receives only a short-lived session token.</p></div>
            <div className="flex flex-wrap gap-2"><button onClick={save} disabled={busy !== null || !openaiKey.trim()} className="rounded-xl bg-ink px-3.5 py-2.5 text-sm font-medium text-bg disabled:opacity-40">Save key</button><button onClick={() => test("openai-realtime")} disabled={busy !== null || !settings.openaiConnected} className="inline-flex items-center gap-2 rounded-xl border border-line px-3.5 py-2.5 text-sm disabled:opacity-40">{busy === "test-openai-realtime" ? <LoaderCircle size={15} className="animate-spin"/> : <TestTube2 size={15}/>} Test key</button>{settings.openaiConnected && <button onClick={() => disconnect("openaiKey")} disabled={busy !== null} className="inline-flex items-center gap-2 rounded-xl border border-line px-3 py-2.5 text-sm text-muted"><Unplug size={15}/> Disconnect</button>}</div>
            <div className="rounded-xl border border-line bg-bg p-3"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-sm font-medium">Live voice chat</p><p className="mt-1 text-xs text-muted">Requires microphone permission and Realtime API access.</p></div><button onClick={voiceActive ? stopVoice : startVoice} disabled={busy !== null || (!voiceActive && !settings.openaiConnected)} className="inline-flex items-center gap-2 rounded-xl bg-ink px-3 py-2 text-sm text-bg disabled:opacity-40">{busy === "voice" ? <LoaderCircle size={15} className="animate-spin"/> : voiceActive ? <Square size={14}/> : <Mic size={15}/>} {voiceActive ? "Stop voice" : "Start voice"}</button></div><p className="mt-2 text-xs text-muted" aria-live="polite">{voiceStatus}</p></div>
          </div>

          <div className="space-y-4 rounded-2xl border border-line bg-panel p-4 sm:p-5">
            <div className="flex items-start justify-between gap-3"><div><h2 className="font-semibold">2. Phone provider</h2><p className="mt-1 text-sm text-muted">Twilio Voice · incoming and outgoing calls</p></div><span className={`rounded-full px-2.5 py-1 text-xs ${settings.twilioConnected ? "bg-emerald-500/10 text-emerald-700" : "bg-panel2 text-muted"}`}>{settings.twilioConnected ? "Credentials saved" : "Not connected"}</span></div>
            <div><label className={labelClass}>Twilio Account SID</label><input className={inputClass} value={twilioSid} onChange={e => setTwilioSid(e.target.value)} placeholder={settings.twilioConnected ? "Saved securely · enter to rotate" : "AC…"} autoComplete="off"/></div>
            <div><label className={labelClass}>Twilio Auth Token</label><input className={inputClass} type="password" value={twilioToken} onChange={e => setTwilioToken(e.target.value)} placeholder={settings.twilioConnected ? "Saved securely · enter to rotate" : "Auth token"} autoComplete="new-password"/></div>
            <div><label className={labelClass}>Verified caller ID / Twilio number</label><input className={inputClass} value={phone} onChange={e => setPhone(e.target.value)} placeholder="+14155550123" inputMode="tel"/><p className="mt-1.5 text-xs text-muted">Use E.164 format. Twilio must own or verify this number and allow the destination country.</p></div>
            <div className="flex flex-wrap gap-2"><button onClick={save} disabled={busy !== null || (!twilioSid.trim() && !twilioToken.trim() && phone === settings.fromNumber)} className="rounded-xl bg-ink px-3.5 py-2.5 text-sm font-medium text-bg disabled:opacity-40">Save phone settings</button><button onClick={() => test("phone")} disabled={busy !== null || !settings.twilioConnected} className="inline-flex items-center gap-2 rounded-xl border border-line px-3.5 py-2.5 text-sm disabled:opacity-40">{busy === "test-phone" ? <LoaderCircle size={15} className="animate-spin"/> : <TestTube2 size={15}/>} Test connection</button>{settings.twilioConnected && <button onClick={() => { setBusy("disconnect-phone"); api("/api/voice/settings", { method: "POST", body: JSON.stringify({ action: "disconnect", field: "twilio" }) }).then(() => refresh()).then(() => setNotice({ kind: "ok", text: "Phone provider disconnected." })).catch(e => setNotice({ kind: "error", text: e.message })).finally(() => setBusy(null)); }} disabled={busy !== null} className="inline-flex items-center gap-2 rounded-xl border border-line px-3 py-2.5 text-sm text-muted"><Unplug size={15}/> Disconnect</button>}</div>
          </div>
        </section>

        <section className="space-y-4 rounded-2xl border border-line bg-panel p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-semibold">3. Voice provider, model and voice</h2><p className="mt-1 text-sm text-muted">Choose a speech-generation provider and save its own API key. Keys are encrypted server-side.</p></div><span className={`rounded-full px-2.5 py-1 text-xs ${settings.ttsConnected?.[settings.ttsProvider] ? "bg-emerald-500/10 text-emerald-700" : "bg-panel2 text-muted"}`}>{settings.ttsConnected?.[settings.ttsProvider] ? "Key saved" : "Key needed"}</span></div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div><label className={labelClass}>Voice provider</label><select className={inputClass} value={settings.ttsProvider} onChange={e => { const provider = e.target.value as TtsProvider; setSettings(s => ({ ...s, ttsProvider: provider, ttsModel: TTS_OPTIONS[provider].models[0], ttsVoice: TTS_OPTIONS[provider].voices[0] })); setTtsKey(""); }}>
              {Object.entries(TTS_OPTIONS).map(([id, p]) => <option key={id} value={id}>{p.label}</option>)}
            </select></div>
            <div><label className={labelClass}>Speech model</label><select className={inputClass} value={settings.ttsModel} onChange={e => setSettings(s => ({ ...s, ttsModel: e.target.value }))}>{TTS_OPTIONS[settings.ttsProvider].models.map(m => <option key={m} value={m}>{m}</option>)}</select></div>
            <div><label className={labelClass}>Voice</label><select className={inputClass} value={settings.ttsVoice} onChange={e => setSettings(s => ({ ...s, ttsVoice: e.target.value }))}>{TTS_OPTIONS[settings.ttsProvider].voices.map(v => <option key={v} value={v}>{v}</option>)}</select></div>
          </div>
          <div><label className={labelClass}>{TTS_OPTIONS[settings.ttsProvider].label} API key</label><input className={inputClass} type="password" autoComplete="new-password" value={ttsKey} onChange={e => setTtsKey(e.target.value)} placeholder={settings.ttsConnected?.[settings.ttsProvider] ? "Saved securely · enter to rotate key" : "Paste provider API key"}/><p className="mt-1.5 text-xs text-muted">Voice choices shown here are provider-specific presets. ElevenLabs custom voice IDs and some provider voices may need to be selected in that provider’s console. Provider support, regions and billing vary.</p></div>
          <div className="flex flex-wrap gap-2"><button onClick={save} disabled={busy !== null || (!ttsKey.trim() && !settings.ttsConnected?.[settings.ttsProvider])} className="rounded-xl bg-ink px-3.5 py-2.5 text-sm font-medium text-bg disabled:opacity-40">Save voice setup</button><button onClick={() => test("tts")} disabled={busy !== null || !settings.ttsConnected?.[settings.ttsProvider]} className="inline-flex items-center gap-2 rounded-xl border border-line px-3.5 py-2.5 text-sm disabled:opacity-40">{busy === "test-tts" ? <LoaderCircle size={15} className="animate-spin"/> : <TestTube2 size={15}/>} Test voice key</button>{settings.ttsConnected?.[settings.ttsProvider] && settings.ttsProvider !== "openai" && <button onClick={() => api("/api/voice/settings", { method: "POST", body: JSON.stringify({ action: "disconnect", field: TTS_OPTIONS[settings.ttsProvider].keyField }) }).then(() => refresh()).then(() => setNotice({ kind: "ok", text: "Voice provider key disconnected." })).catch(e => setNotice({ kind: "error", text: e.message }))} disabled={busy !== null} className="inline-flex items-center gap-2 rounded-xl border border-line px-3 py-2.5 text-sm text-muted"><Unplug size={15}/> Disconnect key</button>}</div>
          <p className="text-xs text-muted">Important: selecting a TTS provider changes the saved speech settings; the existing live browser speech-to-speech session still uses OpenAI Realtime. Phone-call playback needs the corresponding provider adapter to be wired into the call runtime.</p>
        </section>

        <section className="space-y-4 rounded-2xl border border-line bg-panel p-4 sm:p-5">
          <div><h2 className="font-semibold">4. AI provider and call behavior</h2><p className="mt-1 text-sm text-muted">Phone conversations use your existing Agentic-Venus model-provider keys. All 11 configured providers are available for reasoning.</p></div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div><label className={labelClass}>AI provider</label><div className="relative"><select className={`${inputClass} appearance-none pr-9`} value={settings.llmProvider} onChange={e => { const id = e.target.value as ProviderId; const p = providers.find(x => x.id === id); setSettings(s => ({ ...s, llmProvider: id, llmModel: p?.models?.[0] || "" })); }}><option value="" disabled>Select provider</option>{providers.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}</select><ChevronDown size={15} className="pointer-events-none absolute right-3 top-3 text-muted"/></div></div>
            <div><label className={labelClass}>Model ID</label><input className={inputClass} value={settings.llmModel} onChange={e => setSettings(s => ({ ...s, llmModel: e.target.value }))} placeholder={selected?.models?.[0] || "Model ID"}/></div>
            <div><label className={labelClass}>Speech language</label><select className={inputClass} value={settings.language} onChange={e => setSettings(s => ({ ...s, language: e.target.value }))}><option value="en-US">English (US)</option><option value="en-GB">English (UK)</option><option value="hi-IN">Hindi (India)</option><option value="es-ES">Spanish</option><option value="fr-FR">French</option><option value="de-DE">German</option><option value="pt-BR">Portuguese (Brazil)</option><option value="ja-JP">Japanese</option><option value="ar-SA">Arabic</option><option value="it-IT">Italian</option><option value="zh-CN">Chinese (Mandarin)</option></select></div>
          </div>
          <div className="flex flex-wrap items-center gap-2"><button onClick={() => test("llm", settings.llmProvider)} disabled={busy !== null} className="inline-flex items-center gap-2 rounded-xl border border-line px-3.5 py-2.5 text-sm disabled:opacity-40">{busy === "test-llm" ? <LoaderCircle size={15} className="animate-spin"/> : <TestTube2 size={15}/>} Test selected AI</button><button onClick={save} disabled={busy !== null} className="rounded-xl bg-ink px-3.5 py-2.5 text-sm font-medium text-bg disabled:opacity-40">Save call settings</button></div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Toggle title="Accept incoming calls" detail="Twilio webhook" value={settings.inboundEnabled} onChange={v => setSettings(s => ({ ...s, inboundEnabled: v }))}/>
            <Toggle title="Allow outgoing calls" detail="Requires a phone number" value={settings.outboundEnabled} onChange={v => setSettings(s => ({ ...s, outboundEnabled: v }))}/>
            <Toggle title="Approval before dialing" detail="Recommended for safety" value={settings.approvalRequired} onChange={v => setSettings(s => ({ ...s, approvalRequired: v }))}/>
            <div className="rounded-xl border border-line p-3"><label className={labelClass}>Daily outbound limit</label><select className={inputClass} value={String(settings.dailyLimit)} onChange={e => setSettings(s => ({ ...s, dailyLimit: Number(e.target.value) }))}><option value="10">10 calls</option><option value="50">50 calls</option><option value="100">100 calls</option><option value="250">250 calls</option><option value="500">500 calls</option></select></div>
          </div>
          {settings.inboundEnabled && <div className="rounded-xl border border-line bg-bg p-3"><div className="flex items-center justify-between gap-2"><p className="text-sm font-medium">Incoming-call webhook URL</p><button onClick={() => { void navigator.clipboard?.writeText(inboundWebhookUrl); setNotice({ kind: "ok", text: "Webhook URL copied. Paste it into the phone number's Twilio Voice webhook configuration." }); }} className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs"><Copy size={13}/> Copy URL</button></div><p className="mt-2 break-all font-mono text-xs text-muted">{inboundWebhookUrl || "Save settings to generate the webhook URL."}</p><p className="mt-2 text-xs text-muted">In Twilio Console, set the number&apos;s incoming Voice webhook to this URL using HTTP POST. Keep the URL private; it contains a signed endpoint token.</p></div>}
          <p className="text-xs leading-relaxed text-muted">Country support depends on your carrier account, number availability, local rules, destination permissions and language support. This app validates international E.164 numbers; it cannot make a carrier offer service in every country.</p>
        </section>

        <section className="space-y-4 rounded-2xl border border-line bg-panel p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-semibold">5. Call activity</h2><p className="mt-1 text-sm text-muted">Today: {todayCount} call(s) · Limit: {settings.dailyLimit}/day</p></div><div className="flex gap-2"><button onClick={() => refresh().catch(e => setNotice({ kind: "error", text: e.message }))} className="inline-flex items-center gap-2 rounded-xl border border-line px-3 py-2 text-sm"><RefreshCw size={14}/> Refresh</button><button onClick={startCall} disabled={busy !== null || !settings.outboundEnabled || !settings.twilioConnected} className="inline-flex items-center gap-2 rounded-xl bg-ink px-3.5 py-2.5 text-sm font-medium text-bg disabled:opacity-40">{busy === "call" ? <LoaderCircle size={15} className="animate-spin"/> : <PhoneCall size={15}/>} Start phone call</button></div></div>
          {calls.length === 0 ? <div className="rounded-xl border border-dashed border-line px-4 py-8 text-center"><Phone size={22} className="mx-auto text-muted"/><p className="mt-2 text-sm font-medium">No calls yet</p><p className="mt-1 text-xs text-muted">Test both connections, enable calls and place your first approved test call.</p></div> : <div className="overflow-x-auto"><table className="w-full min-w-[600px] text-left text-sm"><thead><tr className="border-b border-line text-xs text-muted"><th className="py-2 pr-3 font-medium">Direction / number</th><th className="py-2 pr-3 font-medium">Status</th><th className="py-2 pr-3 font-medium">Duration</th><th className="py-2 pr-3 font-medium">AI provider</th><th className="py-2 font-medium">Started</th></tr></thead><tbody>{calls.map(c => <tr key={c.id} className="border-b border-line/70 last:border-0"><td className="py-3 pr-3"><span className="block text-xs capitalize text-muted">{c.direction}</span><span>{c.direction === "inbound" ? c.from : c.to}</span></td><td className={`py-3 pr-3 capitalize ${statusTone(c.status)}`}>{c.status}</td><td className="py-3 pr-3">{fmtDuration(c.durationSeconds || 0)}</td><td className="py-3 pr-3">{c.provider || "—"}</td><td className="py-3">{fmtDate(c.createdAt)}</td></tr>)}</tbody></table></div>}
          <p className="text-xs text-muted">Call costs are not estimated here because carrier rates and AI token usage vary. Use the provider&apos;s billing console for final charges.</p>
        </section>

        <footer className="flex items-start gap-2 rounded-xl border border-line px-4 py-3 text-xs leading-relaxed text-muted"><ShieldCheck size={16} className="mt-0.5 shrink-0"/><p>Keys are encrypted with Agentic-Venus Vault and are not returned to the browser. Use consent-based calls, honor opt-outs and follow local telemarketing, recording and privacy rules. Do not use caller ID spoofing or automated calls where prohibited.</p></footer>
      </div>
    </main>
  );
}

function StatusCard({ icon, title, status, ok }: { icon: React.ReactNode; title: string; status: string; ok: boolean }) {
  return <div className="flex items-start gap-3 rounded-2xl border border-line bg-panel p-4"><div className="rounded-xl border border-line bg-bg p-2">{icon}</div><div className="min-w-0"><p className="text-sm font-medium">{title}</p><p className={`mt-1 text-xs ${ok ? "text-emerald-600" : "text-muted"}`}>{status}</p></div></div>;
}
function Toggle({ title, detail, value, onChange }: { title: string; detail: string; value: boolean; onChange: (v: boolean) => void }) {
  return <button type="button" role="switch" aria-checked={value} onClick={() => onChange(!value)} className="flex items-center justify-between gap-3 rounded-xl border border-line p-3 text-left"><span><span className="block text-sm font-medium">{title}</span><span className="mt-1 block text-xs text-muted">{detail}</span></span><span className={`relative h-5 w-9 shrink-0 rounded-full transition ${value ? "bg-emerald-600" : "bg-line"}`}><span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition ${value ? "left-[18px]" : "left-0.5"}`}/></span></button>;
}