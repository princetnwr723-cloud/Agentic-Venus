"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, AudioLines, CheckCircle2, CircleAlert, LoaderCircle, Phone, PhoneCall, RefreshCw } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { listChats, type Chat } from "@/lib/chats";

type TtsId = "twilio" | "openai" | "gemini" | "elevenlabs" | "deepgram";
type Settings = {
  twilioConnected: boolean; fromNumber: string; ttsProvider: TtsId; ttsModel: string; ttsVoice: string;
  ttsConnected: Record<string, boolean>; voiceChatId: string; language: string; inboundEnabled: boolean; outboundEnabled: boolean;
};
type Call = { id: string; direction: string; to: string; from: string; status: string; createdAt: number; durationSeconds: number; goal: string; summary: string };

const TTS: Record<TtsId, { label: string; models: string[]; voices: string[]; keyHint: string }> = {
  twilio: { label: "Free built-in voice (no key)", models: [""], voices: [""], keyHint: "" },
  openai: { label: "OpenAI", models: ["gpt-4o-mini-tts", "tts-1", "tts-1-hd"], voices: ["alloy", "ash", "coral", "echo", "nova", "onyx", "sage", "shimmer"], keyHint: "sk-…" },
  gemini: { label: "Google Gemini", models: ["gemini-2.5-flash-preview-tts", "gemini-2.5-pro-preview-tts"], voices: ["Kore", "Puck", "Zephyr", "Charon", "Fenrir", "Leda", "Aoede", "Orus"], keyHint: "AIza…" },
  elevenlabs: { label: "ElevenLabs", models: ["eleven_flash_v2_5", "eleven_multilingual_v2", "eleven_turbo_v2_5"], voices: ["Rachel", "Adam", "Bella", "Antoni"], keyHint: "ElevenLabs API key" },
  deepgram: { label: "Deepgram", models: ["aura-2"], voices: ["aura-2-thalia-en", "aura-2-andromeda-en", "aura-2-helena-en", "aura-2-arcas-en", "aura-2-orpheus-en"], keyHint: "Deepgram API key" },
};
const DEFAULTS: Settings = { twilioConnected: false, fromNumber: "", ttsProvider: "twilio", ttsModel: "", ttsVoice: "", ttsConnected: {}, voiceChatId: "", language: "en-US", inboundEnabled: false, outboundEnabled: false };
const box = "w-full rounded-xl border border-line bg-bg px-3 py-2.5 text-sm text-ink outline-none transition focus:border-ink/40";
const label = "mb-1.5 block text-xs font-semibold uppercase tracking-wide text-muted";

