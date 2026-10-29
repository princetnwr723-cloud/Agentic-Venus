import { NextResponse } from "next/server";
import { connect, createSandbox, exec } from "@/lib/e2b-server";
import { readBody, requestStatus } from "@/lib/request";
import { createSignedDownload, createSignedUpload, removeObjects } from "@/lib/supabase-server";
import { ASSETS, q } from "@/lib/code-server";
import { DIR, jobStatus, safeId, setupStudio, startJob, studioState, writeBinary, writeFiles } from "@/lib/venus-server";
import { prepareProjectBatched } from "@/lib/venus-prepare";
import { AUDIO_MOODS, sanitizeStoryboard, sceneLayout, totalFramesOf, type Storyboard } from "@/lib/venus-schema";
import { UI_SOURCE } from "@/lib/venus-kit";
import { MAIN_SOURCE } from "@/lib/venus-main";
import { BACKDROP_SOURCE } from "@/lib/venus-backdrop";
import { GUARD_SOURCE } from "@/lib/venus-guard";
import { SCENERY_SOURCE } from "@/lib/venus-scenery";
import { CLIP_SOURCE, SHELL_SOURCE } from "@/lib/venus-clip";
import { SYNTH_V3_SOURCE } from "@/lib/venus-music";
import { concatScript, ingestScript, longMusicScript, parseAnalysis, renderScript, uploadScript, verifyScript } from "@/lib/venus-jobs";
import { synthVoiceOver } from "@/lib/venus-voice";
import { getExistingOpenAIKey } from "@/lib/voice-utils";
import { audioCodePrompt, checkAudioCode, extractAudioCode, randomConstraints, timelineOf } from "@/lib/venus-audio-prompts";
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
    let kind = declared || (type === "clip" ? "none" : i === 0 ? "impact" : i === n - 1 ? "chime" : "whoosh");
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
  return cues.filter((c) => Number.isFinite(c.at) && c.at >= 0).slice(0, 1500);
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
    const prompt = audioCodePrompt(part, { ...info, constraints: randomConstraints(part) });
    const reply = await Promise.race([
      callProvider({ provider, apiKey, model, maxTokens: 5000, messages: [{ role: "user", content: prompt }] }),
      new Promise<string>((_, rej) => setTimeout(() => rej(new Error("slow")), 26_000)),
    ]);
    addTokens(uid, estTokens(prompt.length + reply.length)).catch(() => {});
    const code = extractAudioCode(reply);
    return checkAudioCode(code) ? null : code;
  } catch { return null; }
}

