"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle, ArrowLeft, ChevronLeft, ChevronRight, Copy, Download, Film, Loader2, Play,
  Plus, RefreshCw, Sparkles, Trash2, Wand2,
} from "lucide-react";
import Logo from "@/components/Logo";
import ModelPicker from "@/components/dashboard/ModelPicker";
import { useAuth } from "@/lib/auth-context";
import { useKeys } from "@/lib/keys-context";
import { getModelPref, setModelPref } from "@/lib/model-pref";
import { PROVIDERS, providerMeta, type ProviderId } from "@/lib/providers";
import {
  ASPECTS, FONT_NAMES, SCENE_TYPES, THEMES, TRANSITIONS, sanitizeStoryboard, sceneLayout,
  summarizeScene, totalFramesOf, type Aspect, type Scene, type Storyboard,
} from "@/lib/venus-schema";
import { deleteProject, listProjects, saveProject, type Stage, type VenusProject } from "@/lib/venus";
import {
  STAGES, ensureStudio, genCode, newRun, parseSb, regenVoice, renderKind, runPipeline,
  signedUrl, type PipelineEnv, type PipelineHooks,
} from "@/lib/venus-pipeline";

const STAGE_LABEL: Record<string, string> = {
  studio: "Studio", script: "Script", design: "Design", assets: "Assets",
  voice: "Voice", preview: "Preview", review: "Quality check", final: "Final",
};
const VOICES = ["nova", "alloy", "echo", "fable", "onyx", "shimmer"];
const TYPE_COLOR: Record<string, string> = {
  title: "#5b8cff", kinetic: "#a66bff", bullets: "#2de2a6", stat: "#ff7a45", "bar-chart": "#e7b24d",
  "line-chart": "#e7b24d", quote: "#ff4d8d", split: "#7ae0ff", timeline: "#2de2a6", ranking: "#ff7a45",
  image: "#8b8a90", outro: "#5b8cff", custom: "#f1f0ec",
};
const DEFAULTS: Record<string, Record<string, unknown>> = {
  title: { headline: "New title", subhead: "" },
  kinetic: { text: "Your punchy line goes here", emphasis: [] },
  bullets: { headline: "Key points", items: ["First", "Second", "Third"] },
  stat: { label: "Metric", value: 100, suffix: "%" },
  "bar-chart": { headline: "Comparison", data: [{ label: "A", value: 40 }, { label: "B", value: 70 }] },
  "line-chart": { headline: "Trend", data: [{ label: "Q1", value: 10 }, { label: "Q2", value: 25 }, { label: "Q3", value: 40 }] },
  quote: { text: "A memorable quote", author: "" },
  split: { headline: "Versus", left: { title: "Before", points: ["…"] }, right: { title: "After", points: ["…"] } },
  timeline: { headline: "Steps", steps: [{ label: "One", text: "…" }, { label: "Two", text: "…" }, { label: "Three", text: "…" }] },
  ranking: { headline: "Top picks", items: [{ title: "First" }, { title: "Second" }, { title: "Third" }] },
  image: { headline: "Headline", imageQuery: "city skyline" },
  outro: { headline: "Thanks for watching", handle: "@you" },
};
const HIDDEN = new Set(["type", "seconds", "transition", "narration", "voice", "image", "code", "id", "fontScale", "brief"]);

const input = "w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm text-ink placeholder:text-faint focus:border-gold focus:outline-none";

function Field({ label, value, onChange }: { label: string; value: unknown; onChange: (v: unknown) => void }) {
  const [txt, setTxt] = useState("");
  const [err, setErr] = useState(false);
  const isStr = typeof value === "string";
  const isNum = typeof value === "number";
  const isLines = Array.isArray(value) && value.every((x) => typeof x === "string");
  useEffect(() => {
    if (isStr || isNum) return;
    setTxt(isLines ? (value as string[]).join("\n") : JSON.stringify(value, null, 2));
    setErr(false);
  }, [value, isStr, isNum, isLines]);

  return (
    <label className="block text-[11px] text-muted">
      {label}
      {isStr ? (
        (value as string).length > 60 ? (
          <textarea className={`${input} mt-1`} rows={3} value={value as string} onChange={(e) => onChange(e.target.value)} />
        ) : (
          <input className={`${input} mt-1`} value={value as string} onChange={(e) => onChange(e.target.value)} />
        )
      ) : isNum ? (
        <input type="number" className={`${input} mt-1`} value={value as number} onChange={(e) => onChange(Number(e.target.value))} />
      ) : (
        <textarea
          className={`${input} mt-1 font-mono text-[11px] ${err ? "border-red-500" : ""}`}
          rows={isLines ? 3 : 6}
          value={txt}
          onChange={(e) => setTxt(e.target.value)}
          onBlur={() => {
            try {
              onChange(isLines ? txt.split("\n").map((l) => l.trim()).filter(Boolean) : JSON.parse(txt));
              setErr(false);
            } catch {
              setErr(true);
            }
          }}
        />
      )}
    </label>
  );
}