export default function VoicePage() {
  const { user, loading: authLoading } = useAuth();
  const [s, setS] = useState<Settings>(DEFAULTS);
  const [chats, setChats] = useState<Chat[]>([]);
  const [calls, setCalls] = useState<Call[]>([]);
  const [webhook, setWebhook] = useState("");
  const [creds, setCreds] = useState("");
  const [ttsKey, setTtsKey] = useState("");
  const [to, setTo] = useState("");
  const [goal, setGoal] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const api = useCallback(async (url: string, init: RequestInit = {}) => {
    if (!user) throw new Error("Sign in karo.");
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${await user.getIdToken()}`);
    if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    const res = await fetch(url, { ...init, headers, cache: "no-store" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (HTTP ${res.status}).`);
    return data;
  }, [user]);

  const refresh = useCallback(async () => {
    const [d, h] = await Promise.all([api("/api/voice/settings"), api("/api/voice/calls")]);
    setS({ ...DEFAULTS, ...d.settings });
    setWebhook(d.inboundWebhookUrl || "");
    setCalls(h.calls || []);
  }, [api]);

  useEffect(() => {
    if (!user) return;
    listChats(user.uid).then(setChats).catch(() => {});
    refresh().catch((e) => setNote({ kind: "error", text: e.message }));
  }, [user, refresh]);

  const run = async (id: string, fn: () => Promise<void>) => {
    setBusy(id); setNote(null);
    try { await fn(); } catch (e) { setNote({ kind: "error", text: e instanceof Error ? e.message : "Kuch galat hua." }); }
    setBusy(null);
  };

  const connect = () => run("connect", async () => {
    const d = await api("/api/voice/settings", { method: "POST", body: JSON.stringify({ action: "connect_twilio", credentials: creds }) });
    setCreds(""); setS({ ...DEFAULTS, ...d.settings }); setWebhook(d.inboundWebhookUrl || webhook);
    setNote({ kind: d.needsNumber ? "error" : "ok", text: d.message });
  });

  const saveVoice = () => run("voice", async () => {
    const d = await api("/api/voice/settings", { method: "POST", body: JSON.stringify({ action: "save", ttsProvider: s.ttsProvider, ttsModel: s.ttsModel, ttsVoice: s.ttsVoice, ttsKey: ttsKey || undefined, language: s.language, voiceChatId: s.voiceChatId }) });
    setS({ ...DEFAULTS, ...d.settings }); setTtsKey("");
    if (s.ttsProvider !== "twilio") {
      const t = await api("/api/voice/test", { method: "POST", body: JSON.stringify({ kind: "tts" }) });
      setNote({ kind: "ok", text: `Saved. ${t.label}` });
    } else setNote({ kind: "ok", text: "Saved. Free built-in voice use hogi." });
  });

  const saveAgent = (patch: Partial<Settings>) => run("agent", async () => {
    const next = { ...s, ...patch }; setS(next);
    await api("/api/voice/settings", { method: "POST", body: JSON.stringify({ action: "save", voiceChatId: next.voiceChatId, language: next.language }) });
    setNote({ kind: "ok", text: "Saved." });
  });

  const startCall = () => run("call", async () => {
    if (!window.confirm(`${to} ko AI call lagani hai?\nSirf unhe call karo jinki consent/permission ho.`)) return;
    const d = await api("/api/voice/calls", { method: "POST", body: JSON.stringify({ to: to.trim(), goal, chatId: s.voiceChatId || undefined, approved: true }) });
    setNote({ kind: "ok", text: `Call lag rahi hai (${d.call.status}). Khatam hone par summary chat me aayegi.` });
    setGoal(""); await refresh();
  });

  if (authLoading) return <main className="min-h-screen bg-bg p-8 text-ink">Loading…</main>;
  if (!user) return <main className="min-h-screen bg-bg p-8 text-ink"><Link href="/" className="text-sm text-muted">Sign in karo</Link></main>;

  const t = TTS[s.ttsProvider];
  const when = (n: number) => (n ? new Date(n).toLocaleString() : "—");

  return (
    <main className="min-h-screen bg-bg px-4 py-6 text-ink sm:px-8 sm:py-10">
      <div className="mx-auto max-w-3xl space-y-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <Link href="/dashboard" className="mb-2 inline-flex items-center gap-2 text-sm text-muted hover:text-ink"><ArrowLeft size={15} /> Dashboard</Link>
            <h1 className="flex items-center gap-2 text-2xl font-semibold"><AudioLines size={22} /> Voice & Calling</h1>
            <p className="mt-1 text-sm text-muted">Twilio key paste karo, baaki sab automatic. Agent wahi model use karta hai jo chat me chal raha hai.</p>
          </div>
          <button onClick={() => refresh().catch((e) => setNote({ kind: "error", text: e.message }))} className="inline-flex items-center gap-2 rounded-xl border border-line bg-panel px-3 py-2 text-sm hover:bg-panel2"><RefreshCw size={15} /> Refresh</button>
        </div>

        {note && <div role="status" className={`flex items-start gap-2 rounded-xl border px-4 py-3 text-sm ${note.kind === "error" ? "border-red-500/30 bg-red-500/5 text-red-500" : "border-emerald-500/30 bg-emerald-500/5 text-emerald-500"}`}>{note.kind === "error" ? <CircleAlert size={17} className="mt-0.5 shrink-0" /> : <CheckCircle2 size={17} className="mt-0.5 shrink-0" />}<span className="whitespace-pre-wrap">{note.text}</span></div>}

        {/* 1. Twilio */}
        <section className="space-y-3 rounded-2xl border border-line bg-panel p-5">
          <div className="flex items-start justify-between gap-3">
            <div><h2 className="flex items-center gap-2 font-semibold"><Phone size={17} /> 1. Twilio key</h2><p className="mt-1 text-sm text-muted">Account SID aur Auth Token ek saath paste karo (Twilio Console → Account Info).</p></div>
            <span className={`rounded-full px-2.5 py-1 text-xs ${s.twilioConnected ? "bg-emerald-500/10 text-emerald-500" : "bg-panel2 text-muted"}`}>{s.twilioConnected ? `Connected ${s.fromNumber}` : "Not connected"}</span>
          </div>
          <textarea className={`${box} h-20 font-mono text-xs`} value={creds} onChange={(e) => setCreds(e.target.value)} placeholder={s.twilioConnected ? "Naya key paste karo to replace ho jayega" : "ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx\nyour_auth_token_32_characters"} autoComplete="off" />
          <div className="flex flex-wrap items-center gap-3">
            <button onClick={connect} disabled={busy !== null || !creds.trim()} className="inline-flex items-center gap-2 rounded-xl bg-ink px-4 py-2.5 text-sm font-medium text-bg disabled:opacity-40">{busy === "connect" && <LoaderCircle size={15} className="animate-spin" />} Connect & set up automatically</button>
            <a href="https://console.twilio.com" target="_blank" rel="noreferrer" className="text-xs text-muted underline">Twilio Console kholo</a>
          </div>
          <p className="text-xs leading-relaxed text-muted">Is ek click me: key check hoti hai, aapka Twilio number milta hai, incoming-call webhook khud set hota hai, aur calling + accept dono ON ho jaate hain. Jis desh me call karni hai uska Voice Geo Permission Twilio Console me ON hona chahiye.</p>
          {s.twilioConnected && webhook && <details className="text-xs text-muted"><summary className="cursor-pointer">Webhook URL (agar Twilio me khud daalna ho)</summary><p className="mt-2 break-all font-mono">{webhook}</p></details>}
        </section>

        {/* 2. Voice provider */}
        <section className="space-y-3 rounded-2xl border border-line bg-panel p-5">
          <div><h2 className="font-semibold">2. Voice provider (agent kis awaaz me bolega)</h2><p className="mt-1 text-sm text-muted">Bolne ka text chat wale model se aata hai. Ye sirf uski awaaz banata hai.</p></div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div><label className={label}>Provider</label><select className={box} value={s.ttsProvider} onChange={(e) => { const p = e.target.value as TtsId; setS({ ...s, ttsProvider: p, ttsModel: TTS[p].models[0], ttsVoice: TTS[p].voices[0] }); setTtsKey(""); }}>{(Object.keys(TTS) as TtsId[]).map((id) => <option key={id} value={id}>{TTS[id].label}</option>)}</select></div>
            {s.ttsProvider !== "twilio" && <div><label className={label}>Model</label><select className={box} value={s.ttsModel} onChange={(e) => setS({ ...s, ttsModel: e.target.value })}>{t.models.map((m) => <option key={m}>{m}</option>)}</select></div>}
            {s.ttsProvider !== "twilio" && <div><label className={label}>Voice</label><select className={box} value={s.ttsVoice} onChange={(e) => setS({ ...s, ttsVoice: e.target.value })}>{t.voices.map((v) => <option key={v}>{v}</option>)}</select></div>}
          </div>
          {s.ttsProvider !== "twilio" && <div><label className={label}>{t.label} API key {s.ttsConnected[s.ttsProvider] ? "· saved" : ""}</label><input className={box} type="password" autoComplete="new-password" value={ttsKey} onChange={(e) => setTtsKey(e.target.value)} placeholder={s.ttsConnected[s.ttsProvider] ? "Replace karne ke liye naya key paste karo" : t.keyHint} /></div>}
          <button onClick={saveVoice} disabled={busy !== null || (s.ttsProvider !== "twilio" && !ttsKey.trim() && !s.ttsConnected[s.ttsProvider])} className="inline-flex items-center gap-2 rounded-xl bg-ink px-4 py-2.5 text-sm font-medium text-bg disabled:opacity-40">{busy === "voice" && <LoaderCircle size={15} className="animate-spin" />} Save & test</button>
        </section>

        {/* 3. Agent */}
        <section className="space-y-3 rounded-2xl border border-line bg-panel p-5">
          <h2 className="font-semibold">3. Kaun si chat call uthayegi</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <div><label className={label}>Agent (chat)</label><select className={box} value={s.voiceChatId} onChange={(e) => void saveAgent({ voiceChatId: e.target.value })}>{!s.voiceChatId && <option value="">Latest chat</option>}{chats.map((c) => <option key={c.id} value={c.id}>{c.agentName} · {c.model}</option>)}</select></div>
            <div><label className={label}>Bolne ki bhasha</label><select className={box} value={s.language} onChange={(e) => void saveAgent({ language: e.target.value })}><option value="en-US">English (US)</option><option value="en-IN">English (India)</option><option value="hi-IN">Hindi</option><option value="en-GB">English (UK)</option><option value="es-ES">Spanish</option><option value="fr-FR">French</option><option value="de-DE">German</option><option value="pt-BR">Portuguese (Brazil)</option><option value="ar-SA">Arabic</option></select></div>
          </div>
          <p className="text-xs text-muted">Is chat ka model, role, memory aur connected tools (Google, MCP…) call ke dauran use hote hain. Call khatam hone par summary aur follow-up tasks usi chat me aate hain.</p>
        </section>

        {/* 4. Call */}
        <section className="space-y-3 rounded-2xl border border-line bg-panel p-5">
          <h2 className="flex items-center gap-2 font-semibold"><PhoneCall size={17} /> 4. Agent se call karwao</h2>
          <div className="grid gap-3 sm:grid-cols-[220px_1fr]">
            <div><label className={label}>Number</label><input className={box} value={to} onChange={(e) => setTo(e.target.value)} placeholder="+919876543210" inputMode="tel" /></div>
            <div><label className={label}>Call ka maqsad</label><input className={box} value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="Jaise: client ko kal 4 baje ki meeting confirm karo" /></div>
          </div>
          <button onClick={startCall} disabled={busy !== null || !s.outboundEnabled || !to.trim()} className="inline-flex items-center gap-2 rounded-xl bg-ink px-4 py-2.5 text-sm font-medium text-bg disabled:opacity-40">{busy === "call" ? <LoaderCircle size={15} className="animate-spin" /> : <PhoneCall size={15} />} Call karo</button>
          <p className="text-xs text-muted">Chat me bhi bol sakte ho: “mere client ko call karo +91… aur meeting confirm karo”. Agent har call se pehle aapse approval maangta hai.</p>
          <p className="text-xs text-muted">Incoming: apne Twilio number pe call karo, agent uthayega aur ek team member ki tarah baat karega.</p>
        </section>

        {/* Activity */}
        <section className="space-y-3 rounded-2xl border border-line bg-panel p-5">
          <h2 className="font-semibold">Call history</h2>
          {calls.length === 0 ? <p className="text-sm text-muted">Abhi koi call nahi.</p> : (
            <div className="space-y-2">
              {calls.map((c) => (
                <div key={c.id} className="rounded-xl border border-line">
                  <button onClick={() => setOpen(open === c.id ? null : c.id)} className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left text-sm">
                    <span className="w-16 text-xs capitalize text-muted">{c.direction}</span>
                    <span className="min-w-0 flex-1 truncate">{c.direction === "inbound" ? c.from : c.to}</span>
                    <span className="text-xs capitalize text-muted">{c.status} · {c.durationSeconds}s</span>
                    <span className="hidden text-xs text-faint sm:inline">{when(c.createdAt)}</span>
                  </button>
                  {open === c.id && <div className="space-y-1 border-t border-line p-3 text-xs text-muted">{c.goal && <p><b className="text-ink">Goal:</b> {c.goal}</p>}<p className="whitespace-pre-wrap">{c.summary || "Summary call khatam hone ke baad aayegi."}</p></div>}
                </div>
              ))}
            </div>
          )}
        </section>
        <p className="text-xs leading-relaxed text-muted">Consent-based calls hi karo, opt-out maano, aur apne desh ke telemarketing/recording rules follow karo. Agent call ki shuruat me khud ko AI batata hai.</p>
      </div>
    </main>
  );
}