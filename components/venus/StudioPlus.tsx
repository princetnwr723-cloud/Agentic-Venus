"use client";

import { useEffect, useRef, useState } from "react";
import { Clapperboard, Film, Loader2, Sparkles, Upload, X } from "lucide-react";
import ModelPicker from "@/components/dashboard/ModelPicker";
import { useAuth } from "@/lib/auth-context";
import { useKeys } from "@/lib/keys-context";
import { getModelPref, setModelPref } from "@/lib/model-pref";
import { PROVIDERS, providerMeta, type ProviderId } from "@/lib/providers";
import { ASPECTS, type Aspect } from "@/lib/venus-schema";
import { saveProject, type SourceRef, type VenusProject } from "@/lib/venus";
import { runPipeline, type PipelineEnv, type PipelineHooks } from "@/lib/venus-pipeline";
import { findSeconds } from "@/lib/dashboard/helpers";

const input = "w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm text-ink placeholder:text-faint focus:border-gold focus:outline-none";
const MAKE_LENGTHS = [15, 30, 45, 60, 90, 120, 180, 300, 600, 900, 1200, 1800, 2400, 3000, 3600];
const EDIT_LENGTHS = [20, 30, 45, 60, 90, 120, 180, 300, 480];
const MAX_SOURCE_SECONDS = 900;
const MAX_SOURCE_BYTES = 3 * 1024 ** 3;
const label = (s: number) => (s < 90 ? `${s} seconds` : s % 60 === 0 ? `${s / 60} minutes` : `${Math.round((s / 60) * 10) / 10} minutes`);

function videoDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const v = document.createElement("video");
    const url = URL.createObjectURL(file);
    const done = (d: number | null) => { URL.revokeObjectURL(url); resolve(d); };
    v.preload = "metadata";
    v.onloadedmetadata = () => done(Number.isFinite(v.duration) ? v.duration : null);
    v.onerror = () => done(null); // the browser cannot read this codec: the studio computer checks it instead
    v.src = url;
  });
}

function putFile(url: string, file: File, onPct: (p: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", file.type || "video/mp4");
    xhr.setRequestHeader("x-upsert", "true");
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onPct(e.loaded / e.total); };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(xhr.status === 413 ? "The video is bigger than the storage limit of your Supabase plan." : `Upload failed (HTTP ${xhr.status}).`)));
    xhr.onerror = () => reject(new Error("Upload failed (network)."));
    xhr.send(file);
  });
}

