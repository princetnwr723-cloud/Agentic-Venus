"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle, ArrowLeft, ChevronDown, Circle, Copy, Download, Film, Image as ImageIcon, Layers, Loader2, Pause,
  Play, Plus, Redo2, Scissors, Sparkles, SquareIcon, Trash2, Type, Undo2, Volume2, VolumeX, Wand2, ZoomIn, ZoomOut, Box, MousePointer2, SkipBack, SkipForward,
} from "lucide-react";
import BotAvatar from "@/components/BotAvatar";
import ModelPicker from "@/components/dashboard/ModelPicker";
import { useAuth } from "@/lib/auth-context";
import { useKeys } from "@/lib/keys-context";
import { getModelPref, setModelPref } from "@/lib/model-pref";
import { PROVIDERS, providerMeta, type ProviderId } from "@/lib/providers";
import {
  ASPECTS, FONT_NAMES, OVERLAP, TRANSITIONS, CAMERA_MOVES, THEMES, sanitizeStoryboard, sceneLayout,
  summarizeScene, totalFramesOf, type Aspect, type Scene, type Storyboard,
} from "@/lib/venus-schema";
import { deleteProject, listProjects, saveProject, type VenusProject } from "@/lib/venus";
import { ensureStudio, genCode, newRun, parseSb, regenVoice, renderKind, runPipeline, signedUrl, studioCall, type PipelineEnv, type PipelineHooks } from "@/lib/venus-pipeline";

const TYPE_COLOR: Record<string, string> = {
  title: "#5b8cff", kinetic: "#a66bff", bullets: "#2de2a6", stat: "#ff7a45", "bar-chart": "#e7b24d", "line-chart": "#e7b24d",
  quote: "#ff4d8d", split: "#7ae0ff", timeline: "#2de2a6", ranking: "#ff7a45", image: "#9aa0a6", footage: "#9aa0a6", outro: "#5b8cff", custom: "#f5f5f5",
};
const DEFAULTS: Record<string, Record<string, unknown>> = {
  title: { headline: "New title", subhead: "" }, kinetic: { text: "Your punchy line goes here", emphasis: [] },
  bullets: { headline: "Key points", items: ["First", "Second", "Third"] }, stat: { label: "Metric", value: 100, suffix: "%" },
  "bar-chart": { headline: "Comparison", data: [{ label: "A", value: 40 }, { label: "B", value: 70 }] },
  "line-chart": { headline: "Trend", data: [{ label: "Q1", value: 10 }, { label: "Q2", value: 25 }, { label: "Q3", value: 40 }] },
  quote: { text: "A memorable quote", author: "" }, split: { headline: "Versus", left: { title: "Before", points: ["…"] }, right: { title: "After", points: ["…"] } },
  timeline: { headline: "Steps", steps: [{ label: "One", text: "…" }, { label: "Two", text: "…" }, { label: "Three", text: "…" }] },
  ranking: { headline: "Top picks", items: [{ title: "First" }, { title: "Second" }, { title: "Third" }] },
  image: { headline: "Headline", imageQuery: "city skyline" }, footage: { headline: "Headline", footageQuery: "city timelapse" }, outro: { headline: "Thanks for watching", handle: "@you" },
};
const HIDDEN = new Set(["type", "seconds", "transition", "narration", "voice", "image", "video", "code", "id", "fontScale", "brief", "camera"]);
const VOICES = ["nova", "alloy", "echo", "fable", "onyx", "shimmer"];
const input = "w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm text-ink placeholder:text-faint focus:border-gold focus:outline-none";
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const ease = (v: number) => 1 - Math.pow(1 - clamp(v, 0, 1), 3);
const mmss = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;
const txtOf = (v: any): string => (typeof v === "string" ? v : v?.title ?? v?.label ?? v?.text ?? "");

// ---------- live animatic (instant, no render) ----------
function Animatic({ sb, t, W, H }: { sb: Storyboard; t: number; W: number; H: number }) {
  const L = sceneLayout(sb);
  const f = t * 30;
  let i = L.findIndex((x) => f >= x.from && f < x.from + x.dur - OVERLAP);
  if (i < 0) i = f >= (L[L.length - 1]?.from ?? 0) ? L.length - 1 : 0;
  const s: any = sb.scenes[i];
  if (!s) return null;
  const local = Math.max(0, f - L[i].from) / 30;
  const dur = L[i].dur / 30;
  const th = THEMES.find((x) => x.id === sb.theme) ?? THEMES[0];
  const pal = sb.palette ?? {};
  const bg1 = pal.bg1 ?? th.colors[0], bg2 = pal.bg2 ?? th.colors[0], a = pal.accent ?? th.colors[1], b = pal.accent2 ?? th.colors[2];
  const text = pal.text ?? (th.id === "paper" ? "#16161a" : "#f4f6ff"), muted = pal.muted ?? "#9aa6d6";
  const e = ease(local / 0.55);
  const x = ease((local - (dur - 0.45)) / 0.45);
  const p = local / dur;
  const moves: string[] = Array.isArray(s.camera) ? s.camera : [];
  let sc = 1, tx = 0, ty = 0, rot = 0;
  for (const m of moves) {
    if (m === "push") sc += 0.12 * p; else if (m === "pull") sc += 0.12 * (1 - p);
    else if (m === "pan-left") tx += W * 0.03 * (1 - 2 * p); else if (m === "pan-right") tx += W * 0.03 * (2 * p - 1);
    else if (m === "tilt-up") ty += H * 0.03 * (2 * p - 1); else if (m === "tilt-down") ty += H * 0.03 * (1 - 2 * p);
    else if (m === "orbit") { rot += 2.2 * (2 * p - 1); sc += 0.05; }
    else if (m === "handheld") { tx += Math.sin(f * 0.12) * W * 0.004; ty += Math.cos(f * 0.1) * H * 0.004; }
    else if (m === "crash-zoom") sc += 0.45 * Math.max(0, 1 - local / 0.4);
  }
  const big = Math.min(W, H) * 0.1;
  const items: string[] = (s.items ?? s.steps ?? []).map(txtOf).slice(0, 5);
  const data: Array<{ label: string; value: number }> = (s.data ?? []).slice(0, 6).map((d: any) => ({ label: txtOf(d), value: Number(d?.value) || 0 }));
  const maxV = Math.max(1, ...data.map((d) => d.value));
  const head = s.headline ?? s.text ?? s.label ?? s.title ?? s.brief ?? "";
  let body: any;
  if (s.type === "stat") {
    body = (<div style={{ textAlign: "center" }}><div style={{ color: muted, fontSize: big * 0.4, letterSpacing: "0.15em", textTransform: "uppercase" }}>{s.label}</div><div style={{ color: text, fontSize: big * 2.2, fontWeight: 800 }}>{s.prefix}{Math.round((Number(s.value) || 0) * e).toLocaleString()}<span style={{ color: a }}>{s.suffix}</span></div></div>);
  } else if (s.type === "bar-chart" || s.type === "line-chart") {
    body = (<div style={{ width: "80%" }}><div style={{ color: text, fontSize: big * 0.7, fontWeight: 800, marginBottom: big * 0.4 }}>{s.headline}</div>{data.map((d, k) => (<div key={k} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: big * 0.18 }}><span style={{ color: muted, width: "22%", fontSize: big * 0.38 }}>{d.label}</span><div style={{ flex: 1, height: big * 0.32, background: "rgba(255,255,255,0.08)", borderRadius: 99 }}><div style={{ width: `${(d.value / maxV) * 100 * e}%`, height: "100%", background: `linear-gradient(90deg,${a},${b})`, borderRadius: 99 }} /></div></div>))}</div>);
  } else if (["bullets", "ranking", "timeline"].includes(s.type)) {
    body = (<div style={{ width: "80%" }}><div style={{ color: text, fontSize: big * 0.8, fontWeight: 800, marginBottom: big * 0.35 }}>{s.headline}</div>{items.map((it, k) => { const ek = ease((local - 0.25 - k * 0.12) / 0.4); return <div key={k} style={{ opacity: ek, transform: `translateX(${(1 - ek) * -30}px)`, color: text, fontSize: big * 0.5, padding: `${big * 0.12}px ${big * 0.3}px`, marginBottom: big * 0.12, borderRadius: 12, background: "rgba(255,255,255,0.07)" }}><b style={{ color: a }}>{k + 1}. </b>{it}</div>; })}</div>);
  } else if (s.type === "split") {
    body = (<div style={{ display: "flex", gap: 14, width: "84%" }}>{[s.left, s.right].map((c: any, k: number) => (<div key={k} style={{ flex: 1, padding: big * 0.35, borderRadius: 16, background: "rgba(255,255,255,0.07)", color: text }}><div style={{ color: k ? b : a, fontWeight: 800, fontSize: big * 0.6 }}>{txtOf(c?.title ?? c)}</div>{(c?.points ?? []).slice(0, 3).map((pt: any, j: number) => <div key={j} style={{ fontSize: big * 0.38, marginTop: 6 }}>• {txtOf(pt)}</div>)}</div>))}</div>);
  } else {
    body = (<div style={{ textAlign: "center", width: "82%" }}>{s.type === "custom" && <div style={{ color: a, fontSize: big * 0.3, marginBottom: 6 }}>✦ AI-designed scene</div>}<div style={{ color: text, fontSize: big * (String(head).length > 40 ? 0.9 : 1.3), fontWeight: 800, lineHeight: 1.08, letterSpacing: "-0.02em" }}>{head}</div>{s.subhead && <div style={{ color: muted, fontSize: big * 0.5, marginTop: 10 }}>{s.subhead}</div>}{(s.type === "image" || s.type === "footage") && <div style={{ color: muted, fontSize: big * 0.3, marginTop: 8 }}>🎞 {s.imageQuery ?? s.footageQuery}</div>}</div>);
  }
  return (
    <div style={{ width: W, height: H, background: `linear-gradient(135deg,${bg1},${bg2})`, position: "relative", overflow: "hidden", fontFamily: "Inter, system-ui, sans-serif" }}>
      <div style={{ position: "absolute", width: W * 0.8, height: W * 0.8, borderRadius: "50%", left: -W * 0.2 + Math.sin(t) * 20, top: -W * 0.3, background: `radial-gradient(circle,${a}55,transparent 65%)` }} />
      <div style={{ position: "absolute", width: W * 0.9, height: W * 0.9, borderRadius: "50%", right: -W * 0.3, bottom: -W * 0.4 + Math.cos(t) * 20, background: `radial-gradient(circle,${b}44,transparent 65%)` }} />
      <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", opacity: e * (1 - x), transform: `translate(${tx}px,${ty}px) rotate(${rot}deg) scale(${sc})` }}>{body}</div>
      {sb.captions && s.narration && <div style={{ position: "absolute", bottom: H * 0.06, left: "10%", right: "10%", textAlign: "center", color: "#fff", fontWeight: 700, fontSize: big * 0.38, textShadow: "0 2px 8px #000" }}>{s.narration}</div>}
    </div>
  );
}

