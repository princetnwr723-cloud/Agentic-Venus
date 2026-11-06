"use client";

import { useCallback, useEffect, useState } from "react";
import { Clapperboard, Loader2, Trash2, Upload, X } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { uploadAttachment } from "@/lib/attach-client";
import { TEMPLATE_CATEGORIES, type TemplateListItem } from "@/lib/venus-clone";

type Props = {
  open: boolean;
  onClose: () => void;
  chatId: string;
  agentName: string;
  /** Starts the video: the brief contains the details and the [template:id] marker. */
  onMake: (brief: string) => void;
  /** The owner's video is uploaded: Venus Pro studies it and saves the template. */
  onAnalyze: (att: { id: string; name: string }, meta: { name?: string; category?: string; hint?: string }) => void;
};

const STR = {
  en: {
    signIn: "Please sign in.", needProduct: "Enter the product or brand name.", needFile: "Choose a video first.",
    subtitle: "Save the look, pace and structure of any video, then make new videos in the same style.", empty: "No templates yet. Add a video under “Save a new template”.",
    featuresPh: "Key features (one per line)", pickFile: "Choose a video (up to 15 minutes)", namePh: "Template name (optional)",
    hintPh: "What should it focus on? (optional, for example pacing, text style)", note: "The analysis takes 5-10 minutes. Progress shows above the chat and the template appears in the chat.",
    lenAuto: "Length: like the template", voiceAuto: "Voice: the agent decides", voiceOn: "Add a voice-over", voiceOff: "Music only",
  },
  hi: {
    signIn: "Sign in karo.", needProduct: "Product ya brand ka naam likho.", needFile: "Pehle ek video chuno.",
    subtitle: "Kisi bhi video ka look, pace aur structure save karo, phir usi jaisi nayi video bana lo.", empty: "Abhi koi template nahi hai. “Save a new template” me ek video daalo.",
    featuresPh: "Key features (ek line me ek)", pickFile: "Ek video chuno (15 minute tak)", namePh: "Template ka naam (optional)",
    hintPh: "Kis cheez par dhyan dena hai? (optional, jaise pacing, text style)", note: "Analysis me 5-10 minute lagte hain. Progress chat ke upar dikhta hai aur template chat me aa jaata hai.",
    lenAuto: "Length: template jaisi", voiceAuto: "Voice: agent decide kare", voiceOn: "Voice-over chahiye", voiceOff: "Sirf music",
  },
} as const;

const field = "w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm text-ink placeholder:text-faint focus:border-gold focus:outline-none";

