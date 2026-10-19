import { NextResponse } from "next/server";
import { connect, createSandbox, exec } from "@/lib/e2b-server";
import { readBody, requestStatus } from "@/lib/request";
import { createSignedUpload } from "@/lib/supabase-server";
import { DIR, jobStatus, prepareProject, safeId, setupStudio, startJob, studioState, writeBinary, writeFiles } from "@/lib/venus-server";
import { AUDIO_MOODS, sanitizeStoryboard, sceneLayout, totalFramesOf, type Storyboard } from "@/lib/venus-schema";
import { MAIN_SOURCE, UI_SOURCE } from "@/lib/venus-kit";
import { SYNTH_V2_SOURCE } from "@/lib/venus-audio";
import { audioCodePrompt, checkAudioCode, extractAudioCode, timelineOf } from "@/lib/venus-audio-prompts";
import { getAdminDb } from "@/lib/firebase-admin";
import { callProvider } from "@/lib/ai-providers-server";
import { resolveValue } from "@/lib/vault";
import { addTokens, estTokens } from "@/lib/billing-server";
import type { ProviderId } from "@/lib/providers";

export const runtime = "nodejs";
export const maxDuration = 60;

const fail = (message: string, status = 500) => NextResponse.json({ error: message }, { status });

// ---------- real-image search (same sources as chat's image.search) ----------
type WebImage = { url: string; width: number; height: number };
const IMAGE_UA = "AgenticVenus/1.0 (https://agenticvenus.app; Venus Pro image search)";
async function findWebImages(query: string): Promise<WebImage[]> {
  const results: WebImage[] = [];
  const [commons, openverse] = await Promise.allSettled([
    fetch("https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search&gsrnamespace=6&gsrlimit=12&gsrsearch=" + encodeURIComponent(query) + "&prop=imageinfo&iiprop=url|mime|size&iiurlwidth=1600", {
      headers: { "User-Agent": IMAGE_UA, Accept: "application/json" }, signal: AbortSignal.timeout(10_000),
    }).then(async r => {
      if (!r.ok) return [] as WebImage[];
      const j = await r.json() as any;
      return (Object.values(j?.query?.pages ?? {}) as any[]).flatMap(p => {
        const ii = p.imageinfo?.[0];
        const url = String(ii?.thumburl ?? ii?.url ?? "");
        if (!/^https:\/\//.test(url) || !["image/jpeg", "image/png", "image/webp"].includes(String(ii?.mime)) || (ii?.width ?? 0) < 300) return [];
        return [{ url, width: Number(ii.width) || 0, height: Number(ii.height) || 0 }];
      });
    }),
    fetch("https://api.openverse.org/v1/images/?q=" + encodeURIComponent(query) + "&page_size=12&mature=false", {
      headers: { "User-Agent": IMAGE_UA, Accept: "application/json" }, signal: AbortSignal.timeout(10_000),
    }).then(async r => {
      if (!r.ok) return [] as WebImage[];
      const j = await r.json() as any;
      return (j?.results ?? []).flatMap((x: any) => {
        const url = String(x.url ?? "");
        if (!/^https:\/\//.test(url)) return [];
        return [{ url, width: Number(x.width) || 0, height: Number(x.height) || 0 }];
      });
    }),
  ]);
  if (commons.status === "fulfilled") results.push(...commons.value);
  if (openverse.status === "fulfilled") results.push(...openverse.value);
  return results;
}

async function downloadWebImage(url: string): Promise<{ bytes: Buffer; ext: string } | null> {
  try {
    const r = await fetch(url, { headers: { "User-Agent": IMAGE_UA, Accept: "image/jpeg,image/png,image/webp" }, signal: AbortSignal.timeout(15_000) });
    if (!r.ok) return null;
    const type = (r.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (!["image/jpeg", "image/png", "image/webp"].includes(type)) return null;
    const declared = Number(r.headers.get("content-length") ?? 0);
    if (declared > 8 * 1024 * 1024) return null;
    const bytes = Buffer.from(await r.arrayBuffer());
    if (bytes.length < 2_000 || bytes.length > 8 * 1024 * 1024) return null;
    const ext = type === "image/png" ? "png" : type === "image/webp" ? "webp" : "jpg";
    return { bytes, ext };
  } catch { return null; }
}

// ---------- sound design: preset cue list (used as the fallback of the agent's own audio code) ----------
const CUE_KINDS = new Set(["typing", "soft-click", "click", "whoosh", "impact", "chime", "riser", "pop", "tick", "swell", "none"]);
type Cue = { at: number; kind: string; g?: number; dur?: number };

function buildCues(sb: Storyboard): Cue[] {
  const L = sceneLayout(sb);
  const n = sb.scenes.length;
  const cues: Cue[] = [];
  sb.scenes.forEach((s, i) => {
    const at = L[i].from / 30;
    const type = String(s.type);
    const declared = typeof s.soundCue === "string" ? s.soundCue.trim() : "";
    let kind = declared || (i === 0 ? "impact" : i === n - 1 ? "chime" : "whoosh");
    if (!CUE_KINDS.has(kind)) kind = "whoosh";
    if (kind !== "none") {
      const when = i === 0 ? 0.2 : kind === "whoosh" || kind === "riser" ? Math.max(0, at - 0.12) : at + 0.05;
      cues.push({ at: when, kind, ...(kind === "typing" ? { dur: Math.min(2.2, Math.max(0.6, Number(s.seconds) * 0.4)) } : {}) });
    }
    if (declared === "none") return;
    const count = (v: unknown, max: number) => Math.min(max, Array.isArray(v) ? v.length : 0);
    if (type === "bullets") for (let k = 0; k < count(s.items, 5); k++) cues.push({ at: at + (14 + k * 9) / 30, kind: "pop", g: 0.5 });
    else if (type === "ranking") for (let k = 0; k < count(s.items, 5); k++) cues.push({ at: at + (12 + k * 10) / 30, kind: "pop", g: 0.5 });
    else if (type === "timeline") for (let k = 0; k < count(s.steps, 5); k++) cues.push({ at: at + (12 + k * 12) / 30, kind: "pop", g: 0.5 });
    else if (type === "bar-chart") for (let k = 0; k < count(s.data, 6); k++) cues.push({ at: at + (12 + k * 8) / 30, kind: "tick", g: 0.6 });
    else if (type === "stat") {
      cues.push({ at: at + 0.15, kind: "riser", dur: 1.0, g: 0.5 });
      cues.push({ at: at + Math.min(64, L[i].dur - 24) / 30, kind: "pop", g: 0.7 });
    } else if (type === "custom") {
      (Array.isArray(s.sounds) ? s.sounds : []).slice(0, 8).forEach((x: any) => {
        const k = String(x?.kind);
        const t = Number(x?.at);
        if (CUE_KINDS.has(k) && k !== "none" && Number.isFinite(t) && t >= 0 && t < Number(s.seconds)) cues.push({ at: at + t, kind: k, g: 0.8 });
      });
    }
  });
  return cues.filter((c) => Number.isFinite(c.at) && c.at >= 0).slice(0, 150);
}

// ---------- the agent writes the music and the sound design as code ----------
const userDoc = (uid: string) => getAdminDb().collection("users").doc(uid);
// the audio code lives in its OWN document: saving the project from the browser can never wipe it
const audioDoc = (uid: string, pid: string) => userDoc(uid).collection("venusAudio").doc(pid);

async function readProject(uid: string, pid: string): Promise<any | null> {
  try { return (await userDoc(uid).collection("venusProjects").doc(pid).get()).data() ?? null; } catch { return null; }
}
async function readAudioCode(uid: string, pid: string): Promise<{ music?: string; sfx?: string }> {
  try {
    const d = ((await audioDoc(uid, pid).get()).data() ?? {}) as { music?: string; sfx?: string };
    return { music: d.music && !checkAudioCode(d.music) ? d.music : undefined, sfx: d.sfx && !checkAudioCode(d.sfx) ? d.sfx : undefined };
  } catch { return {}; }
}

async function composeCode(uid: string, project: any, part: "music" | "sfx", info: Parameters<typeof audioCodePrompt>[1]): Promise<string | null> {
  try {
    const provider = project?.provider as ProviderId;
    const model = String(project?.model || "");
    if (!provider || !model) return null;
    const udata = (await userDoc(uid).get()).data() as { apiKeys?: Record<string, string> } | undefined;
    const ph = udata?.apiKeys?.[provider];
    if (!ph) return null;
    const apiKey = await resolveValue(uid, ph);
    const prompt = audioCodePrompt(part, info);
    const reply = await Promise.race([
      callProvider({ provider, apiKey, model, maxTokens: 5000, messages: [{ role: "user", content: prompt }] }),
      new Promise<string>((_, rej) => setTimeout(() => rej(new Error("slow")), 34_000)),
    ]);
    addTokens(uid, estTokens(prompt.length + reply.length)).catch(() => {});
    const code = extractAudioCode(reply);
    return checkAudioCode(code) ? null : code;
  } catch { return null; }
}

export async function POST(req: Request) {
  try {
    const body = await readBody(req);
    const action = String(body.action || "");
    const e2bKey = String(body.e2bKey || "");
    if (!e2bKey) return fail("E2B key missing.", 400);

    if (action === "create") {
      const c = await createSandbox(e2bKey, { provision: false });
      return NextResponse.json({ sandboxId: c.sandboxId });
    }

    const sandboxId = String(body.sandboxId || "");
    if (!sandboxId) return fail("sandboxId missing.", 400);
    const sb = await connect(e2bKey, sandboxId);

    switch (action) {
      case "setup":
        await setupStudio(sb);
        return NextResponse.json({ ok: true });

      case "status":
        return NextResponse.json(await studioState(sb));

      case "prepare": {
        const uid = String(body.uid);
        const pid = safeId(body.projectId);
        let storyboard = sanitizeStoryboard(body.storyboard, { keepFiles: true });

        // The UI kit, the Main composition and the audio engine are (re)written on every prepare,
        // so old studio computers get them without any reinstall.
        await writeFiles(sb, {
          [`${DIR}/src/ui.tsx`]: UI_SOURCE,
          [`${DIR}/src/Main.tsx`]: MAIN_SOURCE,
          [`${DIR}/synth.cjs`]: SYNTH_V2_SOURCE,
        });

        // Sound effects: the agent's own sound-design code when it exists, otherwise the preset cue list.
        // Optional: a failure never blocks the render.
        try {
          const cues = buildCues(storyboard);
          const total = totalFramesOf(storyboard) / 30 + 1;
          const code = (await readAudioCode(uid, pid)).sfx;
          if (code || cues.length) {
            const job = code
              ? { kind: "sfx", code, seconds: total - 1, scenes: timelineOf(storyboard), seed: 5, fallback: { total, cues } }
              : { total, cues };
            await writeFiles(sb, { [`${DIR}/work/${pid}/sfx.json`]: JSON.stringify(job) });
            const r = await exec(
              sb,
              `cd ${DIR} && mkdir -p public/p/${pid} && node synth.cjs ${code ? "code" : "sfx"} work/${pid}/sfx.json public/p/${pid}/sfx.wav && ffmpeg -y -loglevel error -i public/p/${pid}/sfx.wav -codec:a libmp3lame -b:a 160k public/p/${pid}/sfx.mp3 && rm -f public/p/${pid}/sfx.wav`,
              50_000
            );
            if (r.exitCode === 0) storyboard = { ...storyboard, sfx: `p/${pid}/sfx.mp3` };
          }
        } catch { /* SFX are optional */ }

        return NextResponse.json(await prepareProject(sb, pid, storyboard));
      }

      // One scene at a time: a stock photo (image scenes) or a stock video clip (footage scenes).
      case "assets": {
        const pid = safeId(body.projectId);
        const key = process.env.PEXELS_API_KEY;
        const sbd = sanitizeStoryboard(body.storyboard, { keepFiles: true });
        const i = Math.max(0, Math.min(sbd.scenes.length - 1, Number(body.index) || 0));
        const s = sbd.scenes[i];
        const orient = sbd.height > sbd.width ? "portrait" : sbd.width === sbd.height ? "square" : "landscape";
        const dir = `${DIR}/public/p/${pid}`;

        if (s.type === "image" && s.imageQuery) {
          const query = String(s.imageQuery).slice(0, 160);
          const targetRatio = sbd.width / Math.max(1, sbd.height);

          const webImages = await findWebImages(query).catch(() => []);
          webImages.sort((a, b) => {
            const score = (x: WebImage) => Math.abs(Math.log(Math.max(0.01, x.width / Math.max(1, x.height)) / targetRatio)) * 3
              - Math.min(1, x.width / 1600) - Math.min(1, x.height / 900);
            return score(a) - score(b);
          });
          for (const candidate of webImages.slice(0, 8)) {
            const downloaded = await downloadWebImage(candidate.url);
            if (!downloaded) continue;
            const rel = `p/${pid}/img/scene-${i}.${downloaded.ext}`;
            await writeBinary(sb, `${DIR}/public/${rel}`, downloaded.bytes);
            return NextResponse.json({ image: rel, source: "web-image-search" });
          }

          if (key) {
            try {
              const rel = `p/${pid}/img/scene-${i}.jpg`;
              const r = await fetch(`https://api.pexels.com/v1/search?per_page=8&orientation=${orient}&query=${encodeURIComponent(query)}`, { headers: { Authorization: key }, signal: AbortSignal.timeout(12_000) });
              if (r.ok) {
                const data = (await r.json()) as { photos?: Array<{ width?: number; height?: number; src?: { large2x?: string; large?: string; original?: string } }> };
                const photos = (data.photos ?? []).filter((p) => p.src?.large2x || p.src?.large || p.src?.original);
                const picked = photos.sort((a, b) => {
                  const ratioA = (a.width ?? 0) / Math.max(1, a.height ?? 1);
                  const ratioB = (b.width ?? 0) / Math.max(1, b.height ?? 1);
                  const scoreA = Math.abs(Math.log(Math.max(0.01, ratioA) / targetRatio)) * 3 - Math.min(1, (a.width ?? 0) / 1600) - Math.min(1, (a.height ?? 0) / 900);
                  const scoreB = Math.abs(Math.log(Math.max(0.01, ratioB) / targetRatio)) * 3 - Math.min(1, (b.width ?? 0) / 1600) - Math.min(1, (b.height ?? 0) / 900);
                  return scoreA - scoreB;
                })[0];
                const src = picked?.src?.large2x ?? picked?.src?.large ?? picked?.src?.original;
                if (src && /^https:\/\/images\.pexels\.com\//.test(src)) {
                  const dl = await exec(sb, `mkdir -p ${dir}/img && curl -fsSL --max-time 30 -o '${DIR}/public/${rel}' '${src}'`, 40_000);
                  if (dl.exitCode === 0) return NextResponse.json({ image: rel, source: "pexels" });
                }
              }
            } catch { /* Pexels is optional */ }
          }
        }

        if (key && s.type === "footage" && s.footageQuery) {
          const r = await fetch(`https://api.pexels.com/videos/search?per_page=10&size=medium&orientation=${orient}&query=${encodeURIComponent(String(s.footageQuery))}`, { headers: { Authorization: key }, signal: AbortSignal.timeout(12_000) });
          const data = (await r.json()) as { videos?: Array<{ duration?: number; width?: number; height?: number; video_files?: Array<{ link?: string; width?: number; height?: number; file_type?: string; quality?: string }> }> };
          const need = Math.max(1.5, Number(s.seconds) || 5);
          const targetRatio = sbd.width / Math.max(1, sbd.height);
          const candidates = (data.videos ?? []).flatMap((v) => (v.video_files ?? [])
            .filter((f) => f.file_type === "video/mp4" && f.link && /^https:\/\/[a-z0-9.-]*pexels\.com\//.test(f.link))
            .map((f) => {
              const w = f.width ?? v.width ?? 0;
              const h = f.height ?? v.height ?? 0;
              const ratio = w / Math.max(1, h);
              const durationPenalty = (v.duration ?? 0) >= need ? Math.min(0.5, ((v.duration ?? 0) - need) / 40) : 2 + (need - (v.duration ?? 0));
              const shapePenalty = Math.abs(Math.log(Math.max(0.01, ratio) / targetRatio)) * 2.5;
              const resolutionBonus = Math.min(1.5, Math.min(w, h) / 900);
              const qualityBonus = f.quality === "hd" ? 0.2 : 0;
              return { file: f, score: durationPenalty + shapePenalty - resolutionBonus - qualityBonus };
            }));
          const best = candidates.sort((a, b) => a.score - b.score)[0];
          const file = best?.file;
          if (file?.link) {
            const rel = `p/${pid}/vid/scene-${i}.mp4`;
            await exec(sb, `mkdir -p ${dir}/vid`, 10_000);
            const dl = await exec(sb, `curl -fsSL --max-time 45 -o '${DIR}/public/${rel}' '${file.link}'`, 52_000);
            if (dl.exitCode === 0) return NextResponse.json({ video: rel });
          }
        }
        return NextResponse.json({});
      }

      case "tts": {
        const pid = safeId(body.projectId);
        const index = Math.max(0, Math.min(40, Number(body.index) || 0));
        const text = String(body.text || "").slice(0, 700);
        const openaiKey = String(body.openaiKey || "");
        if (!text || !openaiKey) return fail("Voiceover needs narration text and an OpenAI key.", 400);
        const voice = ["alloy", "echo", "fable", "onyx", "nova", "shimmer"].includes(String(body.voice)) ? String(body.voice) : "nova";
        const r = await fetch("https://api.openai.com/v1/audio/speech", {
          method: "POST",
          headers: { Authorization: `Bearer ${openaiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ model: "tts-1", voice, input: text, response_format: "mp3", speed: 1.05 }),
          signal: AbortSignal.timeout(40_000),
        });
        if (!r.ok) {
          const e = (await r.json().catch(() => ({}))) as { error?: { message?: string } };
          return fail("OpenAI TTS error: " + (e.error?.message ?? r.status));
        }
        const bytes = Buffer.from(await r.arrayBuffer());
        const rel = `p/${pid}/vo/scene-${index}.mp3`;
        await writeBinary(sb, `${DIR}/public/${rel}`, bytes);
        const d = await exec(sb, `ffprobe -v error -show_entries format=duration -of csv=p=0 '${DIR}/public/${rel}'`, 15_000);
        const seconds = Number(d.stdout.trim());
        return NextResponse.json({ file: rel, seconds: Number.isFinite(seconds) ? seconds : 0 });
      }

      // Music: the AGENT writes the music as code (and the sound-design code in parallel, used at the next prepare).
      // If the model is slow or the code fails, the built-in composer is the fallback. Every call writes a NEW composition.
      case "music": {
        const uid = String(body.uid);
        const pid = safeId(body.projectId);
        const secs = Math.min(75, Math.max(8, Math.ceil(Number(body.seconds) || 30)));
        const project = await readProject(uid, pid);
        let sbNow: Storyboard | null = null;
        try { sbNow = project?.storyboardJson ? sanitizeStoryboard(JSON.parse(project.storyboardJson), { keepFiles: true }) : null; } catch { /* no storyboard yet */ }

        let mood = AUDIO_MOODS.includes(body.mood) ? String(body.mood) : body.dark ? "dark" : "bright";
        let bpm = Number(body.bpm) || 0;
        const a = sbNow?.audio;
        if (!body.mood && a && (AUDIO_MOODS as readonly string[]).includes(a.mood)) { mood = a.mood; if (Number(a.bpm) >= 70 && Number(a.bpm) <= 140) bpm = Number(a.bpm); }

        const scenes = sbNow ? timelineOf(sbNow) : [];
        const info = { brief: String(project?.brief ?? sbNow?.title ?? ""), concept: sbNow?.concept, mood, bpm, seconds: secs, scenes };
        const [mc, sc] = await Promise.all([composeCode(uid, project, "music", info), composeCode(uid, project, "sfx", { ...info, seconds: Math.round(secs) })]);
        const old = await readAudioCode(uid, pid);
        if (mc || sc) await audioDoc(uid, pid).set({ ...(mc ? { music: mc } : {}), ...(sc ? { sfx: sc } : {}), at: Date.now() }, { merge: true }).catch(() => {});
        const code = mc ?? old.music ?? null;

        const rel = `p/${pid}/music.mp3`;
        const seed = pid.length * 31 + secs + (Date.now() % 997);
        const preset = { seconds: secs, mood, ...(bpm ? { bpm } : {}), seed };
        const job = code ? { kind: "music", code, seconds: secs, mood, bpm, scenes, seed, fallback: preset } : preset;
        await writeFiles(sb, {
          [`${DIR}/synth.cjs`]: SYNTH_V2_SOURCE,
          [`${DIR}/work/${pid}/music.json`]: JSON.stringify(job),
        });
        const r = await exec(
          sb,
          `cd ${DIR} && mkdir -p public/p/${pid} && node synth.cjs ${code ? "code" : "music"} work/${pid}/music.json public/p/${pid}/music.wav && ffmpeg -y -loglevel error -i public/p/${pid}/music.wav -codec:a libmp3lame -b:a 160k public/${rel} && rm -f public/p/${pid}/music.wav`,
          55_000
        );
        if (r.exitCode !== 0) return fail("Music generation failed: " + (r.stderr || r.stdout).slice(0, 200));
        const fell = /AUDIO_FALLBACK/.test(r.stdout);
        return NextResponse.json({ file: rel, mood, source: code && !fell ? "agent-code" : "preset", note: fell ? r.stdout.split("\n").find((l) => l.startsWith("AUDIO_FALLBACK")) : undefined });
      }

      case "render": {
        const pid = safeId(body.projectId);
        const kind = body.kind === "final" ? "final" : body.kind === "scene" ? "scene" : "preview";
        const scale = Math.min(2, Math.max(0.25, Number(body.scale) || 1));
        const crf = kind === "final" ? (scale > 1 ? 26 : 23) : 30;
        const frames = /^\d+-\d+$/.test(String(body.frames || "")) ? String(body.frames) : "";
        const jobId = "r" + Date.now().toString(36);
        const renderArgs = `src/index.ts Main out/${pid}-${kind}.mp4 --props=${DIR}/work/${pid}/storyboard.json --scale=${scale}${frames ? ` --frames=${frames}` : ""} --codec=h264 --crf=${crf} --log=info --overwrite`;
        const script = [
          "set -u",
          `cd ${DIR}`,
          "mkdir -p out",
          `echo '[Venus Pro] Starting Remotion render with concurrency=1'`,
          `if npx remotion render ${renderArgs} --concurrency=1; then`,
          `  test -s 'out/${pid}-${kind}.mp4' || { echo '[Venus Pro] Render exited successfully but MP4 is missing/empty'; exit 1; }`,
          "else",
          "  first_code=$?",
          `  echo "[Venus Pro] First render attempt failed (exit $first_code); retrying once with a fresh single-worker render."`,
          `  rm -f 'out/${pid}-${kind}.mp4'`,
          `  npx remotion render ${renderArgs} --concurrency=1 || exit $?`,
          `  test -s 'out/${pid}-${kind}.mp4' || { echo '[Venus Pro] Retry finished but MP4 is missing/empty'; exit 1; }`,
          "fi",
          `echo '[Venus Pro] Render output verified: out/${pid}-${kind}.mp4'`,
        ].join("\n");
        await startJob(sb, jobId, script);
        return NextResponse.json({ jobId });
      }

      case "progress":
        return NextResponse.json(await jobStatus(sb, String(body.jobId || ""), Math.max(0, Number(body.total) || 0)));

      case "frames": {
        const pid = safeId(body.projectId);
        const times = (Array.isArray(body.times) ? body.times : [])
          .map((t: unknown) => Number(t))
          .filter((t: number) => Number.isFinite(t) && t >= 0 && t < 600)
          .slice(0, 6);
        if (times.length === 0) return fail("No frame times.", 400);
        const cols = Math.min(3, times.length);
        const rows = Math.ceil(times.length / cols);
        const script = `cd ${DIR}/work/${pid}
rm -f f_*.jpg sheet.jpg
i=0
for t in ${times.join(" ")}; do
  i=$((i+1))
  ffmpeg -y -loglevel error -ss $t -i ${DIR}/out/${pid}-preview.mp4 -frames:v 1 -vf scale=640:-2 f_$i.jpg
done
ffmpeg -y -loglevel error -framerate 1 -i f_%d.jpg -filter_complex "tile=${cols}x${rows}" -frames:v 1 -q:v 4 sheet.jpg
base64 -w0 sheet.jpg`;
        const r = await exec(sb, script, 55_000);
        if (r.exitCode !== 0 || r.stdout.length < 100) return fail("Could not extract frames: " + (r.stderr || r.stdout).slice(0, 200));
        return NextResponse.json({ image: r.stdout.trim(), mediaType: "image/jpeg" });
      }

      case "upload": {
        const uid = String(body.uid);
        const pid = safeId(body.projectId);
        const kind = ["final", "scene"].includes(String(body.kind)) ? String(body.kind) : "preview";
        const objectPath = `${uid}/${pid}/${kind}.mp4`;
        const upUrl = await createSignedUpload(objectPath);
        const file = `${DIR}/out/${pid}-${kind}.mp4`;
        const r = await exec(
          sb,
          `test -f '${file}' || { echo MISSING; exit 3; }
size=$(stat -c %s '${file}')
code=$(curl -sS -o /tmp/up.out -w '%{http_code}' --max-time 50 -X PUT '${upUrl}' -H 'Content-Type: video/mp4' -H 'x-upsert: true' --data-binary @'${file}')
echo "$code $size"
head -c 300 /tmp/up.out`,
          55_000
        );
        const first = r.stdout.trim().split("\n")[0] ?? "";
        const [code, size] = first.split(" ");
        if (first.startsWith("MISSING")) return fail("The rendered file was not found.");
        if (code !== "200") return fail(`Supabase upload failed (HTTP ${code}). ${r.stdout.split("\n").slice(1).join(" ").slice(0, 200)}`);
        return NextResponse.json({ path: objectPath, bytes: Number(size) || 0 });
      }

      default:
        return fail("Unknown action.", 400);
    }
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Studio request failed.", requestStatus(err));
  }
}
