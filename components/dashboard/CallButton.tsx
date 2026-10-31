"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Loader2, Mic, MicOff, Phone, PhoneOff, Square, Volume2, X } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { listChats } from "@/lib/chats";

type Line = { role: "user" | "assistant"; content: string; at: number };
type Pending = { name: string; args: Record<string, unknown>; summary: string };
type Phase = "thinking" | "listening" | "speaking";

const YES = /\b(yes|yeah|yep|ok|okay|sure|go ahead|do it|confirm)\b|haan|han ji|kar do|bhej do|theek hai|ठीक|हाँ|हां|कर दो|भेज दो/i;
const NO = /\b(no|nope|cancel|stop|don'?t)\b|nahi|nahin|mat karo|ruko|नहीं|मत|रुको/i;
const LANGS = [{ id: "", label: "Auto" }, { id: "hi-IN", label: "हिन्दी" }, { id: "en-IN", label: "English" }];
const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9\u0900-\u097f]/g, "");
// a silent, valid WAV: playing it inside the click is what lets the browser play the agent's audio later
const SILENT = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=";

export default function CallButton({ agentName, chatId }: { agentName: string; chatId?: string }) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>("thinking");
  const [lines, setLines] = useState<Line[]>([]);
  const [heardNow, setHeardNow] = useState("");
  const [pending, setPending] = useState<Pending | null>(null);
  const [muted, setMuted] = useState(false);
  const [langIdx, setLangIdx] = useState(0);
  const [typed, setTyped] = useState("");
  const [err, setErr] = useState("");
  const [canListen, setCanListen] = useState(true);

  const recRef = useRef<any>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null); // ONE player, unlocked by the click, reused for every reply
  const histRef = useRef<Line[]>([]);
  const followRef = useRef<string[]>([]);
  const startedRef = useRef(0);
  const chatRef = useRef<string>("");
  const openRef = useRef(false);
  const mutedRef = useRef(false);
  const phaseRef = useRef<Phase>("thinking");
  const pendingRef = useRef<Pending | null>(null);
  const hangupRef = useRef(false);
  const langRef = useRef(0);
  const endingRef = useRef(false);
  const speakId = useRef(0); // a newer reply (or an interrupt) cancels the older one
  const lastSayRef = useRef("");
  const safetyRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setPh = (p: Phase) => { phaseRef.current = p; setPhase(p); };
  const lang = () => LANGS[langRef.current].id || (typeof navigator !== "undefined" ? navigator.language : "") || "en-US";

  const stopListening = useCallback(() => {
    const r = recRef.current;
    recRef.current = null;
    if (r) { r.onend = null; r.onresult = null; r.onerror = null; try { r.abort(); } catch { /* already stopped */ } }
    setHeardNow("");
  }, []);

  const stopSpeaking = useCallback(() => {
    speakId.current++;
    if (safetyRef.current) { clearTimeout(safetyRef.current); safetyRef.current = null; }
    try { window.speechSynthesis?.cancel(); } catch { /* not available */ }
    const a = audioElRef.current;
    if (a) { a.onended = null; a.onerror = null; try { a.pause(); } catch { /* already stopped */ } }
  }, []);

  const call = useCallback(async (payload: Record<string, unknown>) => {
    if (!user) throw new Error("Sign in karo.");
    const res = await fetch("/api/voice/web", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${await user.getIdToken()}` },
      body: JSON.stringify({ uid: user.uid, chatId: chatRef.current, lang: lang(), ...payload }),
      cache: "no-store",
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d.error || `Request failed (HTTP ${res.status}).`);
    return d;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const endCall = useCallback(async () => {
    if (endingRef.current) return;
    endingRef.current = true;
    openRef.current = false;
    stopListening(); stopSpeaking();
    setOpen(false);
    const transcript = histRef.current.map((l) => ({ role: l.role, text: l.content, at: l.at }));
    try { await call({ end: true, transcript, followUps: followRef.current, seconds: Math.round((Date.now() - startedRef.current) / 1000) }); } catch { /* the call is over anyway */ }
    endingRef.current = false;
  }, [call, stopListening, stopSpeaking]);

  const listen = useCallback(() => {
    if (!openRef.current || mutedRef.current || phaseRef.current !== "listening" || recRef.current) return;
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return;
    const rec = new SR();
    rec.lang = lang();
    rec.interimResults = true;
    rec.continuous = false;
    rec.onresult = (e: any) => {
      let finalText = "", interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = String(e.results[i][0]?.transcript ?? "");
        if (e.results[i].isFinal) finalText += t; else interim += t;
      }
      setHeardNow(interim || finalText);
      if (finalText.trim()) { recRef.current = null; try { rec.abort(); } catch { /* ignore */ } void handleText(finalText.trim()); }
    };
    rec.onerror = (e: any) => {
      if (e?.error === "not-allowed" || e?.error === "service-not-allowed") { setErr("Microphone ki permission do (browser me mic allow karo)."); setCanListen(false); recRef.current = null; }
    };
    rec.onend = () => {
      recRef.current = null;
      setHeardNow("");
      if (openRef.current && !mutedRef.current && phaseRef.current === "listening") setTimeout(listen, 250);
    };
    recRef.current = rec;
    try { rec.start(); } catch { recRef.current = null; }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const afterSpeak = useCallback(() => {
    if (hangupRef.current) { hangupRef.current = false; void endCall(); return; }
    if (!openRef.current) return;
    setPh("listening");
    listen();
  }, [endCall, listen]);

  /** The browser's own voice. Long text is spoken sentence by sentence (Chrome stops a long utterance after ~15 s). */
  const speakBrowser = useCallback((text: string, finish: () => void) => {
    const synth = typeof window !== "undefined" ? window.speechSynthesis : undefined;
    if (!synth) { setErr("Is browser me bolne ki suvidha nahi hai. Settings me voice provider (OpenAI/ElevenLabs/local) chuno."); finish(); return; }
    synth.cancel();
    const l = /[\u0900-\u097f]/.test(text) ? "hi-IN" : lang();
    const voices = synth.getVoices();
    const voice = voices.find((v) => v.lang.toLowerCase().replace("_", "-") === l.toLowerCase()) ?? voices.find((v) => v.lang.toLowerCase().startsWith(l.slice(0, 2).toLowerCase()));
    if (l.startsWith("hi") && !voice) setErr("Is device me Hindi voice installed nahi hai: iPad/iPhone me Settings → Accessibility → Spoken Content → Voices → Hindi download karo, ya voice provider key wali chuno.");
    const parts = text.match(/[^.!?।]+[.!?।]*/g)?.map((x) => x.trim()).filter(Boolean) ?? [text];
    let started = false;
    const warn = setTimeout(() => { if (!started) setErr((cur) => cur || "Awaaz nahi aa rahi? Volume aur silent switch check karo, phir 🔊 dabao."); }, 2500);
    parts.forEach((p, i) => {
      const u = new SpeechSynthesisUtterance(p);
      u.lang = l; u.volume = 1; u.rate = 1;
      if (voice) u.voice = voice;
      u.onstart = () => { started = true; clearTimeout(warn); };
      u.onerror = () => { clearTimeout(warn); finish(); };
      if (i === parts.length - 1) u.onend = () => { clearTimeout(warn); finish(); };
      synth.speak(u);
    });
  }, []);

  const speak = useCallback((text: string, audio?: { b64: string; mime: string } | null) => {
    stopListening(); stopSpeaking();
    lastSayRef.current = text;
    setPh("speaking");
    const id = ++speakId.current;
    let done = false;
    const finish = () => {
      if (done || id !== speakId.current) return;
      done = true;
      if (safetyRef.current) { clearTimeout(safetyRef.current); safetyRef.current = null; }
      afterSpeak();
    };
    // if the browser never reports the end of the speech (a known iOS bug), the call must not hang
    safetyRef.current = setTimeout(finish, 6000 + text.length * 110);
    // a short pause after the microphone stops: iOS stays silent if speech starts at the same instant
    setTimeout(() => {
      if (id !== speakId.current) return;
      const el = audioElRef.current;
      if (audio?.b64 && el) {
        el.onended = finish;
        el.onerror = () => speakBrowser(text, finish);
        el.src = `data:${audio.mime};base64,${audio.b64}`;
        el.play().catch(() => speakBrowser(text, finish));
      } else speakBrowser(text, finish);
    }, 300);
  }, [afterSpeak, speakBrowser, stopListening, stopSpeaking]);

  const turn = useCallback(async (payload: Record<string, unknown>, userText?: string) => {
    stopListening();
    setPh("thinking"); setErr("");
    try {
      const d = await call({ ...payload, history: histRef.current.slice(-12).map((l) => ({ role: l.role, content: l.content })) });
      const now = Date.now();
      if (userText) histRef.current.push({ role: "user", content: userText, at: now });
      histRef.current.push({ role: "assistant", content: d.say, at: now + 1 });
      setLines([...histRef.current].slice(-8));
      if (Array.isArray(d.todos)) followRef.current.push(...d.todos);
      pendingRef.current = d.pending ?? null; setPending(d.pending ?? null);
      hangupRef.current = Boolean(d.hangup);
      speak(d.say, d.audio);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Kuch galat hua.");
      if (openRef.current) { setPh("listening"); listen(); }
    }
  }, [call, listen, speak, stopListening]);

  async function handleText(text: string) {
    const p = pendingRef.current;
    if (p) {
      if (YES.test(text)) return approve();
      if (NO.test(text)) return deny();
    }
    setLines((cur) => [...cur, { role: "user" as const, content: text, at: Date.now() }].slice(-8));
    await turn({ text }, text);
  }

  function approve() {
    const p = pendingRef.current;
    if (!p) return;
    pendingRef.current = null; setPending(null);
    setLines((cur) => [...cur, { role: "user" as const, content: "✅ Haan, kar do", at: Date.now() }].slice(-8));
    void turn({ approve: { name: p.name, args: p.args } });
  }
  function deny() {
    const p = pendingRef.current;
    if (!p) return;
    pendingRef.current = null; setPending(null);
    setLines((cur) => [...cur, { role: "user" as const, content: "❌ Nahi", at: Date.now() }].slice(-8));
    void turn({ deny: p.name });
  }

  /** Runs inside the click: this is what unlocks sound for the rest of the call. */
  function unlockSound() {
    try {
      const el = audioElRef.current ?? new Audio();
      audioElRef.current = el;
      el.src = SILENT;
      void el.play().catch(() => undefined);
    } catch { /* no audio element */ }
    try {
      const synth = window.speechSynthesis;
      synth.getVoices();
      const u = new SpeechSynthesisUtterance(" ");
      u.volume = 0;
      synth.speak(u);
    } catch { /* no speech synthesis */ }
  }

  async function begin() {
    if (!user) return;
    unlockSound(); // must happen before any await
    histRef.current = []; followRef.current = []; setLines([]); setErr(""); setPending(null); pendingRef.current = null;
    startedRef.current = Date.now(); openRef.current = true; mutedRef.current = false; setMuted(false); endingRef.current = false;
    setCanListen(Boolean((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition));
    setOpen(true);
    // the call goes to the agent of THIS chat: the id is given, or found by the agent's name
    let id = chatId || "";
    if (!id) {
      try { id = (await listChats(user.uid)).find((c) => norm(c.agentName) === norm(agentName))?.id ?? ""; } catch { /* the newest chat is used */ }
    }
    chatRef.current = id;
    void turn({ first: true });
  }

  function toggleMute() {
    const m = !mutedRef.current;
    mutedRef.current = m; setMuted(m);
    if (m) stopListening(); else if (phaseRef.current === "listening") listen();
  }
  function interrupt() { stopSpeaking(); afterSpeak(); }
  function replay() {
    unlockSound();
    if (lastSayRef.current) speak(lastSayRef.current, null);
  }
  function cycleLang() {
    langRef.current = (langRef.current + 1) % LANGS.length; setLangIdx(langRef.current);
    stopListening(); if (phaseRef.current === "listening") listen();
  }

  useEffect(() => {
    // the list of voices loads late in most browsers
    try { window.speechSynthesis?.getVoices(); window.speechSynthesis?.addEventListener?.("voiceschanged", () => window.speechSynthesis.getVoices()); } catch { /* ignore */ }
    return () => { openRef.current = false; stopListening(); stopSpeaking(); };
  }, [stopListening, stopSpeaking]);

  const label = phase === "thinking" ? "Soch raha hai…" : phase === "speaking" ? "Bol raha hai…" : muted ? "Mic band" : "Sun raha hai…";

  return (
    <>
      <button type="button" aria-label={`Call ${agentName}`} title={`Call ${agentName} (voice)`} onClick={() => void begin()} className="rounded-full p-2 text-muted hover:bg-panel2 hover:text-ink">
        <Phone size={18} />
      </button>
      {open && typeof document !== "undefined" && createPortal(
        <div className="fixed inset-0 z-50 flex flex-col items-center overflow-y-auto bg-bg/95 px-6 py-8 backdrop-blur">
          <p className="text-xs uppercase tracking-wide text-muted">Call with</p>
          <h2 className="text-xl font-semibold text-ink">{agentName}</h2>
          <p className="mt-1 text-xs text-gold">{label}</p>

          <div className={`my-6 flex h-28 w-28 items-center justify-center rounded-full bg-goldSoft text-gold ${phase !== "thinking" && !muted ? "animate-pulse" : ""}`}>
            {phase === "thinking" ? <Loader2 size={36} className="animate-spin" /> : <Phone size={36} />}
          </div>

          <div className="w-full max-w-md flex-1 space-y-2 overflow-y-auto">
            {lines.map((l, i) => (
              <p key={i} className={`rounded-xl px-3 py-2 text-sm ${l.role === "assistant" ? "bg-panel text-ink" : "ml-8 bg-panel2 text-ink"}`}>{l.content}</p>
            ))}
            {heardNow && <p className="ml-8 rounded-xl border border-line px-3 py-2 text-sm text-muted">{heardNow}</p>}
            {err && <p className="rounded-xl border border-gold/50 px-3 py-2 text-xs text-gold">{err}</p>}
          </div>

          {pending && (
            <div className="mt-3 w-full max-w-md rounded-xl border border-gold/50 bg-panel p-3">
              <p className="text-xs text-muted">Agent ye karna chahta hai:</p>
              <p className="mt-1 text-sm text-ink">{pending.summary}</p>
              <div className="mt-3 flex gap-2">
                <button type="button" onClick={approve} className="flex flex-1 items-center justify-center gap-1.5 rounded-full bg-gold px-3 py-2 text-sm font-medium text-bg"><Check size={15} /> Haan</button>
                <button type="button" onClick={deny} className="flex flex-1 items-center justify-center gap-1.5 rounded-full border border-line px-3 py-2 text-sm text-ink"><X size={15} /> Nahi</button>
              </div>
              <p className="mt-2 text-[11px] text-faint">Bol bhi sakte ho: &ldquo;haan&rdquo; ya &ldquo;nahi&rdquo;.</p>
            </div>
          )}

          {!canListen && <p className="mt-3 text-xs text-muted">Is browser me voice recognition nahi hai (Chrome ya Safari use karo). Neeche type karke bhi baat kar sakte ho.</p>}
          <input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && typed.trim() && phaseRef.current !== "thinking") { e.preventDefault(); e.stopPropagation(); const t = typed.trim(); setTyped(""); stopSpeaking(); void handleText(t); } }}
            placeholder="Ya yahin type karo…"
            className="mt-3 w-full max-w-md rounded-full border border-line bg-panel px-4 py-2.5 text-sm text-ink placeholder:text-faint focus:border-gold focus:outline-none"
          />

          <div className="mt-5 flex items-center gap-3">
            <button type="button" onClick={toggleMute} aria-label={muted ? "Unmute" : "Mute"} className="rounded-full bg-panel2 p-4 text-ink">{muted ? <MicOff size={20} /> : <Mic size={20} />}</button>
            {phase === "speaking"
              ? <button type="button" onClick={interrupt} aria-label="Interrupt" className="rounded-full bg-panel2 p-4 text-ink"><Square size={20} /></button>
              : <button type="button" onClick={replay} aria-label="Dobara bolo" title="Last jawab dobara bolo" className="rounded-full bg-panel2 p-4 text-ink"><Volume2 size={20} /></button>}
            <button type="button" onClick={cycleLang} className="rounded-full bg-panel2 px-4 py-3 text-sm text-ink">{LANGS[langIdx].label}</button>
            <button type="button" onClick={() => void endCall()} aria-label="End call" className="rounded-full bg-red-600 p-4 text-white"><PhoneOff size={20} /></button>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
