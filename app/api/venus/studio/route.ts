import { NextResponse } from "next/server";
import { connect, createSandbox, exec } from "@/lib/e2b-server";
import { readBody } from "@/lib/request";
import { createSignedUpload } from "@/lib/supabase-server";
import { DIR, jobStatus, prepareProject, safeId, setupStudio, startJob, studioState, writeBinary } from "@/lib/venus-server";
import { sanitizeStoryboard } from "@/lib/venus-schema";

export const runtime = "nodejs";
export const maxDuration = 60;

const fail = (message: string, status = 500) => NextResponse.json({ error: message }, { status });

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
        const storyboard = sanitizeStoryboard(body.storyboard, { keepFiles: true });
        return NextResponse.json(await prepareProject(sb, pid, storyboard));
      }

      // One scene at a time: a stock photo (image scenes) or a stock video clip (footage scenes).
      case "assets": {
        const pid = safeId(body.projectId);
        const key = process.env.PEXELS_API_KEY;
        if (!key) return NextResponse.json({ skipped: true });
        const sbd = sanitizeStoryboard(body.storyboard, { keepFiles: true });
        const i = Math.max(0, Math.min(sbd.scenes.length - 1, Number(body.index) || 0));
        const s = sbd.scenes[i];
        const orient = sbd.height > sbd.width ? "portrait" : sbd.width === sbd.height ? "square" : "landscape";
        const dir = `${DIR}/public/p/${pid}`;

        if (s.type === "image" && s.imageQuery) {
          const r = await fetch(`https://api.pexels.com/v1/search?per_page=3&orientation=${orient}&query=${encodeURIComponent(String(s.imageQuery))}`, { headers: { Authorization: key }, signal: AbortSignal.timeout(12_000) });
          const data = (await r.json()) as { photos?: Array<{ src?: { large2x?: string; large?: string } }> };
          const src = data.photos?.[0]?.src?.large2x ?? data.photos?.[0]?.src?.large;
          if (src && /^https:\/\/images\.pexels\.com\//.test(src)) {
            const rel = `p/${pid}/img/scene-${i}.jpg`;
            await exec(sb, `mkdir -p ${dir}/img`, 10_000);
            const dl = await exec(sb, `curl -fsSL --max-time 30 -o '${DIR}/public/${rel}' '${src}'`, 40_000);
            if (dl.exitCode === 0) return NextResponse.json({ image: rel });
          }
        }

        if (s.type === "footage" && s.footageQuery) {
          const r = await fetch(`https://api.pexels.com/videos/search?per_page=10&size=medium&orientation=${orient}&query=${encodeURIComponent(String(s.footageQuery))}`, { headers: { Authorization: key }, signal: AbortSignal.timeout(12_000) });
          const data = (await r.json()) as { videos?: Array<{ duration?: number; video_files?: Array<{ link?: string; width?: number; height?: number; file_type?: string }> }> };
          const need = Number(s.seconds) || 5;
          const vids = (data.videos ?? []).filter((v) => (v.video_files ?? []).length > 0);
          const pick = vids.find((v) => (v.duration ?? 0) >= need) ?? vids[0];
          const target = 1280;
          const file = (pick?.video_files ?? [])
            .filter((f) => f.file_type === "video/mp4" && f.link && /^https:\/\/[a-z0-9.-]*pexels\.com\//.test(f.link))
            .sort((a, b) => Math.abs(Math.max(a.width ?? 0, a.height ?? 0) - target) - Math.abs(Math.max(b.width ?? 0, b.height ?? 0) - target))[0];
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
        const script = [
          `cd ${DIR}`,
          "mkdir -p out",
          `npx remotion render src/index.ts Main out/${pid}-${kind}.mp4 --props=${DIR}/work/${pid}/storyboard.json --scale=${scale}${frames ? ` --frames=${frames}` : ""} --concurrency=2 --codec=h264 --crf=${crf} --log=info --overwrite`,
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
    return fail(err instanceof Error ? err.message : "Studio request failed.");
  }
}