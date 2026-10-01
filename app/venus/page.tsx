"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowLeft, Check, Download, Film, Loader2, Plus, RefreshCw, Sparkles, Trash2 } from "lucide-react";
import Logo from "@/components/Logo";
import ModelPicker from "@/components/dashboard/ModelPicker";
import { useAuth } from "@/lib/auth-context";
import { useKeys } from "@/lib/keys-context";
import { PROVIDERS, providerMeta, type ProviderId } from "@/lib/providers";
import {
  ASPECTS,
  THEMES,
  sanitizeStoryboard,
  sceneLayout,
  summarizeScene,
  totalFramesOf,
  type Aspect,
  type Storyboard,
} from "@/lib/venus-schema";
import {
  deleteProject,
  getStudio,
  listProjects,
  saveProject,
  saveStudio,
  type Stage,
  type VenusProject,
} from "@/lib/venus";

async function readJson(res: Response) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { error: `Server returned ${res.status}: ${text.slice(0, 200) || "(empty response)"}` };
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const STAGES: Stage[] = ["studio", "script", "assets", "voice", "preview", "review", "final", "done"];
const STAGE_LABEL: Record<string, string> = {
  studio: "Studio",
  script: "Script",
  assets: "Assets",
  voice: "Voice",
  preview: "Preview",
  review: "Quality check",
  final: "Final",
};
const VOICES = ["nova", "alloy", "echo", "fable", "onyx", "shimmer"];

function parseSb(p: VenusProject): Storyboard | null {
  if (!p.storyboardJson) return null;
  try {
    return JSON.parse(p.storyboardJson) as Storyboard;
  } catch {
    return null;
  }
}

function SceneEditor({
  scene,
  index,
  onSave,
}: {
  scene: Storyboard["scenes"][number];
  index: number;
  onSave: (i: number, s: unknown) => void;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(JSON.stringify(scene, null, 2));
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => setText(JSON.stringify(scene, null, 2)), [scene]);
  return (
    <div className="rounded-lg border border-line bg-panel">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left"
      >
        <span className="text-xs text-faint">{index + 1}</span>
        <span className="rounded-full bg-panel2 px-2 py-0.5 text-[11px] text-gold">{scene.type}</span>
        <span className="min-w-0 flex-1 truncate text-sm text-ink">{summarizeScene(scene) || "—"}</span>
        <span className="text-xs text-muted">{scene.seconds}s</span>
      </button>
      {open && (
        <div className="space-y-2 border-t border-line p-3">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={10}
            className="w-full rounded-md border border-line bg-bg p-2.5 font-mono text-[11px] leading-relaxed text-ink focus:border-gold focus:outline-none"
          />
          {err && <p className="text-xs text-red-300">{err}</p>}
          <button
            onClick={() => {
              try {
                onSave(index, JSON.parse(text));
                setErr(null);
                setOpen(false);
              } catch {
                setErr("Ye valid JSON nahi hai.");
              }
            }}
            className="rounded-md bg-white px-3 py-1.5 text-xs font-medium text-bg hover:opacity-90"
          >
            Save scene
          </button>
        </div>
      )}
    </div>
  );
}