function Field({ label, value, onChange }: { label: string; value: unknown; onChange: (v: unknown) => void }) {
  const [txt, setTxt] = useState("");
  const [err, setErr] = useState(false);
  const isStr = typeof value === "string", isNum = typeof value === "number";
  const isLines = Array.isArray(value) && value.every((x) => typeof x === "string");
  useEffect(() => { if (isStr || isNum) return; setTxt(isLines ? (value as string[]).join("\n") : JSON.stringify(value, null, 2)); setErr(false); }, [value, isStr, isNum, isLines]);
  return (
    <label className="block text-[11px] text-muted">{label}
      {isStr ? ((value as string).length > 60 ? <textarea className={`${input} mt-1`} rows={3} value={value as string} onChange={(e) => onChange(e.target.value)} /> : <input className={`${input} mt-1`} value={value as string} onChange={(e) => onChange(e.target.value)} />)
        : isNum ? <input type="number" className={`${input} mt-1`} value={value as number} onChange={(e) => onChange(Number(e.target.value))} />
        : <textarea className={`${input} mt-1 font-mono text-[11px] ${err ? "border-red-500" : ""}`} rows={isLines ? 3 : 6} value={txt} onChange={(e) => setTxt(e.target.value)} onBlur={() => { try { onChange(isLines ? txt.split("\n").map((l) => l.trim()).filter(Boolean) : JSON.parse(txt)); setErr(false); } catch { setErr(true); } }} />}
    </label>
  );
}

const Sec = ({ title, children }: { title: string; children: any }) => (
  <div className="border-t border-line px-4 py-3"><p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-faint">{title}</p>{children}</div>
);