const SAFE_URL = /^https:\/\/[A-Za-z0-9.\-_\/%?=&:~+,;@]+$/;
const hashPid = (pid: string) => { let h = 7; for (let i = 0; i < pid.length; i++) h = (Math.imul(h, 31) + pid.charCodeAt(i)) >>> 0; return (h % 900000) + 1000; };
const rndSeed = () => Math.floor(Math.random() * 2_000_000_000) + 1;
const cat = async (sb: Awaited<ReturnType<typeof connect>>, path: string, max = 400_000) => (await exec(sb, `test -f '${path}' && head -c ${max} '${path}' || true`, 15_000)).stdout;

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
          [`${DIR}/src/backdrop.tsx`]: BACKDROP_SOURCE,
          [`${DIR}/src/guard.tsx`]: GUARD_SOURCE,
          [`${DIR}/src/scenery.tsx`]: SCENERY_SOURCE,
          [`${DIR}/src/shell2.tsx`]: SHELL_SOURCE,
          [`${DIR}/src/clip.tsx`]: CLIP_SOURCE,
          [`${DIR}/synth.cjs`]: SYNTH_V3_SOURCE,
        });

        // Sound effects: the agent's own sound-design code when it exists, otherwise the preset cue list.
        // Optional: a failure never blocks the render.
        try {
          const total = totalFramesOf(storyboard) / 30 + 1;
          const cues = total > 250 ? [] : buildCues(storyboard); // very long videos have no effects track (it would not fit in memory)
          const code = total > 95 ? undefined : (await readAudioCode(uid, pid)).sfx;
          const sfxSeed = hashPid(pid); // stable for a project, different between projects
          if (code || cues.length) {
            const job = code
              ? { kind: "sfx", code, seconds: total - 1, scenes: timelineOf(storyboard), seed: sfxSeed, fallback: { total, cues, seed: sfxSeed } }
              : { total, cues, seed: sfxSeed };
            await writeFiles(sb, { [`${DIR}/work/${pid}/sfx.json`]: JSON.stringify(job) });
            const r = await exec(
              sb,
              `cd ${DIR} && mkdir -p public/p/${pid} && node synth.cjs ${code ? "code" : "sfx"} work/${pid}/sfx.json public/p/${pid}/sfx.wav && ffmpeg -y -loglevel error -i public/p/${pid}/sfx.wav -codec:a libmp3lame -b:a 160k public/p/${pid}/sfx.mp3 && rm -f public/p/${pid}/sfx.wav`,
              50_000
            );
            if (r.exitCode === 0) storyboard = { ...storyboard, sfx: `p/${pid}/sfx.mp3` };
          }
        } catch { /* SFX are optional */ }

        return NextResponse.json(await prepareProjectBatched(sb, pid, storyboard));
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
                if (src && /^https:\/\/images\.pexels\.com\//.test(src) && SAFE_URL.test(src)) {
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
            .filter((f) => f.file_type === "video/mp4" && f.link && /^https:\/\/[a-z0-9.-]*pexels\.com\//.test(f.link) && SAFE_URL.test(f.link))
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

      // Voice-over: the voice system of the app (cloud voice -> local voice model -> OpenAI); if none is available, a free voice on this computer.
      case "tts": {
        const uid = String(body.uid);
        const pid = safeId(body.projectId);
        const index = Math.max(0, Math.min(900, Number(body.index) || 0));
        const text = String(body.text || "").slice(0, 900);
        if (!text.trim()) return fail("Voiceover needs narration text.", 400);
        const voice = typeof body.voice === "string" && body.voice !== "system" ? body.voice : "";
        const audio = await synthVoiceOver(uid, text, voice, typeof body.chatId === "string" && body.chatId ? body.chatId : undefined).catch(() => null);
        let rel = "";
        let provider = "";
        if (audio) {
          rel = `p/${pid}/vo/scene-${index}.${audio.ext}`;
          await writeBinary(sb, `${DIR}/public/${rel}`, audio.bytes);
          provider = audio.provider;
        } else {
          // free voice on the studio computer: Microsoft neural voices through edge-tts (Hindi + English), espeak-ng as the last resort
          const hindi = /[\u0900-\u097F]/.test(text);
          const voiceName = /^[a-z]{2}-[A-Z]{2}-[A-Za-z]+Neural$/.test(voice) ? voice : hindi ? "hi-IN-SwaraNeural" : "en-US-AriaNeural";
          rel = `p/${pid}/vo/scene-${index}.mp3`;
          const base = `${DIR}/work/${pid}`;
          await exec(sb, `mkdir -p ${base} ${DIR}/public/p/${pid}/vo`, 10_000);
          await writeFiles(sb, { [`${base}/tts_${index}.txt`]: text });
          const r = await exec(
            sb,
            `export PATH=$PATH:$HOME/.local/bin; command -v edge-tts >/dev/null 2>&1 || pip install --quiet --user --break-system-packages edge-tts >/dev/null 2>&1; edge-tts --voice ${voiceName} --file ${base}/tts_${index}.txt --write-media ${DIR}/public/${rel} >/dev/null 2>&1; test -s ${DIR}/public/${rel} || { command -v espeak-ng >/dev/null 2>&1 && espeak-ng -v ${hindi ? "hi" : "en"} -f ${base}/tts_${index}.txt -w ${base}/tts_${index}.wav && ffmpeg -y -loglevel error -i ${base}/tts_${index}.wav -codec:a libmp3lame -b:a 128k ${DIR}/public/${rel}; }; test -s ${DIR}/public/${rel} && echo VOICE_OK`,
            58_000
          );
          if (!r.stdout.includes("VOICE_OK")) return fail("No voice could be made: connect a voice provider in Settings → Voice (or an OpenAI key).");
          provider = "studio-free";
        }
        const d = await exec(sb, `ffprobe -v error -show_entries format=duration -of csv=p=0 '${DIR}/public/${rel}'`, 15_000);
        const seconds = Number(d.stdout.trim());
        return NextResponse.json({ file: rel, seconds: Number.isFinite(seconds) ? seconds : 0, provider });
      }

      // Copies an asset that the AGENT downloaded on ITS computer to this (studio) computer. The two computers are different machines:
      // the file travels through storage (a temporary object that is deleted right away).
      case "pullasset": {
        const uid = String(body.uid);
        const pid = safeId(body.projectId);
        const name = String(body.name || "");
        if (!/^[A-Za-z0-9._ -]{1,120}$/.test(name) || name.includes("..")) return fail("Bad asset name.", 400);
        const kind = body.kind === "vid" ? "vid" : "img";
        const idx = Math.max(0, Math.min(900, Number(body.index) || 0));
        const ext = (name.split(".").pop() || "bin").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 5) || "bin";
        const rel = `p/${pid}/${kind}/asset-${idx}.${ext}`;
        const fromId = String(body.fromSandboxId || "");
        if (!fromId) return fail("The agent's computer was not found.", 400);
        const from = await connect(e2bKey, fromId);
        const tmp = `${uid}/tmp/${pid}-${idx}-${Date.now().toString(36)}`;
        await writeFiles(from, { "/tmp/venus_up.txt": await createSignedUpload(tmp) });
        const put = await exec(from, `F=${q(ASSETS + "/" + name)}; test -f "$F" || { echo MISSING; exit 4; }; curl -sS -o /dev/null -w '%{http_code}' --max-time 50 -X PUT "$(cat /tmp/venus_up.txt)" -H 'Content-Type: application/octet-stream' -H 'x-upsert: true' --data-binary @"$F"; rm -f /tmp/venus_up.txt`, 56_000);
        if (put.stdout.trim() !== "200") { await removeObjects([tmp]).catch(() => {}); return fail("The file " + name + " could not be read from the agent's computer."); }
        await exec(sb, `mkdir -p ${DIR}/work/${pid} ${DIR}/public/p/${pid}/${kind}`, 10_000);
        await writeFiles(sb, { [`${DIR}/work/${pid}/dl.txt`]: await createSignedDownload(tmp, 600) });
        const got = await exec(sb, `curl -fsSL --max-time 50 -o ${DIR}/public/${rel} "$(cat ${DIR}/work/${pid}/dl.txt)"; rm -f ${DIR}/work/${pid}/dl.txt; test -s ${DIR}/public/${rel} && echo COPY_OK`, 56_000);
        await removeObjects([tmp]).catch(() => {});
        return got.stdout.includes("COPY_OK") ? NextResponse.json({ path: rel }) : fail("The file " + name + " could not be copied to the studio computer.");
      }

      // The agent writes the music and the sound design as code (needs the AI model, so it is its own request).
      case "compose": {
        const uid = String(body.uid);
        const pid = safeId(body.projectId);
        const secs = Math.min(95, Math.max(8, Math.ceil(Number(body.seconds) || 30)));
        if (secs > 80) return NextResponse.json({ ok: true, skipped: "long" });
        const project = await readProject(uid, pid);
        let sbNow: Storyboard | null = null;
        try { sbNow = project?.storyboardJson ? sanitizeStoryboard(JSON.parse(project.storyboardJson), { keepFiles: true }) : null; } catch { /* no storyboard yet */ }
        const a = sbNow?.audio;
        const mood = AUDIO_MOODS.includes(body.mood) ? String(body.mood) : a && (AUDIO_MOODS as readonly string[]).includes(a.mood) ? a.mood : body.dark ? "dark" : "bright";
        const bpm = Number(body.bpm) || (a && Number(a.bpm) >= 70 && Number(a.bpm) <= 140 ? Number(a.bpm) : 0);
        const info = { brief: String(project?.brief ?? sbNow?.title ?? ""), concept: sbNow?.concept, mood, bpm, seconds: secs, scenes: sbNow ? timelineOf(sbNow) : [] };
        const [mc, sc] = await Promise.all([composeCode(uid, project, "music", info), composeCode(uid, project, "sfx", info)]);
        if (mc || sc) await audioDoc(uid, pid).set({ ...(mc ? { music: mc } : {}), ...(sc ? { sfx: sc } : {}), at: Date.now() }, { merge: true }).catch(() => {});
        return NextResponse.json({ ok: true, music: Boolean(mc), sfx: Boolean(sc) });
      }

      // Music: a NEW composition on every call (key, scale, chords, tempo, instruments, groove and form are chosen from a random seed).
      // Up to 80 s it is made in this request; longer videos get several tracks joined together by a background job.
      case "music": {
        const uid = String(body.uid);
        const pid = safeId(body.projectId);
        const total = Math.min(3700, Math.max(8, Math.ceil(Number(body.seconds) || 30)));
        const project = await readProject(uid, pid);
        let sbNow: Storyboard | null = null;
        try { sbNow = project?.storyboardJson ? sanitizeStoryboard(JSON.parse(project.storyboardJson), { keepFiles: true }) : null; } catch { /* no storyboard yet */ }

        let mood = AUDIO_MOODS.includes(body.mood) ? String(body.mood) : body.dark ? "dark" : "bright";
        let bpm = Number(body.bpm) || 0;
        const a = sbNow?.audio;
        if (!body.mood && a && (AUDIO_MOODS as readonly string[]).includes(a.mood)) { mood = a.mood; if (Number(a.bpm) >= 70 && Number(a.bpm) <= 140) bpm = Number(a.bpm); }
        const rel = `p/${pid}/music.mp3`;

        if (total > 80 && body.job === true) {
          const per = 70;
          const n = Math.ceil(total / per);
          const files: Record<string, string> = { [`${DIR}/synth.cjs`]: SYNTH_V3_SOURCE };
          for (let i = 0; i < n; i++) files[`${DIR}/work/${pid}/m_${i}.json`] = JSON.stringify({ seconds: i === n - 1 ? Math.max(8, total - per * i + 4) : per + 4, mood, ...(bpm ? { bpm } : {}), seed: rndSeed() });
          await writeFiles(sb, files);
          const jobId = "m" + Date.now().toString(36);
          await startJob(sb, jobId, longMusicScript(DIR, pid, n));
          return NextResponse.json({ jobId, file: rel, mood, source: "generated-long", parts: n });
        }

        const secs = Math.min(80, total);
        const scenes = sbNow ? timelineOf(sbNow) : [];
        const info = { brief: String(project?.brief ?? sbNow?.title ?? ""), concept: sbNow?.concept, mood, bpm, seconds: secs, scenes };
        let code: string | null = null;
        if (!body.skipCompose) {
          const [mc, sc] = await Promise.all([composeCode(uid, project, "music", info), composeCode(uid, project, "sfx", { ...info, seconds: Math.round(secs) })]);
          if (mc || sc) await audioDoc(uid, pid).set({ ...(mc ? { music: mc } : {}), ...(sc ? { sfx: sc } : {}), at: Date.now() }, { merge: true }).catch(() => {});
          code = mc ?? (await readAudioCode(uid, pid)).music ?? null;
        } else {
          code = (await readAudioCode(uid, pid)).music ?? null;
        }

        const seed = rndSeed();
        const preset = { seconds: secs, mood, ...(bpm ? { bpm } : {}), seed };
        const job = code ? { kind: "music", code, seconds: secs, mood, bpm, scenes, seed, fallback: preset } : preset;
        await writeFiles(sb, {
          [`${DIR}/synth.cjs`]: SYNTH_V3_SOURCE,
          [`${DIR}/work/${pid}/music.json`]: JSON.stringify(job),
        });
        const r = await exec(
          sb,
          `cd ${DIR} && mkdir -p public/p/${pid} && node synth.cjs ${code ? "code" : "music"} work/${pid}/music.json public/p/${pid}/music.wav && ffmpeg -y -loglevel error -i public/p/${pid}/music.wav -codec:a libmp3lame -b:a 160k public/${rel} && rm -f public/p/${pid}/music.wav`,
          30_000
        );
        if (r.exitCode !== 0) return fail("Music generation failed: " + (r.stderr || r.stdout).slice(0, 200));
        const fell = /AUDIO_FALLBACK/.test(r.stdout);
        const line = r.stdout.split("\n").find((l) => l.startsWith("MUSIC "));
        return NextResponse.json({ file: rel, mood, source: code && !fell ? "agent-code" : "generated", note: fell ? r.stdout.split("\n").find((l) => l.startsWith("AUDIO_FALLBACK")) : line });
      }

      case "render": {
        const pid = safeId(body.projectId);
        const kind = body.kind === "final" ? "final" : body.kind === "scene" ? "scene" : "preview";
        const scale = Math.min(2, Math.max(0.25, Number(body.scale) || 1));
        const crf = kind === "final" ? (scale > 1 ? 26 : 23) : 30;
        const frames = /^\d+-\d+$/.test(String(body.frames || "")) ? String(body.frames) : "";
        const part = body.part === undefined || body.part === null ? -1 : Math.max(0, Math.min(99, Math.floor(Number(body.part) || 0)));
        const name = `${pid}-${kind}${part >= 0 ? "-p" + part : ""}`;
        const jobId = "r" + Date.now().toString(36);
        const renderArgs = `src/index.ts Main out/${name}.mp4 --props=${DIR}/work/${pid}/storyboard.json --scale=${scale}${frames ? ` --frames=${frames}` : ""} --codec=h264 --crf=${crf} --log=info --overwrite`;
        await startJob(sb, jobId, renderScript(DIR, renderArgs) + "\n" + verifyScript(`out/${name}.mp4`));
        return NextResponse.json({ jobId });
      }

      // joins the rendered parts of a long video into one file
      case "concat": {
        const pid = safeId(body.projectId);
        const kind = body.kind === "final" ? "final" : "preview";
        const parts = Math.max(1, Math.min(100, Math.floor(Number(body.parts) || 1)));
        const jobId = "c" + Date.now().toString(36);
        await startJob(sb, jobId, concatScript(DIR, pid, kind, parts));
        return NextResponse.json({ jobId });
      }

      // The real reason a job failed: the first error in the whole log (not just its tail) and the scene file that crashed, if any.
      case "joblog": {
        const jobId = String(body.jobId || "");
        if (!/^[a-z0-9]+$/.test(jobId)) return fail("Bad job id.", 400);
        const pid = safeId(body.projectId);
        const f = `/tmp/jobs/${jobId}.log`;
        const first = await exec(sb, `test -f ${f} && sed 's/\\x1b\\[[0-9;?]*[A-Za-z]//g' ${f} | tr '\\r' '\\n' | grep -n -m1 -B2 -A8 -E "Error|Minified React|Cannot read|is not defined|is not a function|Failed|failed" | head -c 2400 || true`, 15_000);
        const scene = await exec(sb, `test -f ${f} && grep -o "custom/${pid}_[A-Za-z0-9]*\\.tsx" ${f} | head -1 || true`, 10_000);
        const guards = await exec(sb, `test -f ${f} && grep -o "VENUS_GUARD .*" ${f} | head -5 || true`, 10_000);
        const m = /custom\/[A-Za-z0-9]+_([A-Za-z0-9]+)\.tsx/.exec(scene.stdout);
        return NextResponse.json({ firstError: first.stdout.trim(), sceneId: m ? m[1] : null, guarded: guards.stdout.trim() });
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

      // The finished video goes to storage as a background job (long videos are far too big for one request).
      case "upload": {
        const uid = String(body.uid);
        const pid = safeId(body.projectId);
        const kind = ["final", "scene"].includes(String(body.kind)) ? String(body.kind) : "preview";
        const objectPath = `${uid}/${pid}/${kind}.mp4`;
        await writeFiles(sb, { [`${DIR}/work/${pid}/upurl.txt`]: await createSignedUpload(objectPath) });
        const jobId = "u" + Date.now().toString(36);
        await startJob(sb, jobId, uploadScript(DIR, pid, kind));
        return NextResponse.json({ jobId, path: objectPath });
      }

      // ---- edit mode: take in the user's own video, find shots / silences / speech ----
      case "ingest-start": {
        const uid = String(body.uid);
        const pid = safeId(body.projectId);
        const src = (body.source ?? {}) as { kind?: string; path?: string; url?: string };
        let url = "";
        if (src.kind === "upload") {
          if (!String(src.path || "").startsWith(uid + "/")) return fail("This is not your upload.", 403);
          url = await createSignedDownload(String(src.path));
        } else if (src.kind === "url") {
          url = String(src.url || "").trim();
          if (!SAFE_URL.test(url)) return fail("Use a direct https link to the video file.", 400);
        } else return fail("No video was given.", 400);
        const files: Record<string, string> = { [`${DIR}/work/${pid}/url.txt`]: url };
        const key = await getExistingOpenAIKey(uid).catch(() => null);
        if (key) files[`${DIR}/work/${pid}/hdr.txt`] = `Authorization: Bearer ${key}`; // used once to read the speech, then deleted
        await exec(sb, `mkdir -p ${DIR}/work/${pid}`, 10_000);
        await writeFiles(sb, files);
        const jobId = "i" + Date.now().toString(36);
        await startJob(sb, jobId, ingestScript(DIR, pid));
        return NextResponse.json({ jobId, speech: Boolean(key) });
      }

      case "ingest-read": {
        const pid = safeId(body.projectId);
        const W = `${DIR}/work/${pid}`;
        const [info, cuts, sil, whisper, tiles] = await Promise.all([cat(sb, `${W}/info.json`), cat(sb, `${W}/cuts.txt`), cat(sb, `${W}/sil.log`), cat(sb, `${W}/whisper.json`, 900_000), cat(sb, `${W}/tiles.txt`)]);
        if (!info.trim()) return fail("The video analysis is not ready.", 409);
        const analysis = parseAnalysis({ info, cuts, sil, whisper, tiles });
        const img = await exec(sb, `base64 -w0 '${W}/sheet.jpg'`, 20_000);
        return NextResponse.json({ analysis, source: { path: `p/${pid}/vid/src.mp4`, duration: analysis.duration, width: analysis.width, height: analysis.height, hasAudio: analysis.hasAudio }, image: img.stdout.trim(), mediaType: "image/jpeg" });
      }

      default:
        return fail("Unknown action.", 400);
    }
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Studio request failed.", requestStatus(err));
  }
}