export default function TemplateModal({ open, onClose, chatId, agentName, onMake, onAnalyze }: Props) {
  const { user } = useAuth();
  // English everywhere; Hindi (Roman) when the browser language is Hindi
  const [hi, setHi] = useState(false);
  useEffect(() => { if (typeof navigator !== "undefined" && /^hi\b/i.test(navigator.language)) setHi(true); }, []);
  const t = hi ? STR.hi : STR.en;
  const [tab, setTab] = useState<"make" | "save">("make");
  const [list, setList] = useState<TemplateListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [pick, setPick] = useState("");
  // make
  const [product, setProduct] = useState("");
  const [pitch, setPitch] = useState("");
  const [features, setFeatures] = useState("");
  const [cta, setCta] = useState("");
  const [site, setSite] = useState("");
  const [notes, setNotes] = useState("");
  const [len, setLen] = useState("");
  const [voice, setVoice] = useState<"auto" | "on" | "off">("auto");
  // save
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [category, setCategory] = useState("launch");
  const [hint, setHint] = useState("");
  const [uploading, setUploading] = useState<number | null>(null);

  const api = useCallback(async (action: string, extra: Record<string, unknown> = {}) => {
    if (!user) throw new Error(t.signIn);
    const res = await fetch("/api/venus/template", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + (await user.getIdToken()) },
      body: JSON.stringify({ action, uid: user.uid, ...extra }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || `Request failed (HTTP ${res.status}).`);
    return data;
  }, [user]);

  const refresh = useCallback(async () => {
    setLoading(true); setErr("");
    try {
      const d = await api("list");
      const t = (d.templates ?? []) as TemplateListItem[];
      setList(t);
      setPick((cur) => (t.some((x) => x.id === cur) ? cur : t[0]?.id ?? ""));
      if (!t.length) setTab("save");
    } catch (e) { setErr(e instanceof Error ? e.message : "Could not load the templates."); }
    finally { setLoading(false); }
  }, [api]);

  useEffect(() => { if (open) void refresh(); }, [open, refresh]);

  if (!open) return null;
  const chosen = list.find((t) => t.id === pick);

  function make() {
    if (!chosen) return;
    if (!product.trim()) { setErr(t.needProduct); return; }
    const lines = [`Make a ${chosen.category} video for ${product.trim()}.`];
    if (pitch.trim()) lines.push(`Tagline / pitch: ${pitch.trim()}`);
    const feats = features.split("\n").map((x) => x.trim()).filter(Boolean);
    if (feats.length) lines.push("Key features:\n" + feats.map((x) => "- " + x).join("\n"));
    if (cta.trim()) lines.push(`Call to action: ${cta.trim()}`);
    if (site.trim()) lines.push(`Website: ${site.trim()}`);
    if (notes.trim()) lines.push(notes.trim());
    if (len) lines.push(`Length: ${len} seconds.`);
    if (voice === "on") lines.push("Add a voice-over.");
    if (voice === "off") lines.push("No voice-over, music only.");
    lines.push(`[template:${chosen.id}]`);
    onMake(lines.join("\n"));
    onClose();
  }

  async function analyze() {
    if (!file) { setErr(t.needFile); return; }
    setErr(""); setUploading(0);
    try {
      const id = await uploadAttachment(file, chatId, (p) => setUploading(p));
      onAnalyze({ id, name: file.name }, { name: name.trim() || undefined, category, hint: hint.trim() || undefined });
      setFile(null); setName(""); setHint(""); setUploading(null);
      onClose();
    } catch (e) {
      setUploading(null);
      setErr(e instanceof Error ? e.message : "Upload failed.");
    }
  }

  async function remove(id: string) {
    try { await api("delete", { id }); await refresh(); } catch (e) { setErr(e instanceof Error ? e.message : "Could not delete."); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-line bg-panel p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-base font-semibold text-ink"><Clapperboard size={18} className="text-gold" /> Video templates</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-full p-1.5 text-muted hover:bg-panel2 hover:text-ink"><X size={16} /></button>
        </div>
        <p className="mt-1 text-xs text-muted">{t.subtitle} · {agentName}</p>

        <div className="mt-4 flex gap-2">
          {(["make", "save"] as const).map((t) => (
            <button key={t} type="button" onClick={() => { setTab(t); setErr(""); }} className={`rounded-full px-3 py-1.5 text-xs ${tab === t ? "bg-gold font-medium text-bg" : "bg-panel2 text-muted hover:text-ink"}`}>
              {t === "make" ? "Make from a template" : "Save a new template"}
            </button>
          ))}
        </div>

        {err && <p className="mt-3 rounded-lg border border-gold/50 px-3 py-2 text-xs text-gold">{err}</p>}

        {tab === "make" && (
          <div className="mt-4 space-y-3">
            {loading && <p className="flex items-center gap-2 text-xs text-muted"><Loader2 size={14} className="animate-spin" /> Loading…</p>}
            {!loading && !list.length && <p className="text-xs text-muted">{t.empty}</p>}
            <div className="space-y-2">
              {list.map((t) => (
                <div key={t.id} className={`flex items-start gap-2 rounded-xl border p-3 ${pick === t.id ? "border-gold bg-goldSoft" : "border-line"}`}>
                  <button type="button" onClick={() => setPick(t.id)} className="min-w-0 flex-1 text-left">
                    <p className="truncate text-sm font-medium text-ink">{t.name}</p>
                    <p className="text-[11px] text-muted">{t.category} · {t.seconds}s · {t.aspect}</p>
                    {t.summary && <p className="mt-1 line-clamp-2 text-xs text-muted">{t.summary}</p>}
                  </button>
                  <button type="button" onClick={() => void remove(t.id)} aria-label="Delete template" className="rounded-full p-1.5 text-faint hover:bg-panel2 hover:text-ink"><Trash2 size={14} /></button>
                </div>
              ))}
            </div>
            {chosen && (
              <div className="space-y-2.5 border-t border-line pt-3">
                <input className={field} value={product} onChange={(e) => setProduct(e.target.value)} placeholder="Product / brand name *" />
                <input className={field} value={pitch} onChange={(e) => setPitch(e.target.value)} placeholder="Tagline or one-line pitch" />
                <textarea className={field} rows={3} value={features} onChange={(e) => setFeatures(e.target.value)} placeholder={t.featuresPh} />
                <div className="grid grid-cols-2 gap-2">
                  <input className={field} value={cta} onChange={(e) => setCta(e.target.value)} placeholder="Call to action" />
                  <input className={field} value={site} onChange={(e) => setSite(e.target.value)} placeholder="Website / handle" />
                </div>
                <textarea className={field} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Extra notes (optional)" />
                <div className="grid grid-cols-2 gap-2">
                  <select className={field} value={len} onChange={(e) => setLen(e.target.value)}>
                    <option value="">{t.lenAuto} ({chosen.seconds}s)</option>
                    {[15, 30, 45, 60, 90].map((n) => <option key={n} value={n}>{n} seconds</option>)}
                  </select>
                  <select className={field} value={voice} onChange={(e) => setVoice(e.target.value as "auto" | "on" | "off")}>
                    <option value="auto">{t.voiceAuto}</option>
                    <option value="on">{t.voiceOn}</option>
                    <option value="off">{t.voiceOff}</option>
                  </select>
                </div>
                <button type="button" onClick={make} className="w-full rounded-full bg-gold px-4 py-2.5 text-sm font-medium text-bg">Make the video</button>
              </div>
            )}
          </div>
        )}

        {tab === "save" && (
          <div className="mt-4 space-y-2.5">
            <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-line px-3 py-4 text-sm text-muted hover:border-gold">
              <Upload size={16} />
              <span className="min-w-0 flex-1 truncate">{file ? file.name : t.pickFile}</span>
              <input type="file" accept="video/*" hidden onChange={(e) => { setFile(e.target.files?.[0] ?? null); e.target.value = ""; }} />
            </label>
            <input className={field} value={name} onChange={(e) => setName(e.target.value)} placeholder={t.namePh} />
            <select className={field} value={category} onChange={(e) => setCategory(e.target.value)}>
              {TEMPLATE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <textarea className={field} rows={2} value={hint} onChange={(e) => setHint(e.target.value)} placeholder={t.hintPh} />
            <button type="button" disabled={!file || uploading !== null} onClick={() => void analyze()} className="flex w-full items-center justify-center gap-2 rounded-full bg-gold px-4 py-2.5 text-sm font-medium text-bg disabled:opacity-50">
              {uploading !== null ? <><Loader2 size={15} className="animate-spin" /> Uploading {Math.round(uploading * 100)}%</> : "Analyse and save template"}
            </button>
            <p className="text-[11px] text-faint">{t.note}</p>
          </div>
        )}
      </div>
    </div>
  );
}