export default function VenusPage() {
  const { user, loading: authLoading } = useAuth();
  const { apiKeys, e2bKey, loading: keysLoading } = useKeys();
  const router = useRouter();

  const [projects, setProjects] = useState<VenusProject[]>([]);
  const [activeId, setActiveId] = useState("list");
  const [cfg, setCfg] = useState<{ supabase: boolean; pexels: boolean } | null>(null);
  const [urls, setUrls] = useState<{ scene?: string; preview?: string; final?: string }>({});
  const [mode, setMode] = useState<"live" | "video">("live");
  const [vkind, setVkind] = useState<"scene" | "preview" | "final">("preview");
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [zoomC, setZoomC] = useState(100);
  const [zoomT, setZoomT] = useState(1);
  const [tool, setTool] = useState<"select" | "razor">("select");
  const [sel, setSel] = useState(0);
  const [tab, setTab] = useState<"project" | "agent">("project");
  const [log, setLog] = useState<string[]>([]);
  const [progress, setProgress] = useState<{ label: string; value: number | null } | null>(null);
  const [running, setRunning] = useState(false);
  const [aiText, setAiText] = useState("");
  const [scope, setScope] = useState<"scene" | "video">("scene");
  const [chat, setChat] = useState<Array<{ who: "me" | "agent"; text: string }>>([]);
  const [showCode, setShowCode] = useState(false);
  const [showLayers, setShowLayers] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [trim, setTrim] = useState<{ i: number; seconds: number } | null>(null);
  const [, force] = useState(0);
  const cancelRef = useRef(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const hist = useRef<{ past: string[]; future: string[] }>({ past: [], future: [] });
  const askRef = useRef<HTMLInputElement>(null);

  const pref = typeof window !== "undefined" ? getModelPref() : null;
  const firstProvider = (pref && apiKeys[pref.provider] ? pref.provider : PROVIDERS.find((p) => apiKeys[p.id])?.id ?? PROVIDERS[0].id) as ProviderId;
  const [provider, setProvider] = useState<ProviderId>(firstProvider);
  const [model, setModel] = useState(pref && apiKeys[pref.provider] ? pref.model : providerMeta(firstProvider).models[0]);
  const [brief, setBrief] = useState("");
  const [seconds, setSeconds] = useState(30);
  const [aspect, setAspect] = useState<Aspect>("16:9");
  const [voice, setVoice] = useState(false);
  const [design, setDesign] = useState<"ai" | "library">("ai");
  const [quality, setQuality] = useState<"720p" | "1080p">("720p");
  const openaiKey = apiKeys.openai;

  const project = projects.find((p) => p.id === activeId) ?? null;
  const sb = project ? parseSb(project) : null;
  const L = useMemo(() => (sb ? sceneLayout(sb) : []), [sb]);
  const dur = sb ? totalFramesOf(sb) / 30 : 0;
  const selIdx = sb ? clamp(sel, 0, sb.scenes.length - 1) : 0;
  const scene: Scene | null = sb ? sb.scenes[selIdx] ?? null : null;
  const pps = 56 * zoomT;

  useEffect(() => { if (!authLoading && !user) router.replace("/"); }, [authLoading, user, router]);
  useEffect(() => {
    if (!user) return;
    listProjects(user.uid).then((l) => { setProjects(l); const w = new URLSearchParams(window.location.search).get("project"); if (w && l.some((p) => p.id === w)) setActiveId(w); }).catch(() => {});
    fetch("/api/venus/media").then((r) => r.json()).then(setCfg).catch(() => {});
  }, [user]);

  const env = (): PipelineEnv => ({ uid: user!.uid, token: () => user!.getIdToken(), e2bKey: e2bKey as string, apiKeys, pexels: Boolean(cfg?.pexels) });
  const hooks = (): PipelineHooks => ({
    log: (m) => setLog((p) => [...p.slice(-60), m]), progress: setProgress,
    update: (p) => setProjects((prev) => prev.map((x) => (x.id === p.id ? p : x))), cancelled: () => cancelRef.current,
  });

  useEffect(() => {
    setUrls({}); setSel(0); setT(0); setPlaying(false); setMode("live"); hist.current = { past: [], future: [] };
    if (!user || !project) return;
    (["preview", "final"] as const).forEach(async (k) => {
      const path = k === "preview" ? project.previewPath : project.finalPath;
      if (!path) return;
      try { const u = await signedUrl(env(), path, k === "final" ? "venus-" + project.id + ".mp4" : undefined); setUrls((p) => ({ ...p, [k]: u })); } catch { /* later */ }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, project?.previewPath, project?.finalPath, user]);

  // live playback clock
  useEffect(() => {
    if (!playing || mode !== "live" || !sb) return;
    let last = performance.now(), raf = 0;
    const tick = (now: number) => {
      const dt = (now - last) / 1000; last = now;
      setT((v) => { const n = v + dt; if (n >= dur) { setPlaying(false); return dur; } return n; });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, mode, dur, sb]);

  useEffect(() => { const v = videoRef.current; if (!v || mode !== "video") return; if (playing) v.play().catch(() => setPlaying(false)); else v.pause(); }, [playing, mode, vkind]);

  // ---------- editing ----------
  function saveSb(next: Storyboard, record = true) {
    if (!project || !user) return;
    if (record && project.storyboardJson) { hist.current.past.push(project.storyboardJson); if (hist.current.past.length > 60) hist.current.past.shift(); hist.current.future = []; }
    const upd = { ...project, storyboardJson: JSON.stringify(next), updatedAt: Date.now() };
    setProjects((prev) => prev.map((x) => (x.id === project.id ? upd : x)));
    saveProject(user.uid, upd).catch(() => {});
    force((n) => n + 1);
  }
  function undo() { const h = hist.current; const prev = h.past.pop(); if (!prev || !project?.storyboardJson) return; h.future.push(project.storyboardJson); saveSb(JSON.parse(prev), false); }
  function redo() { const h = hist.current; const nxt = h.future.pop(); if (!nxt || !project?.storyboardJson) return; h.past.push(project.storyboardJson); saveSb(JSON.parse(nxt), false); }
  const patchScene = (i: number, patch: Record<string, unknown>) => sb && saveSb({ ...sb, scenes: sb.scenes.map((s, j) => (j === i ? ({ ...s, ...patch } as Scene) : s)) });
  const idxAt = (sec: number) => { const f = sec * 30; const i = L.findIndex((x) => f >= x.from && f < x.from + x.dur - OVERLAP); return i < 0 ? Math.max(0, L.length - 1) : i; };
  function move(i: number, d: -1 | 1) { if (!sb || i + d < 0 || i + d >= sb.scenes.length) return; const s = [...sb.scenes]; [s[i], s[i + d]] = [s[i + d], s[i]]; saveSb({ ...sb, scenes: s }); setSel(i + d); }
  function duplicate(i: number) { if (!sb) return; const c = { ...sb.scenes[i] } as Scene; if (c.type === "custom") c.id = String(c.id).slice(0, 8) + Math.random().toString(36).slice(2, 5); const s = [...sb.scenes]; s.splice(i + 1, 0, c); saveSb({ ...sb, scenes: s }); setSel(i + 1); }
  function remove(i: number) { if (!sb || sb.scenes.length <= 1) return; saveSb({ ...sb, scenes: sb.scenes.filter((_, j) => j !== i) }); setSel(Math.max(0, i - 1)); }
  function split(i: number, atSec: number) {
    if (!sb) return;
    const s = sb.scenes[i]; const a = clamp(Math.round(atSec * 10) / 10, 2.5, Number(s.seconds) - 2.5);
    if (Number(s.seconds) < 5.2) return setLog(["Scene is too short to split (min 2.5s each part)."]);
    const second = { ...s, seconds: Math.round((Number(s.seconds) - a) * 10) / 10, narration: "", voice: undefined } as Scene;
    if (second.type === "custom") second.id = String(second.id).slice(0, 8) + Math.random().toString(36).slice(2, 5);
    const first = { ...s, seconds: a } as Scene;
    const arr = [...sb.scenes]; arr.splice(i, 1, first, second); saveSb({ ...sb, scenes: arr }); setSel(i + 1);
  }
  const addLib = (type: string) => { if (!sb) return; const at = idxAt(t) + 1; const s = [...sb.scenes]; s.splice(at, 0, { type, seconds: 4, ...DEFAULTS[type] } as Scene); saveSb({ ...sb, scenes: s }); setSel(at); };

  async function withRun(fn: () => Promise<void>) {
    if (running || !user || !e2bKey) return;
    setRunning(true); setLog([]); cancelRef.current = false;
    try { await fn(); } catch (e) { setLog((p) => [...p, "⚠️ " + (e instanceof Error ? e.message : "Something failed.")]); }
    finally { setRunning(false); setProgress(null); }
  }
  async function refreshUrl(k: "preview" | "final" | "scene", path: string) {
    const u = await signedUrl(env(), path, k === "final" ? "venus-" + (project?.id ?? "video") + ".mp4" : undefined);
    setUrls((p) => ({ ...p, [k]: u + (u.includes("?") ? "&" : "?") + "t=" + Date.now() }));
  }
  async function render(kind: "preview" | "final") {
    if (!project) return;
    await withRun(async () => { const run = newRun(env(), hooks(), project); await ensureStudio(run); const path = await renderKind(run, kind); await refreshUrl(kind, path); setMode("video"); setVkind(kind); setLog((p) => [...p, "✅ Done."]); });
  }
  async function previewScene() {
    if (!project || !sb) return;
    await withRun(async () => { const run = newRun(env(), hooks(), project); await ensureStudio(run); const path = await renderKind(run, "scene", { sceneIndex: selIdx }); await refreshUrl("scene", path); setMode("video"); setVkind("scene"); setPlaying(true); });
  }
  async function addAi(brief: string) {
    if (!project || !sb) return;
    await withRun(async () => {
      setProgress({ label: "Designing the scene", value: null });
      const at = idxAt(t) + 1;
      const base: Scene = { type: "custom", id: "c" + Date.now().toString(36).slice(-5), seconds: 4, brief, headline: brief.slice(0, 36), fallbackText: brief.slice(0, 50) };
      const arr = [...sb.scenes]; arr.splice(at, 0, base);
      const board = { ...sb, scenes: arr };
      const code = await genCode(env(), project, board, at);
      saveSb({ ...board, scenes: board.scenes.map((s, j) => (j === at ? { ...s, code } : s)) });
      setSel(at);
    });
  }
  const askAgent = async () => {
    if (!project || !sb || !aiText.trim()) return;
    const msg = aiText; setAiText(""); setChat((c) => [...c, { who: "me", text: msg }]);
    await withRun(async () => {
      const apiKey = apiKeys[project.provider];
      if (!apiKey) throw new Error("No API key for the selected model.");
      if (scope === "video") {
        setProgress({ label: "Agent is re-planning the video", value: null });
        const plain = { ...sb, scenes: sb.scenes.map((s) => { const { code, ...r } = s as any; return r; }) };
        const res = await fetch("/api/venus/ai", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "storyboard", provider: project.provider, apiKey, model: project.model, brief: `${project.brief}\n\nCURRENT STORYBOARD (keep what works, apply the change):\n${JSON.stringify(plain).slice(0, 6000)}\n\nCHANGE REQUEST: ${msg}`, seconds: project.seconds, aspect: project.aspect, theme: project.theme, voice: project.voice, captions: project.captions, design: project.design ?? "ai" }) });
        const data = await res.json(); if (!res.ok || !data.storyboard) throw new Error(data?.error || "Could not re-plan.");
        saveSb(data.storyboard);
        setChat((c) => [...c, { who: "agent", text: "I rewrote the storyboard. Designing new scenes now…" }]);
        const p2 = { ...project, storyboardJson: JSON.stringify(data.storyboard), updatedAt: Date.now() };
        setRunning(false);
        await runPipeline(env(), hooks(), p2, "design");
        setRunning(true);
        setChat((c) => [...c, { who: "agent", text: "Done — check the preview." }]);
        return;
      }
      if (!scene) return;
      setProgress({ label: "Agent is editing the scene", value: null });
      const cur = { ...scene } as Record<string, unknown>; delete cur.code;
      const res = await fetch("/api/venus/ai", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "edit", provider: project.provider, apiKey, model: project.model, scene: cur, instruction: msg }) });
      const data = await res.json(); if (!res.ok) throw new Error(data?.error || "Edit failed.");
      let next: Scene = { ...(data.scene as Scene), ...(scene.voice ? { voice: scene.voice } : {}), ...(scene.image ? { image: scene.image } : {}), ...(scene.video ? { video: scene.video } : {}) };
      let board = { ...sb, scenes: sb.scenes.map((s, j) => (j === selIdx ? next : s)) };
      if (next.type === "custom") {
        if (data.regenerateCode || !scene.code) { setProgress({ label: "Designing the scene", value: null }); next = { ...next, code: await genCode(env(), project, board, selIdx, { previousCode: String(scene.code ?? ""), critique: msg }) }; }
        else next = { ...next, code: scene.code };
        board = { ...board, scenes: board.scenes.map((s, j) => (j === selIdx ? next : s)) };
      }
      saveSb(board);
      setChat((c) => [...c, { who: "agent", text: `Updated scene ${selIdx + 1}. Press “Preview scene” to see it.` }]);
    });
  };
  async function voiceAll() {
    if (!project || !sb) return;
    await withRun(async () => {
      const run = newRun(env(), hooks(), project); await ensureStudio(run); let b = sb;
      for (let i = 0; i < b.scenes.length; i++) { if (!String(b.scenes[i].narration ?? "").trim()) continue; setProgress({ label: `Voice ${i + 1}/${b.scenes.length}`, value: i / b.scenes.length }); b = await regenVoice(run, b, i); }
      saveSb(b);
    });
  }
  async function makeMusic() {
    if (!project || !sb) return;
    await withRun(async () => {
      const run = newRun(env(), hooks(), project); await ensureStudio(run);
      const m = await studioCall(env(), "music", { sandboxId: run.sid, projectId: project.id, seconds: Math.ceil(dur) + 2, dark: true });
      saveSb({ ...sb, music: m.file });
    });
  }
  function setAspectTo(a: Aspect) { if (!sb || !project || !user) return; const d = ASPECTS[a]; const upd = { ...project, aspect: a }; setProjects((p) => p.map((x) => (x.id === project.id ? upd : x))); saveSb({ ...sb, width: d.width, height: d.height }); }
  function fitTo(secs: number) { if (!sb || !project || !user) return; const f = secs / Math.max(1, dur); saveSb({ ...sb, scenes: sb.scenes.map((s) => ({ ...s, seconds: clamp(Math.round(Number(s.seconds) * f * 10) / 10, 2.5, 14) })) }); const upd = { ...project, seconds: secs }; setProjects((p) => p.map((x) => (x.id === project.id ? upd : x))); }

  async function createProject() {
    if (!user || !brief.trim()) return;
    const p: VenusProject = { id: "v" + Date.now().toString(36), title: brief.trim().slice(0, 48), brief: brief.trim(), seconds, aspect, theme: "midnight", voice: voice && Boolean(openaiKey), voiceName: "nova", captions: true, quality, review: true, design, music: true, origin: "venus", provider, model, stage: "studio", status: "idle", createdAt: Date.now(), updatedAt: Date.now() };
    await saveProject(user.uid, p).catch(() => {});
    setProjects((prev) => [p, ...prev]); setActiveId(p.id); setBrief(""); setRunning(true); setLog([]); cancelRef.current = false;
    try { await runPipeline(env(), hooks(), p, "studio"); } finally { setRunning(false); setProgress(null); }
  }
  async function resume(p: VenusProject) { setRunning(true); setLog([]); cancelRef.current = false; try { await runPipeline(env(), hooks(), p, p.stage); } finally { setRunning(false); setProgress(null); } }
  async function removeProject(p: VenusProject) {
    if (!user || !window.confirm("Delete this video project?")) return;
    const paths = [p.previewPath, p.finalPath].filter(Boolean) as string[];
    if (paths.length) fetch("/api/venus/media", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + (await user.getIdToken()) }, body: JSON.stringify({ action: "delete", uid: user.uid, paths }) }).catch(() => {});
    await deleteProject(user.uid, p.id).catch(() => {});
    setProjects((prev) => prev.filter((x) => x.id !== p.id)); setActiveId("list");
  }

  // ---------- timeline interactions ----------
  function startTrim(e: React.PointerEvent, i: number) {
    e.stopPropagation(); e.preventDefault();
    const startX = e.clientX, base = Number(sb!.scenes[i].seconds); let cur = base;
    const move = (ev: PointerEvent) => { cur = clamp(Math.round((base + (ev.clientX - startX) / pps) * 10) / 10, 2.5, 14); setTrim({ i, seconds: cur }); };
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); setTrim(null); patchScene(i, { seconds: cur }); };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
  }
  function seek(sec: number) { const v = clamp(sec, 0, dur); setT(v); if (mode === "video" && vkind !== "scene" && videoRef.current) videoRef.current.currentTime = v; }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") { e.preventDefault(); e.shiftKey ? redo() : undo(); }
      else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "y") { e.preventDefault(); redo(); }
      else if (e.key === " ") { e.preventDefault(); setPlaying((p) => !p); }
      else if (e.key === "/") { e.preventDefault(); setTab("agent"); setTimeout(() => askRef.current?.focus(), 50); }
      else if (e.key.toLowerCase() === "v") setTool("select");
      else if (e.key.toLowerCase() === "c") setTool("razor");
      else if (e.key.toLowerCase() === "s" && sb) { const i = idxAt(t); split(i, t - L[i].from / 30); }
      else if (e.key === "ArrowRight") seek(t + 0.1);
      else if (e.key === "ArrowLeft") seek(t - 0.1);
      else if (e.key === "Delete" || e.key === "Backspace") remove(selIdx);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (authLoading || !user || keysLoading) return <div className="flex h-screen items-center justify-center bg-bg text-sm text-muted">Loading…</div>;

  const palette = sb?.palette ?? {};
  const stageH = 360 * (zoomC / 100);
  const ar = sb ? sb.width / sb.height : 16 / 9;
  const stageW = stageH * ar;
  const vSrc = urls[vkind] ?? urls.final ?? urls.preview;
  const trackW = Math.max(dur * pps + 60, 400);
  const toolBtn = (active: boolean) => `flex h-9 w-9 items-center justify-center rounded-lg ${active ? "bg-blue-600 text-white" : "text-muted hover:bg-panel2 hover:text-ink"}`;

  // ================= projects list =================
  if (activeId === "list" || !project || !sb) {
    return (
      <div className="min-h-screen bg-bg">
        <div className="mx-auto max-w-5xl px-6 py-8">
          <div className="mb-6 flex items-center gap-3">
            <button onClick={() => router.push("/dashboard")} className="rounded-full p-2 text-muted hover:bg-panel2"><ArrowLeft size={18} /></button>
            <Film size={20} className="text-gold" /><h1 className="text-xl font-semibold text-ink">Venus Pro</h1><span className="rounded-full bg-goldSoft px-2 py-0.5 text-[10px] font-medium uppercase text-gold">Beta</span>
          </div>
          {!e2bKey && <div className="mb-4 rounded-lg border border-gold/50 bg-goldSoft/40 p-3.5 text-sm text-ink">Venus Pro needs a Studio computer: add your <b>E2B key</b> in the dashboard (API keys).</div>}
          {cfg && !cfg.supabase && <div className="mb-4 flex gap-2 rounded-lg border border-red-900/60 bg-red-950/30 p-3.5 text-sm text-red-200"><AlertTriangle size={16} className="mt-0.5 shrink-0" /><span>Supabase is not set up. Add <b>SUPABASE_URL</b> and <b>SUPABASE_SERVICE_ROLE_KEY</b> in Vercel and redeploy.</span></div>}
          <div className="grid gap-6 md:grid-cols-[1fr_360px]">
            <div>
              <p className="mb-2 text-sm font-medium text-ink">Your videos</p>
              <div className="grid gap-3 sm:grid-cols-2">
                {projects.map((p) => (
                  <button key={p.id} onClick={() => setActiveId(p.id)} className="rounded-xl border border-line bg-panel p-4 text-left hover:border-gold/60">
                    <span className={`mb-2 inline-block h-2 w-2 rounded-full ${p.status === "done" ? "bg-avatar-teal" : p.status === "error" ? "bg-red-400" : p.status === "running" ? "bg-gold" : "bg-faint"}`} />
                    <span className="block truncate text-sm font-medium text-ink">{p.title}</span>
                    <span className="block text-[11px] text-faint">{new Date(p.createdAt).toLocaleDateString()} · {p.aspect} · {p.seconds}s</span>
                  </button>
                ))}
                {projects.length === 0 && <p className="text-xs text-faint">No videos yet — make your first one →</p>}
              </div>
            </div>
            <div className="rounded-xl border border-line bg-panel p-4">
              <p className="mb-2 flex items-center gap-2 text-sm font-medium text-ink"><Sparkles size={15} className="text-gold" /> New video</p>
              <textarea value={brief} onChange={(e) => setBrief(e.target.value)} rows={4} placeholder="Describe the video… e.g. A 30-second reel on how AI agents change work, bold and energetic." className={input} />
              <div className="mt-3 grid grid-cols-2 gap-2">
                <label className="text-[11px] text-muted">Length: {seconds}s<input type="range" min={15} max={60} step={5} value={seconds} onChange={(e) => setSeconds(Number(e.target.value))} className="mt-1 w-full accent-[#E7B24D]" /></label>
                <select value={aspect} onChange={(e) => setAspect(e.target.value as Aspect)} className={input}>{(Object.keys(ASPECTS) as Aspect[]).map((a) => <option key={a} value={a}>{ASPECTS[a].label}</option>)}</select>
                <select value={design} onChange={(e) => setDesign(e.target.value as "ai" | "library")} className={input}><option value="ai">AI-designed (unique)</option><option value="library">Library (faster)</option></select>
                <select value={quality} onChange={(e) => setQuality(e.target.value as "720p" | "1080p")} className={input}><option value="720p">720p</option><option value="1080p">1080p</option></select>
              </div>
              <label className={`mt-2 flex items-center gap-2 text-xs text-ink ${openaiKey ? "" : "opacity-50"}`}><input type="checkbox" disabled={!openaiKey} checked={voice && Boolean(openaiKey)} onChange={(e) => setVoice(e.target.checked)} /> Narrator voice {openaiKey ? "" : "(needs OpenAI key)"}</label>
              <p className="mb-1 mt-3 text-[11px] text-muted">Model (shared with chats)</p>
              <ModelPicker provider={provider} model={model} apiKeys={apiKeys} onChange={(p, m) => { setProvider(p); setModel(m); setModelPref(p, m); }} />
              <button onClick={createProject} disabled={!brief.trim() || !e2bKey || running || cfg?.supabase === false} className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 py-2.5 text-sm font-medium text-white disabled:opacity-40"><Sparkles size={15} /> Make my video</button>
              <p className="mt-2 text-center text-[11px] text-faint">First video: 15-30 min. Keep this tab open.</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ================= editor =================
  return (
    <div className="flex h-screen flex-col bg-bg">
      <header className="flex items-center gap-3 border-b border-line px-4 py-2.5">
        <button onClick={() => setActiveId("list")} className="flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-sm text-ink hover:bg-panel2"><ArrowLeft size={14} /> Projects</button>
        <input value={project.title} onChange={(e) => { const u = { ...project, title: e.target.value }; setProjects((p) => p.map((x) => (x.id === project.id ? u : x))); }} onBlur={() => saveProject(user.uid, project)} className="min-w-0 flex-1 bg-transparent text-base font-semibold text-ink focus:outline-none" />
        {(progress || running) && <span className="flex max-w-[260px] items-center gap-2 truncate text-xs text-muted"><Loader2 size={13} className="animate-spin" />{progress?.label ?? log[log.length - 1]}{progress?.value != null && ` ${Math.round(progress.value * 100)}%`}</span>}
        {running && <button onClick={() => { cancelRef.current = true; }} className="text-xs text-muted underline">Stop</button>}
        <div className="flex rounded-lg border border-line text-xs">{(Object.keys(ASPECTS) as Aspect[]).map((a) => <button key={a} onClick={() => setAspectTo(a)} className={`px-2.5 py-1.5 ${sb.width === ASPECTS[a].width && sb.height === ASPECTS[a].height ? "bg-panel2 text-ink" : "text-muted"}`}>{a}</button>)}</div>
        <div className="relative">
          <button onClick={() => setExportOpen((v) => !v)} className="flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-sm font-medium text-bg"><Download size={14} /> Export <ChevronDown size={13} /></button>
          {exportOpen && (
            <div className="absolute right-0 z-30 mt-1 w-56 rounded-lg border border-line bg-panel2 p-1 text-sm shadow-xl" onClick={() => setExportOpen(false)}>
              {urls.final && <a href={urls.final} download className="block rounded px-3 py-2 text-ink hover:bg-panel">Download final video</a>}
              <button onClick={() => render("final")} disabled={running} className="block w-full rounded px-3 py-2 text-left text-ink hover:bg-panel disabled:opacity-40">Render final ({project.quality})</button>
              <button onClick={() => { const u = { ...project, quality: project.quality === "720p" ? "1080p" as const : "720p" as const }; setProjects((p) => p.map((x) => (x.id === project.id ? u : x))); saveProject(user.uid, u); }} className="block w-full rounded px-3 py-2 text-left text-muted hover:bg-panel">Switch to {project.quality === "720p" ? "1080p" : "720p"}</button>
              <button onClick={() => render("preview")} disabled={running} className="block w-full rounded px-3 py-2 text-left text-ink hover:bg-panel disabled:opacity-40">Render preview</button>
              {urls.final && <button onClick={() => navigator.clipboard?.writeText(urls.final!)} className="block w-full rounded px-3 py-2 text-left text-ink hover:bg-panel">Copy share link (6h)</button>}
              <button onClick={() => removeProject(project)} className="block w-full rounded px-3 py-2 text-left text-red-300 hover:bg-panel">Delete project</button>
            </div>
          )}
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* ---------- left: Project / Agent ---------- */}
        <aside className="flex w-[330px] shrink-0 flex-col border-r border-line bg-panel">
          <div className="flex gap-1 p-2">{(["project", "agent"] as const).map((k) => <button key={k} onClick={() => setTab(k)} className={`flex flex-1 items-center justify-center gap-2 rounded-lg py-2 text-sm ${tab === k ? "bg-bg font-medium text-ink shadow" : "text-muted"}`}>{k === "agent" ? <BotAvatar color="amber" size={18} /> : null}{k === "project" ? "Project" : "Agent"}</button>)}</div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {tab === "project" ? (
              <>
                <div className="px-4 pb-3"><p className="text-lg font-semibold text-ink">{project.title}</p><p className="text-xs text-muted">{Math.round(dur)}s · {sb.scenes.length} sections · {sb.width}×{sb.height}</p>{sb.concept && <p className="mt-1 text-xs text-faint">{sb.concept}</p>}</div>
                {project.status === "error" && <div className="mx-4 mb-3 rounded-lg border border-red-900/60 bg-red-950/30 p-3 text-xs text-red-200"><p className="whitespace-pre-wrap break-words">{project.error}</p><button onClick={() => resume(project)} disabled={running} className="mt-2 rounded bg-white px-2.5 py-1 font-medium text-bg">Retry from this step</button></div>}
                <Sec title="Narrator">
                  <label className="mb-2 flex items-center gap-2 text-xs text-ink"><input type="checkbox" checked={project.voice} onChange={(e) => { const u = { ...project, voice: e.target.checked }; setProjects((p) => p.map((x) => (x.id === project.id ? u : x))); saveProject(user.uid, u); }} /> Voice-over on top of the music</label>
                  <div className="flex gap-2"><select value={project.voiceName} onChange={(e) => { const u = { ...project, voiceName: e.target.value }; setProjects((p) => p.map((x) => (x.id === project.id ? u : x))); saveProject(user.uid, u); }} className={input}>{VOICES.map((v) => <option key={v}>{v}</option>)}</select><button onClick={voiceAll} disabled={running || !openaiKey} className="shrink-0 rounded-lg border border-line px-3 text-xs text-ink hover:bg-panel2 disabled:opacity-40">Re-record</button></div>
                  {!openaiKey && <p className="mt-1 text-[11px] text-faint">Add an OpenAI key to enable voice.</p>}
                </Sec>
                <Sec title="Score"><div className="flex items-center gap-2"><span className="flex-1 text-xs text-muted">{sb.music ? "Ambient music bed attached" : "No music yet"}</span><button onClick={makeMusic} disabled={running} className="rounded-lg border border-line px-3 py-1.5 text-xs text-ink hover:bg-panel2 disabled:opacity-40">{sb.music ? "Regenerate" : "Add music"}</button></div></Sec>
                <Sec title="Look & feel">
                  <div className="grid grid-cols-3 gap-2">{["bg1", "bg2", "accent", "accent2", "text", "muted"].map((k) => <label key={k} className="text-[10px] text-muted">{k}<input type="color" value={palette[k] ?? "#111111"} onChange={(e) => saveSb({ ...sb, palette: { ...Object.fromEntries(["bg1", "bg2", "accent", "accent2", "text", "muted"].map((c) => [c, palette[c] ?? THEMES.find((x) => x.id === sb.theme)?.colors[c === "accent" ? 1 : c === "accent2" ? 2 : 0] ?? "#111111"])), [k]: e.target.value } })} className="mt-1 h-7 w-full rounded border border-line bg-bg" /></label>)}</div>
                  <div className="mt-2 grid grid-cols-2 gap-2">{(["display", "body"] as const).map((k) => <select key={k} value={sb.fonts?.[k] ?? ""} onChange={(e) => saveSb({ ...sb, fonts: { ...(sb.fonts ?? {}), [k]: e.target.value || undefined } })} className={input}><option value="">{k} font</option>{FONT_NAMES.map((f) => <option key={f}>{f}</option>)}</select>)}</div>
                  <label className="mt-2 flex items-center gap-2 text-xs text-ink"><input type="checkbox" checked={sb.captions} onChange={(e) => saveSb({ ...sb, captions: e.target.checked })} /> Captions</label>
                </Sec>
                {scene && (
                  <Sec title={`Section ${selIdx + 1} · ${scene.type}`}>
                    <div className="grid grid-cols-2 gap-2">
                      <label className="text-[11px] text-muted">Seconds<input type="number" min={2.5} max={14} step={0.5} value={scene.seconds} onChange={(e) => patchScene(selIdx, { seconds: clamp(Number(e.target.value) || 4, 2.5, 14) })} className={`${input} mt-1`} /></label>
                      <label className="text-[11px] text-muted">Transition<select value={String(scene.transition ?? "")} onChange={(e) => patchScene(selIdx, { transition: e.target.value || undefined })} className={`${input} mt-1`}><option value="">default</option>{TRANSITIONS.map((x) => <option key={x}>{x}</option>)}</select></label>
                    </div>
                    <p className="mb-1 mt-2 text-[11px] text-muted">Camera moves (up to 3)</p>
                    <div className="flex flex-wrap gap-1">{CAMERA_MOVES.map((m) => { const cur = (Array.isArray(scene.camera) ? scene.camera : []) as string[]; const on = cur.includes(m); return <button key={m} onClick={() => { const nx = on ? cur.filter((x) => x !== m) : [...cur, m].slice(-3); patchScene(selIdx, { camera: nx.length ? nx : undefined }); }} className={`rounded-full border px-2 py-0.5 text-[11px] ${on ? "border-orange-400 bg-orange-500/20 text-orange-200" : "border-line text-muted"}`}>{m}</button>; })}</div>
                    {scene.type !== "custom" && <label className="mt-2 block text-[11px] text-muted">Text size ({Number(scene.fontScale ?? 1).toFixed(1)}×)<input type="range" min={0.5} max={1.3} step={0.05} value={Number(scene.fontScale ?? 1)} onChange={(e) => patchScene(selIdx, { fontScale: Number(e.target.value) })} className="w-full accent-[#E7B24D]" /></label>}
                    <label className="mt-2 block text-[11px] text-muted">Narration<textarea rows={2} value={String(scene.narration ?? "")} onChange={(e) => patchScene(selIdx, { narration: e.target.value })} className={`${input} mt-1`} /></label>
                    {scene.type === "custom" && (<><label className="mt-2 block text-[11px] text-muted">Design brief<textarea rows={3} value={String(scene.brief ?? "")} onChange={(e) => patchScene(selIdx, { brief: e.target.value })} className={`${input} mt-1`} /></label><button onClick={() => setShowCode((v) => !v)} className="mt-1 text-[11px] text-muted underline">{showCode ? "Hide" : "Show"} code</button>{showCode && <textarea rows={10} value={String(scene.code ?? "")} onChange={(e) => patchScene(selIdx, { code: e.target.value })} className={`${input} mt-1 font-mono text-[10px]`} />}</>)}
                    <div className="mt-2 space-y-2">{Object.entries(scene).filter(([k]) => !HIDDEN.has(k)).map(([k, v]) => <Field key={k + selIdx} label={k} value={v} onChange={(nv) => patchScene(selIdx, { [k]: nv })} />)}</div>
                  </Sec>
                )}
              </>
            ) : (
              <div className="flex h-full flex-col p-3">
                <div className="mb-2 flex gap-1 text-xs">{(["scene", "video"] as const).map((k) => <button key={k} onClick={() => setScope(k)} className={`rounded-full border px-3 py-1 ${scope === k ? "border-orange-400 text-orange-200" : "border-line text-muted"}`}>{k === "scene" ? `Section ${selIdx + 1}` : "Whole video"}</button>)}</div>
                <div className="min-h-0 flex-1 space-y-2 overflow-y-auto">
                  {chat.length === 0 && <p className="p-2 text-xs text-muted">Tell the agent what to change — “make this punchier”, “add a countdown”, “use a warmer palette”. Press <b>/</b> anywhere to jump here.</p>}
                  {chat.map((c, i) => <div key={i} className={`rounded-xl px-3 py-2 text-sm ${c.who === "me" ? "ml-6 bg-ink text-bg" : "mr-6 border border-line bg-panel2 text-ink"}`}>{c.text}</div>)}
                  {log.slice(-4).map((l, i) => <p key={i} className="px-1 text-[11px] text-faint">{l}</p>)}
                </div>
                <div className="mt-2 flex gap-2"><input ref={askRef} value={aiText} onChange={(e) => setAiText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && askAgent()} placeholder="Ask the agent…" className={input} /><button onClick={askAgent} disabled={running || !aiText.trim()} className="rounded-lg bg-orange-500 px-3 text-white disabled:opacity-40"><Wand2 size={15} /></button></div>
                <div className="mt-2 flex gap-1.5"><input placeholder="New AI scene idea…" onKeyDown={(e) => { if (e.key === "Enter" && (e.target as HTMLInputElement).value.trim()) { addAi((e.target as HTMLInputElement).value.trim()); (e.target as HTMLInputElement).value = ""; } }} className={input} /></div>
              </div>
            )}
          </div>
        </aside>

        {/* ---------- center: canvas + timeline ---------- */}
        <main className="flex min-w-0 flex-1 flex-col">
          <div className="relative min-h-0 flex-1 overflow-auto" style={{ backgroundImage: "radial-gradient(rgba(255,255,255,0.13) 1px, transparent 1px)", backgroundSize: "22px 22px" }}>
            <div className="flex min-h-full items-center justify-center p-8 pb-20">
              <div style={{ width: stageW, height: stageH }} className="overflow-hidden rounded-2xl border border-line shadow-2xl">
                {mode === "live" ? <Animatic sb={sb} t={t} W={stageW} H={stageH} /> : vSrc ? (
                  <video ref={videoRef} key={vSrc} src={vSrc} playsInline className="h-full w-full bg-black object-contain" onTimeUpdate={(e) => { if (vkind !== "scene") setT((e.target as HTMLVideoElement).currentTime); }} onEnded={() => setPlaying(false)} />
                ) : <div className="flex h-full items-center justify-center bg-black text-xs text-muted">Nothing rendered yet</div>}
              </div>
            </div>
            <div className="absolute right-4 top-3 flex rounded-lg border border-line bg-panel text-xs">
              <button onClick={() => { setMode("live"); setPlaying(false); }} className={`px-3 py-1.5 ${mode === "live" ? "bg-panel2 text-ink" : "text-muted"}`}>Live</button>
              {(["scene", "preview", "final"] as const).map((k) => <button key={k} disabled={!urls[k]} onClick={() => { setMode("video"); setVkind(k); setPlaying(false); }} className={`px-3 py-1.5 capitalize disabled:opacity-30 ${mode === "video" && vkind === k ? "bg-panel2 text-ink" : "text-muted"}`}>{k}</button>)}
            </div>
            <div className="absolute bottom-4 left-4 flex items-center gap-1 rounded-full border border-line bg-panel px-2 py-1 text-xs text-muted">
              <button onClick={() => setZoomC((z) => Math.max(40, z - 10))} className="p-1 hover:text-ink"><ZoomOut size={15} /></button><span className="w-9 text-center text-ink">{zoomC}%</span><button onClick={() => setZoomC((z) => Math.min(200, z + 10))} className="p-1 hover:text-ink"><ZoomIn size={15} /></button>
            </div>
            <button onClick={() => { setTab("agent"); setTimeout(() => askRef.current?.focus(), 50); }} className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-3 rounded-full bg-orange-500 px-5 py-3 text-base font-semibold text-white shadow-xl hover:bg-orange-400"><BotAvatar color="amber" size={26} /> Ask agent <kbd className="rounded bg-white/20 px-2 text-sm">/</kbd></button>
            <button onClick={() => { const k = urls.final ? "final" : urls.preview ? "preview" : null; if (!k) return setLog(["Render a preview first to hear the music and voice."]); setMode("video"); setVkind(k); if (videoRef.current) videoRef.current.currentTime = t; setPlaying(true); }} className="absolute bottom-4 right-4 flex items-center gap-2 rounded-full bg-neutral-800 px-4 py-2.5 text-sm font-medium text-white hover:bg-neutral-700">{urls.final || urls.preview ? <Volume2 size={16} /> : <VolumeX size={16} />} Play with sound</button>
          </div>

          {/* tools + transport */}
          <div className="flex items-center gap-1 border-y border-line bg-panel px-3 py-2">
            <button title="Select (V)" onClick={() => setTool("select")} className={toolBtn(tool === "select")}><MousePointer2 size={17} /></button>
            <button title="Razor — click a section to split (C / S)" onClick={() => setTool("razor")} className={toolBtn(tool === "razor")}><Scissors size={17} /></button>
            <span className="mx-1 h-6 w-px bg-line" />
            <button title="Text section" onClick={() => addLib("title")} className={toolBtn(false)}><Type size={17} /></button>
            <button title="Rectangle (AI-designed)" disabled={running} onClick={() => addAi("An animated rounded rectangle card that slides in with a soft shadow and shows the headline")} className={toolBtn(false)}><SquareIcon size={17} /></button>
            <button title="Circle (AI-designed)" disabled={running} onClick={() => addAi("An animated circle with expanding rings and the headline in the middle")} className={toolBtn(false)}><Circle size={17} /></button>
            <button title="3D cube (AI-designed)" disabled={running} onClick={() => addAi("A rotating 3D cube made with CSS 3D transforms, with the headline on one face")} className={toolBtn(false)}><Box size={17} /></button>
            <button title="Image section" onClick={() => { const q = window.prompt("Photo to find (e.g. city skyline at night)"); if (q) { addLib("image"); setTimeout(() => patchScene(Math.min(idxAt(t) + 1, (sb?.scenes.length ?? 1)), { imageQuery: q, headline: q }), 0); } }} className={toolBtn(false)}><ImageIcon size={17} /></button>
            <span className="ml-3 font-mono text-sm text-ink">{mmss(t)}</span>
            <div className="mx-auto flex items-center gap-3">
              <button onClick={() => seek(0)} className="text-muted hover:text-ink"><SkipBack size={18} /></button>
              <button onClick={() => { if (!playing && t >= dur - 0.05) seek(0); setPlaying((p) => !p); }} className="flex h-11 w-11 items-center justify-center rounded-full bg-ink text-bg">{playing ? <Pause size={18} /> : <Play size={18} />}</button>
              <button onClick={() => seek(dur)} className="text-muted hover:text-ink"><SkipForward size={18} /></button>
            </div>
            <span className="font-mono text-sm text-faint">{mmss(dur)}</span>
            <select value={project.seconds} onChange={(e) => fitTo(Number(e.target.value))} className="rounded-md border border-line bg-bg px-2 py-1 text-xs text-ink">{[15, 30, 45, 60].map((n) => <option key={n} value={n}>{n}s</option>)}</select>
            <button title="Undo" onClick={undo} className={toolBtn(false)}><Undo2 size={17} /></button>
            <button title="Redo" onClick={redo} className={toolBtn(false)}><Redo2 size={17} /></button>
            <button title="Layers" onClick={() => setShowLayers((v) => !v)} className={toolBtn(showLayers)}><Layers size={17} /></button>
            <button title="Zoom out" onClick={() => setZoomT((z) => Math.max(0.5, z - 0.25))} className={toolBtn(false)}><ZoomOut size={17} /></button>
            <button title="Zoom in" onClick={() => setZoomT((z) => Math.min(3, z + 0.25))} className={toolBtn(false)}><ZoomIn size={17} /></button>
            <button onClick={previewScene} disabled={running} className="ml-1 rounded-lg border border-line px-2.5 py-1.5 text-xs text-ink hover:bg-panel2 disabled:opacity-40">Preview scene</button>
          </div>

          {/* timeline */}
          <div className="flex h-[250px] shrink-0 bg-panel">
            <div className="w-[120px] shrink-0 border-r border-line text-[11px] text-muted">
              <div className="h-6" />
              <div className="flex h-[38px] items-center px-3 uppercase tracking-widest text-faint">Sections</div>
              <div className="flex h-[40px] items-center gap-2 px-3"><span className="h-5 w-5 rounded bg-emerald-500" />Score</div>
              <div className="flex h-[34px] items-center gap-2 px-3"><span className="h-5 w-5 rounded bg-orange-300" />Effects</div>
              <div className="flex h-[34px] items-center gap-2 px-3"><span className="h-5 w-5 rounded bg-violet-500" />Narrator</div>
            </div>
            <div className="min-w-0 flex-1 overflow-x-auto overflow-y-hidden">
              <div className="relative" style={{ width: trackW }}>
                <div className="relative h-6 cursor-pointer border-b border-line" onClick={(e) => { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); seek((e.clientX - r.left) / pps); }}>
                  {Array.from({ length: Math.ceil(dur) + 1 }).map((_, s) => <span key={s} className="absolute top-0 border-l border-line pl-1 text-[10px] text-faint" style={{ left: s * pps }}>0:{String(s).padStart(2, "0")}</span>)}
                </div>
                <div className="relative h-[38px]">
                  {sb.scenes.map((s, i) => {
                    const secs = trim?.i === i ? trim.seconds : Number(s.seconds);
                    const left = (L[i].from / 30) * pps, w = Math.max(34, (secs - OVERLAP / 30) * pps - 3);
                    const c = TYPE_COLOR[s.type] ?? "#888";
                    return (
                      <div key={i} onClick={(e) => { setSel(i); if (tool === "razor") { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); split(i, (e.clientX - r.left) / pps); } else seek(L[i].from / 30); }} style={{ left, width: w, background: c + "26", color: c, borderColor: selIdx === i ? "#fff" : "transparent" }} className={`absolute top-1.5 flex h-7 cursor-pointer items-center overflow-hidden rounded-full border px-3 text-xs font-medium ${tool === "razor" ? "cursor-crosshair" : ""}`}>
                        <span className="truncate">{summarizeScene(s) || s.type}{s.type === "custom" ? " ✦" : ""}</span>
                        <span onPointerDown={(e) => startTrim(e, i)} className="absolute right-0 top-0 h-full w-2.5 cursor-ew-resize rounded-r-full bg-white/30" />
                      </div>
                    );
                  })}
                </div>
                <div className="relative h-[40px] border-t border-line">
                  {sb.music ? (<div className="absolute top-1.5 flex h-7 items-center overflow-hidden rounded-full bg-emerald-500 px-3 text-xs font-medium text-emerald-950" style={{ left: 0, width: Math.max(60, dur * pps) }}><span>♪ Score · ambient</span><svg className="absolute inset-0 h-full w-full opacity-30" preserveAspectRatio="none" viewBox="0 0 200 20"><polyline fill="none" stroke="#052e1a" strokeWidth="1" points={Array.from({ length: 200 }, (_, k) => `${k},${10 + Math.sin(k * 0.35) * 5 * Math.sin(k * 0.05 + 1)}`).join(" ")} /></svg></div>) : <button onClick={makeMusic} className="absolute left-3 top-2 text-[11px] text-faint underline">+ add music</button>}
                </div>
                <div className="relative h-[34px] border-t border-line">
                  {sb.scenes.map((s, i) => { const lab = (Array.isArray(s.camera) ? (s.camera as string[])[0] : "") || (s.transition as string) || ""; return lab ? <span key={i} onClick={() => setSel(i)} className="absolute top-1.5 cursor-pointer rounded-full bg-orange-300/30 px-2.5 py-0.5 text-[11px] text-orange-200" style={{ left: (L[i].from / 30) * pps }}>{lab}</span> : null; })}
                </div>
                <div className="relative h-[34px] border-t border-line">
                  {sb.scenes.map((s, i) => String(s.narration ?? "").trim() ? <div key={i} onClick={() => setSel(i)} className="absolute top-1.5 flex h-6 cursor-pointer items-center overflow-hidden rounded-full bg-violet-500/80 px-2.5 text-[11px] text-white" style={{ left: (L[i].from / 30) * pps + 2, width: Math.max(40, (Number(s.seconds) - 0.5) * pps) }}><span className="truncate">🎙 {String(s.narration)}</span></div> : null)}
                </div>
                <div className="pointer-events-none absolute top-0 h-full w-px bg-blue-500" style={{ left: t * pps }}><span className="absolute -left-1.5 top-0 h-3 w-3 rounded-sm bg-blue-500" /></div>
              </div>
            </div>
            {showLayers && (
              <div className="w-[230px] shrink-0 overflow-y-auto border-l border-line p-2">
                <p className="mb-1 text-[11px] uppercase tracking-widest text-faint">Layers</p>
                {sb.scenes.map((s, i) => (
                  <div key={i} onClick={() => setSel(i)} className={`mb-1 flex items-center gap-1 rounded-md px-2 py-1 text-xs ${selIdx === i ? "bg-panel2 text-ink" : "text-muted"}`}>
                    <span className="h-2 w-2 rounded-full" style={{ background: TYPE_COLOR[s.type] }} /><span className="min-w-0 flex-1 truncate">{i + 1}. {summarizeScene(s) || s.type}</span>
                    <button onClick={(e) => { e.stopPropagation(); move(i, -1); }} title="Up">↑</button><button onClick={(e) => { e.stopPropagation(); move(i, 1); }} title="Down">↓</button>
                    <button onClick={(e) => { e.stopPropagation(); duplicate(i); }}><Copy size={11} /></button><button onClick={(e) => { e.stopPropagation(); remove(i); }}><Trash2 size={11} /></button>
                  </div>
                ))}
                <select onChange={(e) => { if (e.target.value) addLib(e.target.value); e.target.value = ""; }} defaultValue="" className="mt-1 w-full rounded-md border border-line bg-bg px-2 py-1 text-xs text-ink"><option value="">+ add section…</option>{Object.keys(DEFAULTS).map((k) => <option key={k} value={k}>{k}</option>)}</select>
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}