export default function VenusPage() {
  const { user, loading: authLoading } = useAuth();
  const { apiKeys, e2bKey, loading: keysLoading } = useKeys();
  const router = useRouter();

  const [projects, setProjects] = useState<VenusProject[]>([]);
  const [activeId, setActiveId] = useState<string | "new">("new");
  const [cfg, setCfg] = useState<{ supabase: boolean; pexels: boolean } | null>(null);
  const [urls, setUrls] = useState<{ preview?: string; final?: string }>({});
  const [log, setLog] = useState<string[]>([]);
  const [progress, setProgress] = useState<{ label: string; value: number | null } | null>(null);
  const [running, setRunning] = useState(false);
  const cancelRef = useRef(false);

  // new-project form
  const firstProvider = PROVIDERS.find((p) => apiKeys[p.id])?.id ?? PROVIDERS[0].id;
  const [brief, setBrief] = useState("");
  const [seconds, setSeconds] = useState(45);
  const [aspect, setAspect] = useState<Aspect>("16:9");
  const [theme, setTheme] = useState("midnight");
  const [voice, setVoice] = useState(false);
  const [voiceName, setVoiceName] = useState("nova");
  const [captions, setCaptions] = useState(true);
  const [quality, setQuality] = useState<"720p" | "1080p">("720p");
  const [review, setReview] = useState(true);
  const [provider, setProvider] = useState<ProviderId>(firstProvider);
  const [model, setModel] = useState(providerMeta(firstProvider).models[0]);

  const openaiKey = apiKeys.openai;
  const project = projects.find((p) => p.id === activeId) ?? null;
  const storyboard = project ? parseSb(project) : null;

  useEffect(() => {
    if (!authLoading && !user) router.replace("/");
  }, [authLoading, user, router]);

  // Keys load after the first render, so the provider chosen at startup may
  // have no key. Move the form to a provider that actually has one.
  useEffect(() => {
    if (apiKeys[provider]) return;
    const found = PROVIDERS.find((p) => apiKeys[p.id]);
    if (found) {
      setProvider(found.id);
      setModel(providerMeta(found.id).models[0]);
    }
  }, [apiKeys, provider]);

  useEffect(() => {
    if (!user) return;
    listProjects(user.uid).then(setProjects).catch(() => {});
    fetch("/api/venus/media").then(readJson).then(setCfg).catch(() => {});
  }, [user]);

  // fresh signed links whenever a project is opened
  useEffect(() => {
    setUrls({});
    if (!user || !project) return;
    (["preview", "final"] as const).forEach(async (k) => {
      const path = k === "preview" ? project.previewPath : project.finalPath;
      if (!path) return;
      try {
        const u = await signedUrl(path, k === "final" ? "venus-" + project.id + ".mp4" : undefined);
        setUrls((prev) => ({ ...prev, [k]: u }));
      } catch {
        // link will be fetched again after the next render
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, project?.previewPath, project?.finalPath, user]);

  async function authHeaders() {
    const token = await user!.getIdToken();
    return { "Content-Type": "application/json", Authorization: "Bearer " + token };
  }

  async function signedUrl(path: string, download?: string): Promise<string> {
    const res = await fetch("/api/venus/media", {
      method: "POST",
      headers: await authHeaders(),
      body: JSON.stringify({ action: "url", uid: user!.uid, path, download }),
    });
    const data = await readJson(res);
    if (!res.ok) throw new Error(data?.error || "Video link nahi mila.");
    return data.url as string;
  }

  async function studio(action: string, extra: Record<string, unknown> = {}) {
    const res = await fetch("/api/venus/studio", {
      method: "POST",
      headers: await authHeaders(),
      body: JSON.stringify({ action, uid: user!.uid, e2bKey, ...extra }),
    });
    const data = await readJson(res);
    if (!res.ok) throw new Error(data?.error || "Studio request failed.");
    return data;
  }

  // ---------------- the pipeline ----------------

  async function runPipeline(start: VenusProject, from: Stage) {
    if (!user) return;
    if (!e2bKey) return;
    let p: VenusProject = { ...start };
    cancelRef.current = false;
    setRunning(true);
    setLog([]);

    const say = (m: string) => setLog((prev) => [...prev.slice(-80), m]);
    const upd = async (patch: Partial<VenusProject>) => {
      p = { ...p, ...patch, updatedAt: Date.now() };
      setProjects((prev) => prev.map((x) => (x.id === p.id ? p : x)));
      await saveProject(user.uid, p).catch(() => {});
    };
    const todo = (s: Stage) => STAGES.indexOf(from) <= STAGES.indexOf(s);
    const check = () => {
      if (cancelRef.current) throw new Error("Rok diya gaya.");
    };
    const sbNow = (): Storyboard => {
      const s = parseSb(p);
      if (!s) throw new Error("Storyboard nahi mila.");
      return s;
    };

    try {
      // 1) Studio
      await upd({ status: "running", stage: "studio", error: undefined });
      say("🎬 Studio computer check kar raha hoon…");
      setProgress({ label: "Studio computer", value: null });
      let sandboxId = (await getStudio(user.uid))?.sandboxId ?? null;

      const waitReady = async (id: string) => {
        for (let i = 0; i < 220; i++) {
          check();
          await sleep(5000);
          const s = await studio("status", { sandboxId: id });
          const last = String(s.log || "").split("\n").filter(Boolean).slice(-1)[0];
          if (last) say("⚙️ " + last.slice(0, 120));
          if (s.state === "ready") return;
          if (s.state === "failed") throw new Error("Studio install fail hua:\n" + String(s.log).slice(-600));
        }
        throw new Error("Studio setup bahut der le raha hai (timeout).");
      };

      let ready = false;
      if (sandboxId) {
        try {
          const s = await studio("status", { sandboxId });
          if (s.state === "ready") ready = true;
          else if (s.state === "installing") {
            say("Studio install chal raha hai…");
            await waitReady(sandboxId);
            ready = true;
          } else {
            say("Studio template update kar raha hoon…");
            await studio("setup", { sandboxId });
            await waitReady(sandboxId);
            ready = true;
          }
        } catch (e) {
          if (!String((e as Error).message).includes("SANDBOX_GONE")) throw e;
          sandboxId = null;
        }
      }
      if (!ready) {
        say("Naya Studio computer bana raha hoon — pehli baar 5-8 minute lagte hain (Node, Remotion, Chrome install).");
        const c = await studio("create");
        sandboxId = c.sandboxId as string;
        await saveStudio(user.uid, { sandboxId });
        await studio("setup", { sandboxId });
        await waitReady(sandboxId);
      }
      const sid = sandboxId as string;
      say("✅ Studio ready.");

      // 2) Script
      if (todo("script")) {
        check();
        await upd({ stage: "script" });
        say("✍️ Agent storyboard likh raha hai…");
        setProgress({ label: "Storyboard", value: null });

        // If this project's provider has no key (e.g. it was saved before the
        // keys finished loading), fall back to a provider that does.
        if (!apiKeys[p.provider]) {
          const fallback = PROVIDERS.find((x) => apiKeys[x.id]);
          if (fallback) {
            say(`ℹ️ ${providerMeta(p.provider).label} ki key nahi mili — ${fallback.label} use kar raha hoon.`);
            await upd({ provider: fallback.id, model: providerMeta(fallback.id).models[0] });
          }
        }
        const key = apiKeys[p.provider];
        if (!key) throw new Error("Is model ke provider ki API key Settings mein nahi hai.");
        const call = () =>
          fetch("/api/venus/ai", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              kind: "storyboard",
              provider: p.provider,
              apiKey: key,
              model: p.model,
              brief: p.brief,
              seconds: p.seconds,
              aspect: p.aspect,
              theme: p.theme,
              voice: p.voice && Boolean(openaiKey),
              captions: p.captions,
            }),
          }).then(readJson);
        let r = await call();
        if (!r.storyboard) {
          say("Pehli koshish fail — dobara try kar raha hoon…");
          r = await call();
        }
        if (!r.storyboard) throw new Error(r.error || "Storyboard nahi ban paya.");
        await upd({ storyboardJson: JSON.stringify(r.storyboard), title: r.storyboard.title || p.title });
        say(`📋 ${r.storyboard.scenes.length} scenes ka storyboard ready.`);
      }

      // 3) Assets
      if (todo("assets")) {
        check();
        await upd({ stage: "assets" });
        const sb = sbNow();
        if (sb.scenes.some((s) => s.type === "image")) {
          if (cfg?.pexels) {
            say("🖼️ Stock photos dhoondh raha hoon…");
            setProgress({ label: "Photos", value: null });
            const a = await studio("assets", { sandboxId: sid, projectId: p.id, storyboard: sb });
            const images = (a.images ?? {}) as Record<string, string>;
            const next = { ...sb, scenes: sb.scenes.map((s, i) => (images[String(i)] ? { ...s, image: images[String(i)] } : s)) };
            await upd({ storyboardJson: JSON.stringify(next) });
            say(`${Object.keys(images).length} photo mil gayi.`);
          } else {
            say("ℹ️ PEXELS_API_KEY nahi hai — photo scenes gradient background pe banenge.");
          }
        }
      }

      // 4) Voice
      if (todo("voice") && p.voice) {
        check();
        await upd({ stage: "voice" });
        if (!openaiKey) {
          say("ℹ️ OpenAI key nahi hai — voiceover skip kar raha hoon.");
        } else {
          let sb = sbNow();
          for (let i = 0; i < sb.scenes.length; i++) {
            check();
            const narration = String(sb.scenes[i].narration ?? "").trim();
            if (!narration) continue;
            setProgress({ label: `Voiceover ${i + 1}/${sb.scenes.length}`, value: i / sb.scenes.length });
            const t = await studio("tts", { sandboxId: sid, projectId: p.id, index: i, text: narration, openaiKey, voice: p.voiceName });
            sb = {
              ...sb,
              scenes: sb.scenes.map((s, j) =>
                j === i
                  ? { ...s, voice: t.file, seconds: t.seconds ? Math.min(14, Math.max(Number(s.seconds), Math.round((t.seconds + 0.6) * 10) / 10)) : s.seconds }
                  : s
              ),
            };
          }
          await upd({ storyboardJson: JSON.stringify(sb) });
          const total = Math.round(totalFramesOf(sb) / 30);
          say(`🎙️ Voiceover ready. Video lambai: ~${total}s${total > 60 ? " (⚠️ 60s se zyada — narration chhoti karni padegi)" : ""}.`);
        }
      }

      // helper: prepare + render + upload
      const renderAndUpload = async (kind: "preview" | "final"): Promise<string> => {
        const sb = sbNow();
        await studio("prepare", { sandboxId: sid, projectId: p.id, storyboard: sb });
        const total = totalFramesOf(sb);
        const scale = kind === "preview" ? 0.5 : p.quality === "1080p" ? 1.5 : 1;
        const { jobId } = await studio("render", { sandboxId: sid, projectId: p.id, kind, scale });
        say(kind === "preview" ? "🎞️ Preview render shuru (480p)…" : `🎞️ Final render shuru (${p.quality})…`);
        const t0 = Date.now();
        for (;;) {
          check();
          if (Date.now() - t0 > 50 * 60_000) throw new Error("Render 50 minute se zyada le raha hai — rok diya.");
          await sleep(3500);
          const s = await studio("progress", { sandboxId: sid, jobId, total });
          setProgress({ label: kind === "preview" ? "Preview render" : "Final render", value: s.percent });
          if (s.done) {
            if (s.exitCode !== 0) throw new Error("Render fail hua:\n" + String(s.log).slice(-700));
            break;
          }
        }
        setProgress({ label: "Upload", value: null });
        say("☁️ Supabase pe upload ho raha hai…");
        const up = await studio("upload", { sandboxId: sid, projectId: p.id, kind });
        say(`✅ ${kind} upload ho gaya (${Math.round((up.bytes || 0) / 1024 / 1024 * 10) / 10} MB).`);
        return up.path as string;
      };

      // 5) Preview
      if (todo("preview")) {
        check();
        await upd({ stage: "preview" });
        const path = await renderAndUpload("preview");
        await upd({ previewPath: path });
      }

      // 6) Quality check
      if (todo("review") && p.review) {
        check();
        await upd({ stage: "review" });
        const sb = sbNow();
        const layout = sceneLayout(sb);
        const pick = sb.scenes.map((_, i) => i);
        const chosen = pick.length > 6 ? pick.filter((_, k) => k % Math.ceil(pick.length / 6) === 0).slice(0, 6) : pick;
        const times = chosen.map((i) => Math.round(((layout[i].from + layout[i].dur / 2) / 30) * 100) / 100);
        say("🔍 Agent preview ke frames khud dekh raha hai…");
        setProgress({ label: "Quality check", value: null });
        try {
          const f = await studio("frames", { sandboxId: sid, projectId: p.id, times });
          const key = apiKeys[p.provider];
          const r = await fetch("/api/venus/ai", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              kind: "review",
              provider: p.provider,
              apiKey: key,
              model: p.model,
              image: { mediaType: f.mediaType, data: f.image },
              tiles: chosen.map((i, k) => ({ tile: k + 1, index: i, type: sb.scenes[i].type, summary: summarizeScene(sb.scenes[i]).slice(0, 80) })),
            }),
          }).then(readJson);
          const issues = (r.issues ?? []) as Array<{ scene: number; problem: string; patch: Record<string, unknown> }>;
          const fixes = issues.filter((x) => Number.isInteger(x.scene) && x.scene >= 0 && x.scene < sb.scenes.length && Object.keys(x.patch ?? {}).length > 0);
          if (r.verdict === "fix" && fixes.length > 0) {
            fixes.forEach((x) => say(`🛠️ Scene ${x.scene + 1}: ${x.problem}`));
            const next = {
              ...sb,
              scenes: sb.scenes.map((s, i) => {
                const fx = fixes.filter((x) => x.scene === i);
                return fx.length ? sanitizeStoryboard({ ...sb, scenes: [{ ...s, ...Object.assign({}, ...fx.map((x) => x.patch)) }] }, { keepFiles: true }).scenes[0] : s;
              }),
            };
            await upd({ storyboardJson: JSON.stringify(next) });
            const path = await renderAndUpload("preview");
            await upd({ previewPath: path });
            say("✅ Fixes lagake preview dobara bana diya.");
          } else {
            say("👍 Quality check pass — koi bada issue nahi mila.");
          }
        } catch (e) {
          say("ℹ️ Quality check skip hua: " + (e as Error).message.slice(0, 120));
        }
      }

      // 7) Final
      if (todo("final")) {
        check();
        await upd({ stage: "final" });
        const path = await renderAndUpload("final");
        await upd({ finalPath: path });
      }

      await upd({ stage: "done", status: "done" });
      setProgress(null);
      say("🎉 Video ready!");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Pipeline fail hui.";
      say("⚠️ " + msg);
      await upd({ status: "error", error: msg });
      setProgress(null);
    } finally {
      setRunning(false);
    }
  }

  async function createProject() {
    if (!user || !brief.trim()) return;
    const p: VenusProject = {
      id: "v" + Date.now().toString(36),
      title: brief.trim().slice(0, 48),
      brief: brief.trim(),
      seconds,
      aspect,
      theme,
      voice,
      voiceName,
      captions,
      quality,
      review,
      provider,
      model,
      stage: "studio",
      status: "idle",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await saveProject(user.uid, p).catch(() => {});
    setProjects((prev) => [p, ...prev]);
    setActiveId(p.id);
    setBrief("");
    void runPipeline(p, "studio");
  }

  async function removeProject(p: VenusProject) {
    if (!user || !window.confirm("Ye video project delete karein?")) return;
    const paths = [p.previewPath, p.finalPath].filter(Boolean) as string[];
    if (paths.length) {
      fetch("/api/venus/media", {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify({ action: "delete", uid: user.uid, paths }),
      }).catch(() => {});
    }
    await deleteProject(user.uid, p.id).catch(() => {});
    setProjects((prev) => prev.filter((x) => x.id !== p.id));
    setActiveId("new");
  }

  function saveScene(i: number, raw: unknown) {
    if (!project || !storyboard || !user) return;
    const next = sanitizeStoryboard({ ...storyboard, scenes: storyboard.scenes.map((s, j) => (j === i ? raw : s)) }, { keepFiles: true });
    const upd = { ...project, storyboardJson: JSON.stringify(next), updatedAt: Date.now() };
    setProjects((prev) => prev.map((x) => (x.id === project.id ? upd : x)));
    saveProject(user.uid, upd).catch(() => {});
  }

  if (authLoading || !user || keysLoading) {
    return <div className="flex h-screen items-center justify-center bg-bg text-sm text-muted">Loading…</div>;
  }

  const stageIdx = project ? STAGES.indexOf(project.stage) : -1;
  const input = "w-full rounded-lg border border-line bg-bg px-3.5 py-2.5 text-sm text-ink placeholder:text-faint focus:border-gold focus:outline-none";

  return (
    <div className="flex h-screen bg-bg">
      <aside className="flex w-[290px] shrink-0 flex-col border-r border-line bg-panel">
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
          {projects.length === 0 && <p className="px-4 py-6 text-center text-xs text-faint">Abhi koi video nahi.</p>}
        </nav>
      </aside>

      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-6 py-8">
          {!e2bKey && (
            <div className="mb-5 rounded-lg border border-gold/50 bg-goldSoft/40 p-3.5 text-sm text-ink">
              Venus Pro ke liye Studio computer chahiye: dashboard → API keys mein <b>E2B key</b> daalo.
            </div>
          )}
          {cfg && !cfg.supabase && (
            <div className="mb-5 flex gap-2 rounded-lg border border-red-900/60 bg-red-950/30 p-3.5 text-sm text-red-200">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" />
              <span>Supabase set up nahi hai. Vercel mein <b>SUPABASE_URL</b> aur <b>SUPABASE_SERVICE_ROLE_KEY</b> add karke redeploy karo, warna videos save nahi hongi.</span>
            </div>
          )}

          {activeId === "new" || !project ? (
            <div>
              <h1 className="flex items-center gap-2 text-xl font-semibold text-ink"><Sparkles size={20} className="text-gold" /> Naya video</h1>
              <p className="mt-1 text-sm text-muted">Brief likho — agent script, motion graphics, voiceover, edit aur render sab khud karega. Max 60 second (beta).</p>

              <textarea value={brief} onChange={(e) => setBrief(e.target.value)} rows={5} placeholder="Jaise: 45 second ka reel — 'AI agents 2026 mein kaam kaise badal rahe hain'. 3 main points, ek comparison, end mein CTA." className={`${input} mt-5`} />

              <div className="mt-5 grid grid-cols-2 gap-4">
                <label className="text-xs text-muted">Lambai: {seconds}s
                  <input type="range" min={15} max={60} step={5} value={seconds} onChange={(e) => setSeconds(Number(e.target.value))} className="mt-2 w-full accent-[#E7B24D]" />
                </label>
                <label className="text-xs text-muted">Format
                  <select value={aspect} onChange={(e) => setAspect(e.target.value as Aspect)} className={`${input} mt-2`}>
                    {(Object.keys(ASPECTS) as Aspect[]).map((a) => <option key={a} value={a}>{ASPECTS[a].label}</option>)}
                  </select>
                </label>
              </div>

              <p className="mb-2 mt-5 text-xs text-muted">Theme</p>
              <div className="flex flex-wrap gap-2">
                {THEMES.map((t) => (
                  <button key={t.id} onClick={() => setTheme(t.id)} className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs ${theme === t.id ? "border-white text-ink" : "border-line text-muted hover:text-ink"}`}>
                    <span className="flex">{t.colors.map((c) => <span key={c} className="-ml-1 h-3.5 w-3.5 rounded-full border border-black/30 first:ml-0" style={{ background: c }} />)}</span>
                    {t.label}
                  </button>
                ))}
              </div>

              <div className="mt-5 grid grid-cols-2 gap-3 text-sm text-ink">
                <label className="flex items-center gap-2"><input type="checkbox" checked={captions} onChange={(e) => setCaptions(e.target.checked)} /> Captions</label>
                <label className="flex items-center gap-2"><input type="checkbox" checked={review} onChange={(e) => setReview(e.target.checked)} /> Quality check (thoda slow)</label>
                <label className={`flex items-center gap-2 ${openaiKey ? "" : "opacity-50"}`}>
                  <input type="checkbox" disabled={!openaiKey} checked={voice && Boolean(openaiKey)} onChange={(e) => setVoice(e.target.checked)} /> Voiceover {openaiKey ? "" : "(OpenAI key chahiye)"}
                </label>
                {voice && openaiKey && (
                  <select value={voiceName} onChange={(e) => setVoiceName(e.target.value)} className="rounded-md border border-line bg-bg px-2 py-1 text-xs">
                    {VOICES.map((v) => <option key={v}>{v}</option>)}
                  </select>
                )}
                <label className="flex items-center gap-2">Final quality
                  <select value={quality} onChange={(e) => setQuality(e.target.value as "720p" | "1080p")} className="rounded-md border border-line bg-bg px-2 py-1 text-xs">
                    <option value="720p">720p (fast)</option>
                    <option value="1080p">1080p (slow)</option>
                  </select>
                </label>
              </div>

              <p className="mb-2 mt-5 text-xs text-muted">Agent ka model (Claude Sonnet / GPT-4o best rahenge)</p>
              <ModelPicker provider={provider} model={model} apiKeys={apiKeys} onChange={(p, m) => { setProvider(p); setModel(m); }} />

              <button onClick={createProject} disabled={!brief.trim() || !e2bKey || running || cfg?.supabase === false} className="mt-6 flex w-full items-center justify-center gap-2 rounded-lg bg-white py-3 text-sm font-medium text-bg hover:opacity-90 disabled:opacity-40">
                <Sparkles size={16} /> Video banao
              </button>
              <p className="mt-2 text-center text-[11px] text-faint">Pehla video 15-30 min le sakta hai (Studio setup + render). Tab khuli rakhna.</p>
            </div>
          ) : (
            <div>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h1 className="truncate text-xl font-semibold text-ink">{project.title}</h1>
                  <p className="mt-1 line-clamp-2 text-xs text-muted">{project.brief}</p>
                </div>
                <button onClick={() => removeProject(project)} className="rounded-md p-2 text-muted hover:bg-panel2 hover:text-red-400" title="Delete"><Trash2 size={16} /></button>
              </div>

              <div className="mt-5 flex flex-wrap gap-1.5">
                {STAGES.slice(0, 7).map((s, i) => {
                  const done = stageIdx > i || project.status === "done";
                  const cur = stageIdx === i && project.status !== "done";
                  return (
                    <span key={s} className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs ${done ? "border-avatar-teal/50 text-avatar-teal" : cur ? "border-gold text-gold" : "border-line text-faint"}`}>
                      {done ? <Check size={11} /> : cur && running ? <Loader2 size={11} className="animate-spin" /> : null}
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

              {(running || project.status === "error") && log.length > 0 && (
                <div className="mt-4 max-h-44 space-y-0.5 overflow-y-auto rounded-lg border border-line bg-panel p-3 font-mono text-[11px] leading-relaxed text-muted">
                  {log.map((l, i) => <p key={i} className="whitespace-pre-wrap">{l}</p>)}
                </div>
              )}

              {project.status === "error" && (
                <div className="mt-4 rounded-lg border border-red-900/60 bg-red-950/30 p-3.5 text-sm text-red-200">
                  <p className="whitespace-pre-wrap break-words">{project.error}</p>
                  <button onClick={() => void runPipeline(project, project.stage)} disabled={running} className="mt-3 flex items-center gap-1.5 rounded-md bg-white px-3 py-1.5 text-xs font-medium text-bg hover:opacity-90 disabled:opacity-40">
                    <RefreshCw size={12} /> Wahin se dobara chalao
                  </button>
                </div>
              )}

              {running && (
                <button onClick={() => { cancelRef.current = true; }} className="mt-3 text-xs text-muted underline hover:text-ink">Rok do</button>
              )}

              <div className="mt-6 grid gap-5 md:grid-cols-2">
                {(["preview", "final"] as const).map((k) => (
                  <div key={k}>
                    <p className="mb-1.5 text-xs uppercase tracking-wide text-faint">{k === "preview" ? "Preview (480p)" : `Final (${project.quality})`}</p>
                    {urls[k] ? (
                      <>
                        <video src={urls[k]} controls playsInline className="w-full rounded-lg border border-line bg-black" />
                        {k === "final" && (
                          <a href={urls.final} download className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-white px-3 py-1.5 text-xs font-medium text-bg hover:opacity-90"><Download size={12} /> Download</a>
                        )}
                      </>
                    ) : (
                      <div className="flex aspect-video items-center justify-center rounded-lg border border-dashed border-line text-xs text-faint">abhi nahi bana</div>
                    )}
                  </div>
                ))}
              </div>

              {storyboard && (
                <div className="mt-8">
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-sm font-medium text-ink">Storyboard · {storyboard.scenes.length} scenes · ~{Math.round(totalFramesOf(storyboard) / 30)}s</p>
                    <button onClick={() => void runPipeline(project, "final")} disabled={running || !e2bKey} className="flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-xs text-ink hover:bg-panel2 disabled:opacity-40">
                      <RefreshCw size={12} /> Edit ke baad final dobara render
                    </button>
                  </div>
                  <div className="space-y-1.5">
                    {storyboard.scenes.map((s, i) => <SceneEditor key={i} scene={s} index={i} onSave={saveScene} />)}
                  </div>
                  <p className="mt-2 text-[11px] text-faint">Kisi scene ko kholke JSON badal sakte ho (text, seconds, theme ke andar nahi). Narration badli to voiceover purani hi rahegi.</p>
                </div>
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}