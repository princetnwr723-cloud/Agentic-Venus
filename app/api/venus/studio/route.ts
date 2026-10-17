import { NextResponse } from "next/server";
import { connect, createSandbox, exec } from "@/lib/e2b-server";
import { readBody, requestStatus } from "@/lib/request";
import { createSignedUpload } from "@/lib/supabase-server";
import { DIR, jobStatus, prepareProject, safeId, setupStudio, startJob, studioState, writeBinary } from "@/lib/venus-server";
import { sanitizeStoryboard } from "@/lib/venus-schema";

export const runtime = "nodejs";
export const maxDuration = 60;

const fail = (message: string, status = 500) => NextResponse.json({ error: message }, { status });

// Use the same real-image sources as chat's image.search tool for Venus Pro still-image scenes.
// Search results are downloaded server-side and copied into the E2B project's public assets.
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
        const pid = safeId(body.projectId);
        let storyboard = sanitizeStoryboard(body.storyboard, { keepFiles: true });
        // Build a deterministic, code-free SFX track from scene soundCue metadata.
        // If FFmpeg/audio filters are unavailable, video preparation still succeeds.
        try {
          const sfxPath = `${DIR}/public/p/${pid}/sfx.mp3`;
          const cues: Array<{ at: number; kind: string }> = [];
          let cursor = 0;
          const scenes = storyboard.scenes;
          // A short typing sequence establishes the UI/product-demo feel.
          if (scenes.length && scenes.some((scene) => ["typing", "soft-click"].includes(String(scene.soundCue || "")))) {
            for (let n = 0; n < 10; n++) cues.push({ at: Math.min(1.7, n * 0.085), kind: "typing" });
          }
          scenes.forEach((scene, index) => {
            const kind = String(scene.soundCue || (index === scenes.length - 1 ? "chime" : index === 0 ? "soft-click" : "whoosh"));
            if (kind !== "none" && index > 0) cues.push({ at: Math.max(0, cursor - 0.08), kind });
            cursor += Math.max(1.5, Number(scene.seconds) || 4) - 0.4;
          });
          if (cues.length) {
            const safeCues = cues.filter((c) => Number.isFinite(c.at) && c.at >= 0 && c.at < 60).slice(0, 32);
            await exec(sb, `mkdir -p ${DIR}/public/p/${pid}`, 10_000);
            const inputs: string[] = [];
            const filters: string[] = [];
            safeCues.forEach((cue, i) => {
              const at = Math.max(0, Math.round(cue.at * 1000));
              let source = "sine=frequency=1500:sample_rate=44100";
              let duration = 0.06;
              let filter = "volume=0.12,afade=t=out:st=0.008:d=0.052";
              if (cue.kind === "whoosh" || cue.kind === "riser") {
                source = "anoisesrc=color=pink:amplitude=0.22:sample_rate=44100"; duration = cue.kind === "riser" ? 0.55 : 0.32;
                filter = `highpass=f=450,lowpass=f=9000,afade=t=in:d=0.04,afade=t=out:st=${(duration * 0.45).toFixed(3)}:d=${(duration * 0.55).toFixed(3)},volume=0.16`;
              } else if (cue.kind === "impact") {
                source = "sine=frequency=95:sample_rate=44100"; duration = 0.24;
                filter = "afade=t=in:d=0.004,afade=t=out:st=0.06:d=0.18,volume=0.22";
              } else if (cue.kind === "chime") {
                source = "sine=frequency=880:sample_rate=44100"; duration = 0.42;
                filter = "afade=t=in:d=0.01,afade=t=out:st=0.12:d=0.3,volume=0.13";
              }
              inputs.push(`-f lavfi -t ${duration} -i '${source}'`);
              filters.push(`[${i}:a]${filter},adelay=${at}|${at}[a${i}]`);
            });
            const mix = safeCues.map((_, i) => `[a${i}]`).join("");
            const cmd = `ffmpeg -y -loglevel error ${inputs.join(" ")} -filter_complex '${filters.join(";")};${mix}amix=inputs=${safeCues.length}:duration=longest:normalize=0,alimiter=limit=0.85[out]' -map '[out]' -t ${Math.max(8, Math.ceil(cursor + 1))} -codec:a libmp3lame -b:a 128k '${sfxPath}'`;
            const result = await exec(sb, cmd, 45_000);
            if (result.exitCode === 0) storyboard = { ...storyboard, sfx: `p/${pid}/sfx.mp3` };
          }
        } catch { /* SFX are optional; never block the visual render. */ }
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

          // First use the same Wikimedia Commons + Openverse image-search sources as chat.
          // Rank by canvas aspect ratio and available resolution, then try candidates until one downloads.
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

          // If web-image search finds no usable image, retain Pexels as an optional fallback.
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
            } catch { /* Pexels is optional; continue to the normal visual fallback. */ }
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
          // Prefer clips long enough for the shot, matching the canvas shape and with usable resolution.
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

      // A simple generated ambient bed (layered sine chord with slow tremolo and echo).
      case "music": {
        const pid = safeId(body.projectId);
        const secs = Math.min(75, Math.max(8, Math.ceil(Number(body.seconds) || 30)));
        const minor = Boolean(body.dark);
        const f = minor ? [110, 130.81, 164.81, 220] : [110, 138.59, 164.81, 207.65];
        const rel = `p/${pid}/music.mp3`;
        await exec(sb, `mkdir -p ${DIR}/public/p/${pid}`, 10_000);
        const inputs = f.map((hz) => `-f lavfi -i "sine=frequency=${hz}:sample_rate=44100"`).join(" ");
        const cmd = `ffmpeg -y -loglevel error ${inputs} -filter_complex "[0][1][2][3]amix=inputs=4:normalize=0,tremolo=f=0.18:d=0.45,lowpass=f=1400,aecho=0.8:0.7:60|120:0.35|0.25,volume=0.5,afade=t=in:d=2,afade=t=out:st=${secs - 3}:d=3" -t ${secs} -b:a 128k '${DIR}/public/${rel}'`;
        const r = await exec(sb, cmd, 50_000);
        if (r.exitCode !== 0) return fail("Music generation failed: " + (r.stderr || r.stdout).slice(0, 200));
        return NextResponse.json({ file: rel });
      }

      case "render": {
        const pid = safeId(body.projectId);
        const kind = body.kind === "final" ? "final" : body.kind === "scene" ? "scene" : "preview";
        const scale = Math.min(2, Math.max(0.25, Number(body.scale) || 1));
        const crf = kind === "final" ? (scale > 1 ? 26 : 23) : 30;
        const frames = /^\d+-\d+$/.test(String(body.frames || "")) ? String(body.frames) : "";
        const jobId = "r" + Date.now().toString(36);
        const renderArgs = `src/index.ts Main out/${pid}-${kind}.mp4 --props=${DIR}/work/${pid}/storyboard.json --scale=${scale}${frames ? ` --frames=${frames}` : ""} --codec=h264 --crf=${crf} --log=info --overwrite`;
        // Low-memory E2B desktops can lose a Remotion browser worker under parallel rendering.
        // Start conservatively, then retry once with an even safer single-worker render if it fails.
        const script = [
          "set -u",
          `cd ${DIR}`,
          "mkdir -p out",
          `echo '[Venus Pro] Starting Remotion render with concurrency=1'`,
          `if npx remotion render ${renderArgs} --concurrency=1; then`,
          `  test -s 'out/${pid}-${kind}.mp4' || { echo '[Venus Pro] Render exited successfully but MP4 is missing/empty'; exit 1; }`,
          "else",
          "  first_code=$?",
          "  echo "[Venus Pro] First render attempt failed (exit $first_code); retrying once with a fresh single-worker render."",
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