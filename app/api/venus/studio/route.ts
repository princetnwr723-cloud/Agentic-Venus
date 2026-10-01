import { NextResponse } from "next/server";
import { connect, createSandbox, exec } from "@/lib/e2b-server";
import { verifyUser } from "@/lib/server-auth";
import { createSignedUpload } from "@/lib/supabase-server";
import {
  DIR,
  jobStatus,
  safeId,
  setupStudio,
  startJob,
  studioState,
  writeBinary,
  writeFiles,
} from "@/lib/venus-server";
import { sanitizeStoryboard, type Storyboard } from "@/lib/venus-schema";

export const runtime = "nodejs";
export const maxDuration = 60;

function fail(message: string, status = 500) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const action = String(body.action || "");
    const e2bKey = String(body.e2bKey || "");
    if (!e2bKey) return fail("E2B key missing.", 400);

    if (action === "create") {
      // provision:false → no Chrome/VS Code installer fighting our apt installs.
      const c = await createSandbox(e2bKey, { provision: false });
      return NextResponse.json({ sandboxId: c.sandboxId });
    }

    const sandboxId = String(body.sandboxId || "");
    if (!sandboxId) return fail("sandboxId missing.", 400);
    const sb = await connect(e2bKey, sandboxId);

    switch (action) {
      case "setup": {
        await setupStudio(sb);
        return NextResponse.json({ ok: true });
      }

      case "status": {
        return NextResponse.json(await studioState(sb));
      }

      case "prepare": {
        const pid = safeId(body.projectId);
        const storyboard = sanitizeStoryboard(body.storyboard, { keepFiles: true });
        await exec(sb, `mkdir -p ${DIR}/work/${pid} ${DIR}/public/p/${pid}/img ${DIR}/public/p/${pid}/vo`, 15_000);
        await writeFiles(sb, { [`${DIR}/work/${pid}/storyboard.json`]: JSON.stringify(storyboard) });
        return NextResponse.json({ ok: true });
      }

      case "assets": {
        await verifyUser(req, body.uid);
        const pid = safeId(body.projectId);
        const key = process.env.PEXELS_API_KEY;
        if (!key) return NextResponse.json({ skipped: true, images: {} });
        const sbd = sanitizeStoryboard(body.storyboard, { keepFiles: true }) as Storyboard;
        const orient = sbd.height > sbd.width ? "portrait" : sbd.width === sbd.height ? "square" : "landscape";
        const images: Record<string, string> = {};
        await exec(sb, `mkdir -p ${DIR}/public/p/${pid}/img`, 10_000);
        for (let i = 0; i < sbd.scenes.length; i++) {
          const q = String(sbd.scenes[i].imageQuery ?? "").trim();
          if (sbd.scenes[i].type !== "image" || !q) continue;
          try {
            const r = await fetch(
              "https://api.pexels.com/v1/search?per_page=3&orientation=" + orient + "&query=" + encodeURIComponent(q),
              { headers: { Authorization: key }, signal: AbortSignal.timeout(12_000) }
            );
            const data = (await r.json()) as { photos?: Array<{ src?: { large2x?: string; large?: string } }> };
            const src = data.photos?.[0]?.src?.large2x ?? data.photos?.[0]?.src?.large;
            if (!src || !/^https:\/\/images\.pexels\.com\//.test(src)) continue;
            const rel = `p/${pid}/img/scene-${i}.jpg`;
            const dl = await exec(sb, `curl -fsSL --max-time 30 -o '${DIR}/public/${rel}' '${src}'`, 40_000);
            if (dl.exitCode === 0) images[String(i)] = rel;
          } catch {
            // this photo is optional — the scene falls back to a gradient
          }
        }
        return NextResponse.json({ images });
      }

      case "tts": {
        const pid = safeId(body.projectId);
        const index = Math.max(0, Math.min(40, Number(body.index) || 0));
        const text = String(body.text || "").slice(0, 700);
        const openaiKey = String(body.openaiKey || "");
        if (!text || !openaiKey) return fail("Voiceover ke liye text aur OpenAI key chahiye.", 400);
        const voice = ["alloy", "echo", "fable", "onyx", "nova", "shimmer"].includes(String(body.voice))
          ? String(body.voice)
          : "nova";
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
        const d = await exec(
          sb,
          `ffprobe -v error -show_entries format=duration -of csv=p=0 '${DIR}/public/${rel}'`,
          15_000
        );
        const seconds = Number(d.stdout.trim());
        return NextResponse.json({ file: rel, seconds: Number.isFinite(seconds) ? seconds : 0 });
      }

      case "render": {
        const pid = safeId(body.projectId);
        const kind = body.kind === "final" ? "final" : "preview";
        const scale = Math.min(2, Math.max(0.25, Number(body.scale) || 1));
        const crf = kind === "preview" ? 30 : scale > 1 ? 26 : 23;
        const jobId = "r" + Date.now().toString(36);
        const script = [
          `cd ${DIR}`,
          "mkdir -p out",
          `npx remotion render src/index.ts Main out/${pid}-${kind}.mp4 --props=${DIR}/work/${pid}/storyboard.json --scale=${scale} --concurrency=2 --codec=h264 --crf=${crf} --log=info --overwrite`,
        ].join("\n");
        await startJob(sb, jobId, script);
        return NextResponse.json({ jobId });
      }

      case "progress": {
        const total = Math.max(0, Number(body.total) || 0);
        return NextResponse.json(await jobStatus(sb, String(body.jobId || ""), total));
      }

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
        if (r.exitCode !== 0 || r.stdout.length < 100) {
          return fail("Frames nikal nahi paye: " + (r.stderr || r.stdout).slice(0, 200));
        }
        return NextResponse.json({ image: r.stdout.trim(), mediaType: "image/jpeg" });
      }

      case "upload": {
        const { uid } = await verifyUser(req, body.uid);
        const pid = safeId(body.projectId);
        const kind = body.kind === "final" ? "final" : "preview";
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
        if (first.startsWith("MISSING")) return fail("Render ki file nahi mili.");
        if (code !== "200") {
          return fail(`Supabase upload fail (HTTP ${code}). ${r.stdout.split("\n").slice(1).join(" ").slice(0, 200)}`);
        }
        return NextResponse.json({ path: objectPath, bytes: Number(size) || 0 });
      }

      default:
        return fail("Unknown action.", 400);
    }
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Studio request failed.");
  }
}