export default function StudioPlus() {
  const { user } = useAuth();
  const { apiKeys, e2bKey } = useKeys();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"make" | "edit">("make");
  const [brief, setBrief] = useState("");
  const [lenIdx, setLenIdx] = useState(1);
  const [editIdx, setEditIdx] = useState(3);
  const [keepAll, setKeepAll] = useState(false);
  const [aspect, setAspect] = useState<Aspect>("16:9");
  const [matchSource, setMatchSource] = useState(true);
  const design = "ai" as const;
  const [quality, setQuality] = useState<"720p" | "1080p">("720p");
  const [voice, setVoice] = useState(false);
  const [captions, setCaptions] = useState(true);
  const [music, setMusic] = useState(true);
  const [file, setFile] = useState<File | null>(null);
  const [link, setLink] = useState("");
  const [fileInfo, setFileInfo] = useState("");
  const [cfg, setCfg] = useState<{ supabase: boolean; pexels: boolean } | null>(null);
  const [voiceInfo, setVoiceInfo] = useState<{ ready: boolean; provider: string; voice: string; note?: string } | null>(null);
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [progress, setProgress] = useState<{ label: string; value: number | null } | null>(null);
  const [upPct, setUpPct] = useState<number | null>(null);
  const [createdId, setCreatedId] = useState("");
  const cancelRef = useRef(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const pref = typeof window !== "undefined" ? getModelPref() : null;
  const firstProvider = (pref && apiKeys[pref.provider] ? pref.provider : PROVIDERS.find((p) => apiKeys[p.id])?.id ?? PROVIDERS[0].id) as ProviderId;
  const [provider, setProvider] = useState<ProviderId>(firstProvider);
  const [model, setModel] = useState(pref && apiKeys[pref.provider] ? pref.model : providerMeta(firstProvider).models[0]);

  const token = async () => (user ? user.getIdToken() : "");
  useEffect(() => {
    if (!open || !user) return;
    fetch("/api/venus/media").then((r) => r.json()).then(setCfg).catch(() => {});
    (async () => {
      const r = await fetch("/api/venus/media", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + (await token()) }, body: JSON.stringify({ action: "voice-status", uid: user.uid }) });
      const d = await r.json().catch(() => null);
      if (d && typeof d.ready === "boolean") { setVoiceInfo(d); if (!d.ready) setVoice(false); }
    })().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, user]);

  useEffect(() => {
    if (!running) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [running]);

  async function pickFile(f: File | null) {
    setFile(f); setFileInfo("");
    if (!f) return;
    if (!f.type.startsWith("video/") && !/\.(mp4|mov|m4v|webm|mkv|avi)$/i.test(f.name)) { setFile(null); setFileInfo("This is not a video file."); return; }
    if (f.size > MAX_SOURCE_BYTES) { setFile(null); setFileInfo("The file is bigger than 3 GB."); return; }
    const d = await videoDuration(f);
    if (d && d > MAX_SOURCE_SECONDS) { setFile(null); setFileInfo(`This video is ${Math.round(d / 60 * 10) / 10} minutes long. The limit is 15 minutes: please cut it first.`); return; }
    setFileInfo(`${f.name} · ${(f.size / 1024 / 1024).toFixed(1)} MB${d ? ` · ${Math.floor(d / 60)}:${String(Math.round(d % 60)).padStart(2, "0")}` : ""}`);
  }

  const canStart = Boolean(user && e2bKey && brief.trim() && !running && cfg?.supabase !== false && (mode === "make" || file || /^https:\/\//.test(link.trim())));

  async function create() {
    if (!user || !e2bKey || !canStart) return;
    setRunning(true); setLog([]); setCreatedId(""); cancelRef.current = false;
    const env: PipelineEnv = { uid: user.uid, token: () => user.getIdToken(), e2bKey, apiKeys, pexels: Boolean(cfg?.pexels) };
    try {
      const pid = "v" + Date.now().toString(36);
      let source: SourceRef | undefined;
      if (mode === "edit") {
        if (file) {
          setProgress({ label: "Uploading your video", value: 0 });
          const r = await fetch("/api/venus/media", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + (await token()) }, body: JSON.stringify({ action: "source-upload-url", uid: user.uid, pid, name: file.name }) });
          const d = await r.json();
          if (!r.ok) throw new Error(d?.error || "Could not start the upload.");
          setUpPct(0);
          await putFile(d.uploadUrl as string, file, (p) => { setUpPct(p); setProgress({ label: "Uploading your video", value: p }); });
          setUpPct(null);
          source = { kind: "upload", path: d.path as string, name: file.name };
        } else source = { kind: "url", url: link.trim(), name: link.trim().split("/").pop()?.slice(0, 60) };
      }
      // a length written in the brief ("make 45 second") always wins over the slider
      const asked = findSeconds(brief);
      const seconds = asked ? Math.min(mode === "make" ? 3600 : 1200, Math.max(15, asked)) : mode === "make" ? MAKE_LENGTHS[lenIdx] : EDIT_LENGTHS[editIdx];
      const p: VenusProject = {
        id: pid, title: brief.trim().slice(0, 48), brief: brief.trim(), seconds, aspect: mode === "edit" && matchSource ? "16:9" : aspect, theme: "midnight",
        voice: voice && Boolean(voiceInfo?.ready), voiceName: "system", captions, quality, review: true, design, music: mode === "edit" ? music : music, origin: "venus",
        provider, model, stage: "studio", status: "idle", createdAt: Date.now(), updatedAt: Date.now(),
        ...(mode === "edit" ? { mode: "edit" as const, source, keepAll, matchSource } : { mode: "make" as const }),
      };
      await saveProject(user.uid, p).catch(() => {});
      setCreatedId(pid);
      const hooks: PipelineHooks = {
        log: (m) => setLog((l) => [...l.slice(-80), m]), progress: setProgress, update: () => {}, cancelled: () => cancelRef.current,
      };
      await runPipeline(env, hooks, p, "studio");
    } catch (e) {
      setLog((l) => [...l, "⚠️ " + (e instanceof Error ? e.message : "Something failed.")]);
    } finally {
      setRunning(false); setProgress(null); setUpPct(null);
    }
  }

  if (!user) return null;
  return (
    <>
      <button onClick={() => setOpen(true)} className="fixed bottom-4 right-4 z-40 flex items-center gap-2 rounded-full bg-blue-600 px-4 py-2.5 text-sm font-medium text-white shadow-lg hover:bg-blue-500">
        <Clapperboard size={16} /> Studio+ (edit my video · up to 60 min)
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4">
          <div className="my-6 w-full max-w-xl rounded-2xl border border-line bg-panel p-5 shadow-2xl">
            <div className="mb-3 flex items-center justify-between">
              <p className="flex items-center gap-2 text-base font-semibold text-ink"><Film size={18} className="text-gold" /> Venus Pro Studio+</p>
              <button onClick={() => setOpen(false)} className="rounded p-1 text-muted hover:text-ink" aria-label="Close"><X size={18} /></button>
            </div>

            <div className="mb-3 grid grid-cols-2 gap-2">
              {(["make", "edit"] as const).map((m) => (
                <button key={m} disabled={running} onClick={() => setMode(m)} className={`rounded-lg border px-3 py-2 text-sm ${mode === m ? "border-gold bg-gold/10 text-ink" : "border-line text-muted"}`}>
                  {m === "make" ? "Make an animation / motion graphics" : "Edit my own video"}
                </button>
              ))}
            </div>

            {mode === "edit" && (
              <div className="mb-3 rounded-lg border border-line p-3">
                <input ref={fileRef} type="file" accept="video/*,.mkv,.avi,.mov" className="hidden" onChange={(e) => void pickFile(e.target.files?.[0] ?? null)} />
                <button disabled={running} onClick={() => fileRef.current?.click()} className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-line py-3 text-sm text-ink hover:border-gold"><Upload size={16} /> {file ? "Choose another video" : "Upload your video (up to 15 minutes)"}</button>
                {fileInfo && <p className="mt-2 text-xs text-muted">{fileInfo}</p>}
                <input disabled={running || Boolean(file)} value={link} onChange={(e) => setLink(e.target.value)} placeholder="…or paste a direct https link to a video file" className={`${input} mt-2`} />
                <p className="mt-2 text-[11px] text-faint">The agent watches it (shots, silences, speech), cuts it, adds captions, titles and motion graphics where they help, and renders the result.</p>
              </div>
            )}

            <textarea value={brief} onChange={(e) => setBrief(e.target.value)} rows={4} disabled={running}
              placeholder={mode === "edit" ? "What should be done? e.g. Cut the pauses and mistakes, make it a punchy 60-second vertical reel, add captions and an animated intro title." : "Describe the video exactly as you want it: topic, style, scenes, texts. e.g. A 10-minute explainer on how vaccines work, hand-drawn style, calm voice-over."} className={input} />

            <div className="mt-3 grid grid-cols-2 gap-2">
              {mode === "make" ? (
                <label className="col-span-2 text-[11px] text-muted">Length: {findSeconds(brief) ? label(Math.min(3600, Math.max(15, findSeconds(brief) as number))) + " (from your brief)" : label(MAKE_LENGTHS[lenIdx])}
                  <input type="range" min={0} max={MAKE_LENGTHS.length - 1} step={1} value={lenIdx} disabled={running} onChange={(e) => setLenIdx(Number(e.target.value))} className="mt-1 w-full accent-[#E7B24D]" />
                  {MAKE_LENGTHS[lenIdx] > 120 && <span className="block text-[11px] text-faint">Long videos are planned in chapters and rendered in parts. Allow about 1 hour of work for every 3–5 minutes of video.</span>}
                </label>
              ) : (
                <div className="col-span-2 text-[11px] text-muted">
                  <label className="flex items-center gap-2 text-xs text-ink"><input type="checkbox" checked={keepAll} disabled={running} onChange={(e) => setKeepAll(e.target.checked)} /> Keep the whole story (only tighten the dead air)</label>
                  {!keepAll && (<label className="mt-2 block">Target length: {label(EDIT_LENGTHS[editIdx])}
                    <input type="range" min={0} max={EDIT_LENGTHS.length - 1} step={1} value={editIdx} disabled={running} onChange={(e) => setEditIdx(Number(e.target.value))} className="mt-1 w-full accent-[#E7B24D]" /></label>)}
                </div>
              )}
              {mode === "edit" && (
                <label className="col-span-2 flex items-center gap-2 text-xs text-ink"><input type="checkbox" checked={matchSource} disabled={running} onChange={(e) => setMatchSource(e.target.checked)} /> Same shape as my video (landscape / vertical / square)</label>
              )}
              {!(mode === "edit" && matchSource) && (
                <select value={aspect} disabled={running} onChange={(e) => setAspect(e.target.value as Aspect)} className={input}>{(Object.keys(ASPECTS) as Aspect[]).map((a) => <option key={a} value={a}>{ASPECTS[a].label}</option>)}</select>
              )}
              <div className="col-span-2 rounded-lg border border-line px-3 py-2 text-[11px] text-muted">Every video is designed by the agent: new scenes, backgrounds and characters for your topic.</div>
              <select value={quality} disabled={running} onChange={(e) => setQuality(e.target.value as "720p" | "1080p")} className={input}><option value="720p">720p</option><option value="1080p">1080p</option></select>
            </div>

            <div className="mt-3 space-y-1.5">
              <label className={`flex items-center gap-2 text-xs text-ink ${voiceInfo?.ready ? "" : "opacity-50"}`}>
                <input type="checkbox" disabled={!voiceInfo?.ready || running} checked={voice && Boolean(voiceInfo?.ready)} onChange={(e) => setVoice(e.target.checked)} />
                Voice-over with my voice system {voiceInfo?.ready ? `(${voiceInfo.provider}${voiceInfo.voice ? " · " + voiceInfo.voice : ""})` : "(connect a voice in Settings → Voice)"}
              </label>
              {voiceInfo?.note && voiceInfo.ready && <p className="pl-6 text-[11px] text-faint">{voiceInfo.note}</p>}
              <label className="flex items-center gap-2 text-xs text-ink"><input type="checkbox" checked={captions} disabled={running} onChange={(e) => setCaptions(e.target.checked)} /> {mode === "edit" ? "Captions from the speech in my video" : "Captions"}</label>
              <label className="flex items-center gap-2 text-xs text-ink"><input type="checkbox" checked={music} disabled={running} onChange={(e) => setMusic(e.target.checked)} /> New music composed for this video{mode === "edit" ? " (quiet under the speech)" : ""}</label>
            </div>

            <p className="mb-1 mt-3 text-[11px] text-muted">Model (shared with chats)</p>
            <ModelPicker provider={provider} model={model} apiKeys={apiKeys} onChange={(p, m) => { setProvider(p); setModel(m); setModelPref(p, m); }} />

            {!running ? (
              <button onClick={create} disabled={!canStart} className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 py-2.5 text-sm font-medium text-white disabled:opacity-40"><Sparkles size={15} /> {mode === "edit" ? "Edit my video" : "Make my video"}</button>
            ) : (
              <button onClick={() => { cancelRef.current = true; }} className="mt-4 w-full rounded-lg border border-line py-2.5 text-sm text-ink">Stop</button>
            )}
            {!e2bKey && <p className="mt-2 text-center text-[11px] text-faint">Add your E2B key in Settings first: the studio computer renders the video.</p>}
            {cfg?.supabase === false && <p className="mt-2 text-center text-[11px] text-faint">Supabase storage is not configured on this server.</p>}
            <p className="mt-2 text-center text-[11px] text-faint">Keep this tab open while the video is made.</p>

            {(running || log.length > 0) && (
              <div className="mt-3 rounded-lg border border-line bg-bg p-3">
                {progress && (
                  <div className="mb-2">
                    <p className="flex items-center gap-2 text-xs text-ink">{running && <Loader2 size={13} className="animate-spin" />} {progress.label}{progress.value !== null ? ` · ${Math.round(progress.value * 100)}%` : ""}</p>
                    {progress.value !== null && <div className="mt-1 h-1.5 overflow-hidden rounded bg-line"><div className="h-full bg-gold" style={{ width: `${Math.round(progress.value * 100)}%` }} /></div>}
                  </div>
                )}
                {upPct !== null && <p className="mb-1 text-[11px] text-muted">Upload {Math.round(upPct * 100)}%</p>}
                <div className="max-h-48 space-y-1 overflow-y-auto text-[11px] text-muted">{log.slice(-14).map((m, i) => <p key={i}>{m}</p>)}</div>
                {createdId && <a href={`/venus?project=${createdId}`} className="mt-2 block rounded-lg bg-gold/10 py-2 text-center text-xs font-medium text-ink hover:bg-gold/20">Open this video in the editor →</a>}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