export default function VenusPage() {
  const { user, loading: authLoading } = useAuth();
  const { apiKeys, e2bKey, loading: keysLoading } = useKeys();
  const router = useRouter();

  const [projects, setProjects] = useState<VenusProject[]>([]);
  const [activeId, setActiveId] = useState<string>("new");
  const [cfg, setCfg] = useState<{ supabase: boolean; pexels: boolean } | null>(null);
  const [urls, setUrls] = useState<{ scene?: string; preview?: string; final?: string }>({});
  const [view, setView] = useState<"scene" | "preview" | "final">("preview");
  const [log, setLog] = useState<string[]>([]);
  const [progress, setProgress] = useState<{ label: string; value: number | null } | null>(null);
  const [running, setRunning] = useState(false);
  const [sel, setSel] = useState(0);
  const [aiText, setAiText] = useState("");
  const [addText, setAddText] = useState("");
  const [showCode, setShowCode] = useState(false);
  const cancelRef = useRef(false);

  const pref = typeof window !== "undefined" ? getModelPref() : null;
  const firstProvider = (pref && apiKeys[pref.provider] ? pref.provider : PROVIDERS.find((p) => apiKeys[p.id])?.id ?? PROVIDERS[0].id) as ProviderId;
  const [provider, setProvider] = useState<ProviderId>(firstProvider);
  const [model, setModel] = useState(pref && apiKeys[pref.provider] ? pref.model : providerMeta(firstProvider).models[0]);

  const [brief, setBrief] = useState("");
  const [seconds, setSeconds] = useState(45);
  const [aspect, setAspect] = useState<Aspect>("16:9");
  const [theme, setTheme] = useState("midnight");
  const [voice, setVoice] = useState(false);
  const [voiceName, setVoiceName] = useState("nova");
  const [captions, setCaptions] = useState(true);
  const [quality, setQuality] = useState<"720p" | "1080p">("720p");
  const [review, setReview] = useState(true);
  const [design, setDesign] = useState<"ai" | "library">("ai");

  const openaiKey = apiKeys.openai;
  const project = projects.find((p) => p.id === activeId) ?? null;
  const sb = project ? parseSb(project) : null;
  const scene: Scene | null = sb ? sb.scenes[Math.min(sel, sb.scenes.length - 1)] ?? null : null;
  const selIdx = sb ? Math.min(sel, sb.scenes.length - 1) : 0;

  useEffect(() => {
    if (!authLoading && !user) router.replace("/");
  }, [authLoading, user, router]);

  useEffect(() => {
    if (!user) return;
    listProjects(user.uid)
      .then((list) => {
        setProjects(list);
        const want = new URLSearchParams(window.location.search).get("project");
        if (want && list.some((p) => p.id === want)) setActiveId(want);
      })
      .catch(() => {});
    fetch("/api/venus/media").then((r) => r.json()).then(setCfg).catch(() => {});
  }, [user]);

  const env = (): PipelineEnv => ({
    uid: user!.uid,
    token: () => user!.getIdToken(),
    e2bKey: e2bKey as string,
    apiKeys,
    pexels: Boolean(cfg?.pexels),
  });
  const hooks = (): PipelineHooks => ({
    log: (m) => setLog((prev) => [...prev.slice(-80), m]),
    progress: setProgress,
    update: (p) => setProjects((prev) => prev.map((x) => (x.id === p.id ? p : x))),
    cancelled: () => cancelRef.current,
  });

  useEffect(() => {
    setUrls({});
    setSel(0);
    if (!user || !project) return;
    (["preview", "final"] as const).forEach(async (k) => {
      const path = k === "preview" ? project.previewPath : project.finalPath;
      if (!path) return;
      try {
        const u = await signedUrl(env(), path, k === "final" ? "venus-" + project.id + ".mp4" : undefined);
        setUrls((prev) => ({ ...prev, [k]: u }));
      } catch {
        // fetched again after the next render
      }
    });
    setView(project.finalPath ? "final" : "preview");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, project?.previewPath, project?.finalPath, user]);

  async function refreshUrl(k: "preview" | "final" | "scene", path: string) {
    const u = await signedUrl(env(), path, k === "final" ? "venus-" + (project?.id ?? "video") + ".mp4" : undefined);
    setUrls((prev) => ({ ...prev, [k]: u + (u.includes("?") ? "&" : "?") + "t=" + Date.now() }));
  }

  // ---------- editing helpers ----------

  function saveSb(next: Storyboard) {
    if (!project || !user) return;
    const upd = { ...project, storyboardJson: JSON.stringify(next), updatedAt: Date.now() };
    setProjects((prev) => prev.map((x) => (x.id === project.id ? upd : x)));
    saveProject(user.uid, upd).catch(() => {});
  }
  const patchScene = (i: number, patch: Record<string, unknown>) => {
    if (!sb) return;
    saveSb({ ...sb, scenes: sb.scenes.map((s, j) => (j === i ? ({ ...s, ...patch } as Scene) : s)) });
  };
  function move(i: number, d: -1 | 1) {
    if (!sb || i + d < 0 || i + d >= sb.scenes.length) return;
    const scenes = [...sb.scenes];
    [scenes[i], scenes[i + d]] = [scenes[i + d], scenes[i]];
    saveSb({ ...sb, scenes });
    setSel(i + d);
  }
  function duplicate(i: number) {
    if (!sb) return;
    const copy = { ...sb.scenes[i] } as Scene;
    if (copy.type === "custom") copy.id = String(copy.id).slice(0, 8) + Math.random().toString(36).slice(2, 5);
    const scenes = [...sb.scenes];
    scenes.splice(i + 1, 0, copy);
    saveSb({ ...sb, scenes });
    setSel(i + 1);
  }
  function remove(i: number) {
    if (!sb || sb.scenes.length <= 1) return;
    saveSb({ ...sb, scenes: sb.scenes.filter((_, j) => j !== i) });
    setSel(Math.max(0, i - 1));
  }
  function addScene(type: string) {
    if (!sb) return;
    saveSb({ ...sb, scenes: [...sb.scenes, { type, seconds: 4, ...DEFAULTS[type] } as Scene] });
    setSel(sb.scenes.length);
  }

  async function withRun(fn: () => Promise<void>) {
    if (running || !user || !e2bKey) return;
    setRunning(true);
    setLog([]);
    cancelRef.current = false;
    try {
      await fn();
    } catch (e) {
      setLog((prev) => [...prev, "⚠️ " + (e instanceof Error ? e.message : "Something failed.")]);
    } finally {
      setRunning(false);
      setProgress(null);
    }
  }

  async function render(kind: "preview" | "final") {
    if (!project) return;
    await withRun(async () => {
      const run = newRun(env(), hooks(), project);
      await ensureStudio(run);
      const path = await renderKind(run, kind);
      await refreshUrl(kind, path);
      setView(kind);
      setLog((prev) => [...prev, "✅ Done."]);
    });
  }

  async function previewScene() {
    if (!project || !sb) return;
    await withRun(async () => {
      const run = newRun(env(), hooks(), project);
      await ensureStudio(run);
      const path = await renderKind(run, "scene", { sceneIndex: selIdx });
      await refreshUrl("scene", path);
      setView("scene");
      setLog((prev) => [...prev, "✅ Scene preview ready."]);
    });
  }

  async function askAi() {
    if (!project || !sb || !scene || !aiText.trim()) return;
    await withRun(async () => {
      const apiKey = apiKeys[project.provider];
      if (!apiKey) throw new Error("No API key for the selected model.");
      setProgress({ label: "Agent is editing the scene", value: null });
      const cur = { ...scene } as Record<string, unknown>;
      delete cur.code;
      const res = await fetch("/api/venus/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "edit", provider: project.provider, apiKey, model: project.model, scene: cur, instruction: aiText }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Edit failed.");
      let next: Scene = { ...(data.scene as Scene), ...(scene.voice ? { voice: scene.voice } : {}), ...(scene.image ? { image: scene.image } : {}) };
      let board = { ...sb, scenes: sb.scenes.map((s, j) => (j === selIdx ? next : s)) };
      if (next.type === "custom") {
        if (data.regenerateCode || !scene.code) {
          setProgress({ label: "Designing the scene", value: null });
          next = { ...next, code: await genCode(env(), project, board, selIdx, { previousCode: String(scene.code ?? ""), critique: aiText }) };
        } else {
          next = { ...next, code: scene.code };
        }
        board = { ...board, scenes: board.scenes.map((s, j) => (j === selIdx ? next : s)) };
      }
      saveSb(board);
      setAiText("");
      setLog(["✅ Scene updated. Use “Preview scene” to see it."]);
    });
  }

  async function addAiScene() {
    if (!project || !sb || !addText.trim()) return;
    await withRun(async () => {
      setProgress({ label: "Designing the scene", value: null });
      const base: Scene = { type: "custom", id: "c" + Date.now().toString(36).slice(-5), seconds: 5, brief: addText, headline: addText.slice(0, 40), fallbackText: addText.slice(0, 60) };
      const board = { ...sb, scenes: [...sb.scenes, base] };
      const code = await genCode(env(), project, board, board.scenes.length - 1);
      saveSb({ ...board, scenes: board.scenes.map((s, j) => (j === board.scenes.length - 1 ? { ...s, code } : s)) });
      setSel(board.scenes.length - 1);
      setAddText("");
      setLog(["✅ AI scene added."]);
    });
  }

  async function regenDesign() {
    if (!project || !sb || !scene || scene.type !== "custom") return;
    await withRun(async () => {
      setProgress({ label: "Redesigning the scene", value: null });
      const code = await genCode(env(), project, sb, selIdx, { previousCode: String(scene.code ?? ""), critique: aiText || "Create a fresh, more striking design for the same brief." });
      patchScene(selIdx, { code });
      setLog(["✅ New design written."]);
    });
  }

  async function updateVoice() {
    if (!project || !sb) return;
    await withRun(async () => {
      const run = newRun(env(), hooks(), project);
      await ensureStudio(run);
      saveSb(await regenVoice(run, sb, selIdx));
      setLog(["✅ Voice updated for this scene."]);
    });
  }

  async function createProject() {
    if (!user || !brief.trim()) return;
    const p: VenusProject = {
      id: "v" + Date.now().toString(36), title: brief.trim().slice(0, 48), brief: brief.trim(), seconds, aspect, theme,
      voice: voice && Boolean(openaiKey), voiceName, captions, quality, review, design, origin: "venus",
      provider, model, stage: "studio", status: "idle", createdAt: Date.now(), updatedAt: Date.now(),
    };
    await saveProject(user.uid, p).catch(() => {});
    setProjects((prev) => [p, ...prev]);
    setActiveId(p.id);
    setBrief("");
    setRunning(true);
    setLog([]);
    cancelRef.current = false;
    try {
      await runPipeline(env(), hooks(), p, "studio");
    } finally {
      setRunning(false);
    }
  }

  async function resume(p: VenusProject, from: Stage) {
    setRunning(true);
    setLog([]);
    cancelRef.current = false;
    try {
      await runPipeline(env(), hooks(), p, from);
    } finally {
      setRunning(false);
    }
  }

  async function removeProject(p: VenusProject) {
    if (!user || !window.confirm("Delete this video project?")) return;
    const paths = [p.previewPath, p.finalPath].filter(Boolean) as string[];
    if (paths.length) {
      fetch("/api/venus/media", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + (await user.getIdToken()) },
        body: JSON.stringify({ action: "delete", uid: user.uid, paths }),
      }).catch(() => {});
    }
    await deleteProject(user.uid, p.id).catch(() => {});
    setProjects((prev) => prev.filter((x) => x.id !== p.id));
    setActiveId("new");
  }

  if (authLoading || !user || keysLoading) {
    return <div className="flex h-screen items-center justify-center bg-bg text-sm text-muted">Loading…</div>;
  }

  const stageIdx = project ? STAGES.indexOf(project.stage) : -1;
  const palette = sb?.palette ?? {};

  return (
    <div className="flex h-screen bg-bg">
      <aside className="flex w-[260px] shrink-0 flex-col border-r border-line bg-panel">
        <div className="flex items-center justify-between px-4 py-4">
          <Logo size={18} />
          <button onClick={() => router.push("/dashboard")} title="Back to dashboard" className="rounded-full p-1.5 text-muted hover:bg-panel2 hover:text-ink">
            <ArrowLeft size={17} />
          </button>
        </div>
        <div className="px-4 pb-3">
          <div className="mb-3 flex items-center gap-2">
            <Film size={16} className="text-gold" />
            <span className="text-sm font-medium text-ink">Venus Pro</span>
            <span className="rounded-full bg-goldSoft px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-gold">Beta</span>
          </div>
          <button onClick={() => setActiveId("new")} className="flex w-full items-center justify-center gap-2 rounded-lg bg-white py-2 text-sm font-medium text-bg hover:opacity-90">
            <Plus size={15} /> New video
          </button>
        </div>
        <nav className="flex-1 overflow-y-auto">
          {projects.map((p) => (
            <button key={p.id} onClick={() => setActiveId(p.id)} className={`flex w-full items-start gap-2.5 px-4 py-3 text-left ${p.id === activeId ? "bg-panel2" : "hover:bg-panel2/60"}`}>
              <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${p.status === "done" ? "bg-avatar-teal" : p.status === "error" ? "bg-red-400" : p.status === "running" ? "bg-gold" : "bg-faint"}`} />
              <span className="min-w-0">
                <span className="block truncate text-sm text-ink">{p.title}</span>
                <span className="block text-[11px] text-faint">{new Date(p.createdAt).toLocaleDateString()} · {p.aspect} · {p.seconds}s</span>
              </span>
            </button>
          ))}
          {projects.length === 0 && <p className="px-4 py-6 text-center text-xs text-faint">No videos yet.</p>}
        </nav>
      </aside>

      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-6xl px-6 py-7">
          {!e2bKey && (
            <div className="mb-5 rounded-lg border border-gold/50 bg-goldSoft/40 p-3.5 text-sm text-ink">
              Venus Pro needs a Studio computer: add your <b>E2B key</b> in the dashboard (API keys).
            </div>
          )}
          {cfg && !cfg.supabase && (
            <div className="mb-5 flex gap-2 rounded-lg border border-red-900/60 bg-red-950/30 p-3.5 text-sm text-red-200">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" />
              <span>Supabase is not set up. Add <b>SUPABASE_URL</b> and <b>SUPABASE_SERVICE_ROLE_KEY</b> in Vercel and redeploy, otherwise videos cannot be saved.</span>
            </div>
          )}

          {activeId === "new" || !project ? (
            <div className="mx-auto max-w-2xl">
              <h1 className="flex items-center gap-2 text-xl font-semibold text-ink"><Sparkles size={20} className="text-gold" /> New video</h1>
              <p className="mt-1 text-sm text-muted">Write a brief. The agent designs the look, writes the scenes, edits and renders. Max 60 seconds (beta). You can also type <code className="text-gold">/video your idea</code> in any chat.</p>

              <textarea value={brief} onChange={(e) => setBrief(e.target.value)} rows={5} placeholder="Example: A 45-second reel — “How AI agents are changing work in 2026”. Three main points, one comparison, and a call to action at the end." className={`${input} mt-5`} />

              <div className="mt-5 grid grid-cols-2 gap-4">
                <label className="text-xs text-muted">Length: {seconds}s
                  <input type="range" min={15} max={60} step={5} value={seconds} onChange={(e) => setSeconds(Number(e.target.value))} className="mt-2 w-full accent-[#E7B24D]" />
                </label>
                <label className="text-xs text-muted">Format
                  <select value={aspect} onChange={(e) => setAspect(e.target.value as Aspect)} className={`${input} mt-2`}>
                    {(Object.keys(ASPECTS) as Aspect[]).map((a) => <option key={a} value={a}>{ASPECTS[a].label}</option>)}
                  </select>
                </label>
              </div>

              <div className="mt-5 grid grid-cols-2 gap-3 text-sm text-ink">
                <label className="text-xs text-muted">Design mode
                  <select value={design} onChange={(e) => setDesign(e.target.value as "ai" | "library")} className={`${input} mt-2`}>
                    <option value="ai">AI-designed (unique look, slower)</option>
                    <option value="library">Library (faster, safer)</option>
                  </select>
                </label>
                <label className="text-xs text-muted">Final quality
                  <select value={quality} onChange={(e) => setQuality(e.target.value as "720p" | "1080p")} className={`${input} mt-2`}>
                    <option value="720p">720p (fast)</option>
                    <option value="1080p">1080p (slow)</option>
                  </select>
                </label>
                <label className="flex items-center gap-2"><input type="checkbox" checked={captions} onChange={(e) => setCaptions(e.target.checked)} /> Captions</label>
                <label className="flex items-center gap-2"><input type="checkbox" checked={review} onChange={(e) => setReview(e.target.checked)} /> Quality check (slower)</label>
                <label className={`flex items-center gap-2 ${openaiKey ? "" : "opacity-50"}`}>
                  <input type="checkbox" disabled={!openaiKey} checked={voice && Boolean(openaiKey)} onChange={(e) => setVoice(e.target.checked)} /> Voiceover {openaiKey ? "" : "(needs an OpenAI key)"}
                </label>
                {voice && openaiKey && (
                  <select value={voiceName} onChange={(e) => setVoiceName(e.target.value)} className="rounded-md border border-line bg-bg px-2 py-1 text-xs">
                    {VOICES.map((v) => <option key={v}>{v}</option>)}
                  </select>
                )}
              </div>

              <p className="mb-2 mt-5 text-xs text-muted">Model (shared with your chats — Claude Sonnet or GPT-4o work best)</p>
              <ModelPicker provider={provider} model={model} apiKeys={apiKeys} onChange={(p, m) => { setProvider(p); setModel(m); setModelPref(p, m); }} />

              <button onClick={createProject} disabled={!brief.trim() || !e2bKey || running || cfg?.supabase === false} className="mt-6 flex w-full items-center justify-center gap-2 rounded-lg bg-white py-3 text-sm font-medium text-bg hover:opacity-90 disabled:opacity-40">
                <Sparkles size={16} /> Make my video
              </button>
              <p className="mt-2 text-center text-[11px] text-faint">The first video can take 15-30 minutes (Studio setup + render). Keep this tab open.</p>
            </div>
          ) : (
            <div>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h1 className="truncate text-xl font-semibold text-ink">{project.title}</h1>
                  {sb?.concept && <p className="mt-1 line-clamp-2 text-xs text-muted">{sb.concept}</p>}
                </div>
                <button onClick={() => removeProject(project)} className="rounded-md p-2 text-muted hover:bg-panel2 hover:text-red-400" title="Delete"><Trash2 size={16} /></button>
              </div>

              <div className="mt-4 flex flex-wrap gap-1.5">
                {STAGES.slice(0, 8).map((s, i) => {
                  const done = stageIdx > i || project.status === "done";
                  const cur = stageIdx === i && project.status !== "done";
                  return (
                    <span key={s} className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs ${done ? "border-avatar-teal/50 text-avatar-teal" : cur ? "border-gold text-gold" : "border-line text-faint"}`}>
                      {cur && running ? <Loader2 size={11} className="animate-spin" /> : null}
                      {STAGE_LABEL[s]}
                    </span>
                  );
                })}
              </div>

              {progress && (
                <div className="mt-4">
                  <div className="mb-1 flex justify-between text-xs text-muted">
                    <span>{progress.label}</span>
                    <span>{progress.value === null ? "…" : Math.round(progress.value * 100) + "%"}</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-panel2">
                    <div className={`h-full rounded-full bg-gold ${progress.value === null ? "w-1/3 animate-pulse" : ""}`} style={progress.value === null ? undefined : { width: Math.round(progress.value * 100) + "%" }} />
                  </div>
                </div>
              )}

              {log.length > 0 && (
                <div className="mt-4 max-h-40 space-y-0.5 overflow-y-auto rounded-lg border border-line bg-panel p-3 font-mono text-[11px] leading-relaxed text-muted">
                  {log.map((l, i) => <p key={i} className="whitespace-pre-wrap">{l}</p>)}
                </div>
              )}

              {project.status === "error" && (
                <div className="mt-4 rounded-lg border border-red-900/60 bg-red-950/30 p-3.5 text-sm text-red-200">
                  <p className="whitespace-pre-wrap break-words">{project.error}</p>
                  <button onClick={() => void resume(project, project.stage)} disabled={running} className="mt-3 flex items-center gap-1.5 rounded-md bg-white px-3 py-1.5 text-xs font-medium text-bg hover:opacity-90 disabled:opacity-40">
                    <RefreshCw size={12} /> Retry from this step
                  </button>
                </div>
              )}
              {running && <button onClick={() => { cancelRef.current = true; }} className="mt-3 text-xs text-muted underline hover:text-ink">Stop</button>}

              <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_340px]">
                <div>
                  <div className="mb-2 flex gap-1.5">
                    {(["scene", "preview", "final"] as const).map((k) => (
                      <button key={k} onClick={() => setView(k)} className={`rounded-full border px-3 py-1 text-xs capitalize ${view === k ? "border-white text-ink" : "border-line text-muted hover:text-ink"}`}>
                        {k === "scene" ? "Scene preview" : k}
                      </button>
                    ))}
                  </div>
                  {urls[view] ? (
                    <video key={urls[view]} src={urls[view]} controls playsInline className="w-full rounded-lg border border-line bg-black" />
                  ) : (
                    <div className="flex aspect-video items-center justify-center rounded-lg border border-dashed border-line text-xs text-faint">Nothing rendered here yet</div>
                  )}
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button onClick={previewScene} disabled={running || !sb} className="flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-xs text-ink hover:bg-panel2 disabled:opacity-40"><Play size={12} /> Preview this scene</button>
                    <button onClick={() => render("preview")} disabled={running || !sb} className="flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-xs text-ink hover:bg-panel2 disabled:opacity-40"><RefreshCw size={12} /> Render preview</button>
                    <button onClick={() => render("final")} disabled={running || !sb} className="flex items-center gap-1.5 rounded-md bg-white px-3 py-1.5 text-xs font-medium text-bg hover:opacity-90 disabled:opacity-40"><Film size={12} /> Render final</button>
                    {urls.final && <a href={urls.final} download className="flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-xs text-ink hover:bg-panel2"><Download size={12} /> Download</a>}
                  </div>

                  {sb && (
                    <div className="mt-6">
                      <p className="mb-2 text-sm font-medium text-ink">Timeline · {sb.scenes.length} scenes · ~{Math.round(totalFramesOf(sb) / 30)}s</p>
                      <div className="flex gap-1 overflow-x-auto pb-2">
                        {sb.scenes.map((s, i) => (
                          <button key={i} onClick={() => setSel(i)} style={{ flex: `${s.seconds} 0 ${Math.max(78, s.seconds * 16)}px`, borderTopColor: TYPE_COLOR[s.type] ?? "#888" }} className={`min-w-[78px] rounded-lg border border-t-4 bg-panel px-2 py-2 text-left ${selIdx === i ? "border-gold" : "border-line"}`}>
                            <span className="block text-[10px] text-faint">{i + 1} · {s.type}{s.type === "custom" ? " ✦" : ""}</span>
                            <span className="block truncate text-xs text-ink">{summarizeScene(s) || "—"}</span>
                            <span className="block text-[10px] text-muted">{s.seconds}s</span>
                          </button>
                        ))}
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <select onChange={(e) => { if (e.target.value) addScene(e.target.value); e.target.value = ""; }} defaultValue="" className="rounded-md border border-line bg-bg px-2 py-1.5 text-xs text-ink">
                          <option value="">+ Add library scene…</option>
                          {SCENE_TYPES.filter((t) => t !== "custom").map((t) => <option key={t} value={t}>{t}</option>)}
                        </select>
                        <input value={addText} onChange={(e) => setAddText(e.target.value)} placeholder="Describe a new AI-designed scene…" className="min-w-[220px] flex-1 rounded-md border border-line bg-bg px-2.5 py-1.5 text-xs text-ink placeholder:text-faint focus:border-gold focus:outline-none" />
                        <button onClick={addAiScene} disabled={running || !addText.trim()} className="flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-xs text-ink hover:bg-panel2 disabled:opacity-40"><Sparkles size={12} /> Add AI scene</button>
                      </div>

                      <details className="mt-5 rounded-lg border border-line bg-panel p-3">
                        <summary className="cursor-pointer text-sm text-ink">Look & feel (palette, fonts, captions)</summary>
                        <div className="mt-3 grid grid-cols-3 gap-3">
                          {["bg1", "bg2", "accent", "accent2", "text", "muted"].map((k) => (
                            <label key={k} className="text-[11px] text-muted">{k}
                              <input type="color" value={palette[k] ?? "#000000"} onChange={(e) => saveSb({ ...sb, palette: { ...(sb.palette ?? {}), ...Object.fromEntries(["bg1", "bg2", "accent", "accent2", "text", "muted"].map((c) => [c, (sb.palette ?? {})[c] ?? THEMES.find((t) => t.id === sb.theme)?.colors[0] ?? "#111111"])), [k]: e.target.value } })} className="mt-1 h-8 w-full rounded border border-line bg-bg" />
                            </label>
                          ))}
                          {(["display", "body"] as const).map((k) => (
                            <label key={k} className="text-[11px] text-muted">{k} font
                              <select value={sb.fonts?.[k] ?? ""} onChange={(e) => saveSb({ ...sb, fonts: { ...(sb.fonts ?? {}), [k]: e.target.value || undefined } })} className={`${input} mt-1`}>
                                <option value="">default</option>
                                {FONT_NAMES.map((f) => <option key={f}>{f}</option>)}
                              </select>
                            </label>
                          ))}
                          <label className="flex items-center gap-2 pt-5 text-xs text-ink"><input type="checkbox" checked={sb.captions} onChange={(e) => saveSb({ ...sb, captions: e.target.checked })} /> Captions</label>
                        </div>
                      </details>
                    </div>
                  )}
                </div>

                <div>
                  {sb && scene ? (
                    <div className="space-y-3 rounded-lg border border-line bg-panel p-4">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-medium text-ink">Scene {selIdx + 1} <span className="ml-1 rounded-full bg-panel2 px-2 py-0.5 text-[11px] text-gold">{scene.type}</span></p>
                        <div className="flex gap-0.5 text-muted">
                          <button onClick={() => move(selIdx, -1)} title="Move earlier" className="rounded p-1.5 hover:bg-panel2 hover:text-ink"><ChevronLeft size={14} /></button>
                          <button onClick={() => move(selIdx, 1)} title="Move later" className="rounded p-1.5 hover:bg-panel2 hover:text-ink"><ChevronRight size={14} /></button>
                          <button onClick={() => duplicate(selIdx)} title="Duplicate" className="rounded p-1.5 hover:bg-panel2 hover:text-ink"><Copy size={14} /></button>
                          <button onClick={() => remove(selIdx)} title="Delete scene" className="rounded p-1.5 hover:bg-panel2 hover:text-red-400"><Trash2 size={14} /></button>
                        </div>
                      </div>

                      <div className="rounded-lg border border-gold/40 bg-goldSoft/30 p-2.5">
                        <p className="mb-1.5 flex items-center gap-1.5 text-[11px] text-gold"><Wand2 size={12} /> Ask the agent to change this scene</p>
                        <div className="flex gap-1.5">
                          <input value={aiText} onChange={(e) => setAiText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && askAi()} placeholder="e.g. make it punchier, add a countdown…" className="min-w-0 flex-1 rounded-md border border-line bg-bg px-2.5 py-1.5 text-xs text-ink placeholder:text-faint focus:border-gold focus:outline-none" />
                          <button onClick={askAi} disabled={running || !aiText.trim()} className="rounded-md bg-white px-3 text-xs font-medium text-bg hover:opacity-90 disabled:opacity-40">Apply</button>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <label className="text-[11px] text-muted">Seconds
                          <input type="number" min={2.5} max={14} step={0.5} value={scene.seconds} onChange={(e) => patchScene(selIdx, { seconds: Math.min(14, Math.max(2.5, Number(e.target.value) || 4)) })} className={`${input} mt-1`} />
                        </label>
                        <label className="text-[11px] text-muted">Transition
                          <select value={String(scene.transition ?? "")} onChange={(e) => patchScene(selIdx, { transition: e.target.value || undefined })} className={`${input} mt-1`}>
                            <option value="">default</option>
                            {TRANSITIONS.map((t) => <option key={t}>{t}</option>)}
                          </select>
                        </label>
                      </div>
                      {scene.type !== "custom" && (
                        <label className="block text-[11px] text-muted">Text size ({Number(scene.fontScale ?? 1).toFixed(1)}×)
                          <input type="range" min={0.5} max={1.3} step={0.05} value={Number(scene.fontScale ?? 1)} onChange={(e) => patchScene(selIdx, { fontScale: Number(e.target.value) })} className="mt-1 w-full accent-[#E7B24D]" />
                        </label>
                      )}
                      <label className="block text-[11px] text-muted">Narration
                        <textarea rows={2} value={String(scene.narration ?? "")} onChange={(e) => patchScene(selIdx, { narration: e.target.value })} className={`${input} mt-1`} />
                      </label>
                      {project.voice && openaiKey && (
                        <button onClick={updateVoice} disabled={running} className="text-[11px] text-gold underline disabled:opacity-40">Re-record the voice for this scene</button>
                      )}

                      {scene.type === "custom" && (
                        <>
                          <label className="block text-[11px] text-muted">Design brief
                            <textarea rows={3} value={String(scene.brief ?? "")} onChange={(e) => patchScene(selIdx, { brief: e.target.value })} className={`${input} mt-1`} />
                          </label>
                          <button onClick={regenDesign} disabled={running} className="flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-xs text-ink hover:bg-panel2 disabled:opacity-40"><Sparkles size={12} /> Redesign with the agent</button>
                          <button onClick={() => setShowCode((v) => !v)} className="block text-[11px] text-muted underline">{showCode ? "Hide" : "Show"} code</button>
                          {showCode && <textarea rows={12} value={String(scene.code ?? "")} onChange={(e) => patchScene(selIdx, { code: e.target.value })} className={`${input} font-mono text-[10px]`} />}
                        </>
                      )}

                      {Object.entries(scene).filter(([k]) => !HIDDEN.has(k)).map(([k, v]) => (
                        <Field key={k + selIdx} label={k} value={v} onChange={(nv) => patchScene(selIdx, { [k]: nv })} />
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted">Select a scene on the timeline.</p>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}