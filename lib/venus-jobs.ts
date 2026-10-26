// Shell jobs that run on the studio computer (an E2B sandbox) and the parsers for what they print.
// Everything that can take longer than one request runs as a background job that the browser polls (see startJob / jobStatus).
// Secrets (signed URLs, API keys) are never put on a command line: the route writes them to a file in work/<id>/ and the job deletes it.
// NOTE: the scripts avoid dollar-brace sequences on purpose (they live in template strings).

export const MAX_SOURCE_SECONDS = 905; // 15 minutes (+ a few seconds of tolerance)

const tpl = (s: string, vars: Record<string, string>) => s.replace(/__([A-Z]+)__/g, (_, k) => (k in vars ? vars[k] : "__" + k + "__"));

// ---------------- edit mode: take in the user's own video ----------------
const INGEST = String.raw`set -u
cd __DIR__
W=work/__PID__
V=public/p/__PID__/vid
mkdir -p $W $V
echo "[1/6] Downloading your video"
curl -fsSL --retry 3 --connect-timeout 20 --max-time 1800 -o $W/raw.bin "$(cat $W/url.txt)" || { echo "ERR: the video could not be downloaded"; exit 11; }
rm -f $W/url.txt
echo "[2/6] Checking the video"
DUR=$(ffprobe -v error -show_entries format=duration -of csv=p=0 $W/raw.bin | head -1)
[ -n "$DUR" ] || { echo "ERR: this file is not a video"; exit 12; }
HASV=$(ffprobe -v error -select_streams v:0 -show_entries stream=codec_type -of csv=p=0 $W/raw.bin | head -1)
[ "$HASV" = "video" ] || { echo "ERR: the file has no video picture"; exit 12; }
awk -v d="$DUR" 'BEGIN{exit !(d>__MAX__)}' && { echo "ERR: the video is longer than 15 minutes ($DUR seconds). Please cut it first."; exit 13; }
HASA=$(ffprobe -v error -select_streams a:0 -show_entries stream=codec_type -of csv=p=0 $W/raw.bin | head -1)
echo "[3/6] Preparing the video for editing (a few minutes for long videos)"
if [ "$HASA" = "audio" ]; then
  ffmpeg -y -nostats -loglevel error -i $W/raw.bin -map 0:v:0 -map 0:a:0 -vf "scale='trunc(min(1920,iw)/2)*2':-2,fps=30,format=yuv420p" -c:v libx264 -preset veryfast -crf 21 -g 15 -keyint_min 15 -sc_threshold 0 -c:a aac -b:a 160k -ar 44100 -ac 2 -movflags +faststart $V/src.mp4
else
  ffmpeg -y -nostats -loglevel error -i $W/raw.bin -map 0:v:0 -an -vf "scale='trunc(min(1920,iw)/2)*2':-2,fps=30,format=yuv420p" -c:v libx264 -preset veryfast -crf 21 -g 15 -keyint_min 15 -sc_threshold 0 -movflags +faststart $V/src.mp4
fi
[ -s $V/src.mp4 ] || { echo "ERR: the video could not be converted"; exit 14; }
rm -f $W/raw.bin
ffprobe -v error -print_format json -show_format -show_streams $V/src.mp4 > $W/info.json
echo "[4/6] Finding shot changes and silences"
ffmpeg -hide_banner -nostats -i $V/src.mp4 -vf "scale=320:-2,select='gt(scene,0.35)',showinfo" -an -f null - 2> $W/scenes.log || true
grep -o 'pts_time:[0-9.]*' $W/scenes.log | cut -d: -f2 > $W/cuts.txt || true
: > $W/sil.log
if [ "$HASA" = "audio" ]; then
  ffmpeg -hide_banner -nostats -i $V/src.mp4 -vn -af silencedetect=noise=-32dB:d=0.5 -f null - 2> $W/sil.log || true
fi
echo "[5/6] Reading the speech"
rm -f $W/whisper.json
if [ "$HASA" = "audio" ] && [ -s $W/hdr.txt ]; then
  ffmpeg -y -loglevel error -i $V/src.mp4 -vn -ac 1 -ar 16000 -b:a 32k $W/a.mp3
  curl -sS --max-time 900 -X POST https://api.openai.com/v1/audio/transcriptions -H @$W/hdr.txt -F model=whisper-1 -F response_format=verbose_json -F file=@$W/a.mp3 -o $W/whisper.json || echo "(the speech could not be read; the edit continues without a transcript)"
fi
rm -f $W/hdr.txt $W/a.mp3
echo "[6/6] Taking sample frames"
D=$(ffprobe -v error -show_entries format=duration -of csv=p=0 $V/src.mp4 | head -1)
N=$(awk -v d="$D" 'BEGIN{n=int(d/45); if(n<8)n=8; if(n>16)n=16; print n}')
rm -f $W/f_*.jpg
: > $W/tiles.txt
i=1
while [ $i -le $N ]; do
  t=$(awk -v d="$D" -v i=$i -v n=$N 'BEGIN{printf "%.2f", d*(i-0.5)/n}')
  echo $t >> $W/tiles.txt
  ffmpeg -y -loglevel error -ss $t -i $V/src.mp4 -frames:v 1 -vf scale=480:-2 $W/f_$i.jpg
  i=$((i+1))
done
ROWS=$(( (N+3)/4 ))
TILE="4"x"$ROWS"
ffmpeg -y -loglevel error -framerate 1 -i $W/f_%d.jpg -filter_complex "tile=$TILE" -frames:v 1 -q:v 5 $W/sheet.jpg
[ -s $W/sheet.jpg ] || { echo "ERR: no sample frames"; exit 15; }
echo INGEST_OK
`;

export function ingestScript(dir: string, pid: string): string {
  return tpl(INGEST, { DIR: dir, PID: pid, MAX: String(MAX_SOURCE_SECONDS) });
}

export type SourceAnalysis = {
  duration: number; width: number; height: number; hasAudio: boolean;
  cuts: number[]; silences: Array<[number, number]>; transcript: Array<{ s: number; e: number; t: string }>; tiles: number[];
};

export function parseAnalysis(files: { info: string; cuts: string; sil: string; whisper: string; tiles: string }): SourceAnalysis {
  const info = JSON.parse(files.info || "{}") as { format?: { duration?: string }; streams?: Array<{ codec_type?: string; width?: number; height?: number; duration?: string }> };
  const v = (info.streams ?? []).find((x) => x.codec_type === "video");
  const duration = Number(info.format?.duration) || Number(v?.duration) || 0;
  const cuts = files.cuts.split("\n").map((x) => Number(x.trim())).filter((x) => Number.isFinite(x) && x > 0.3 && x < duration - 0.3);
  const silences: Array<[number, number]> = [];
  let open: number | null = null;
  for (const line of files.sil.split("\n")) {
    const a = /silence_start:\s*(-?[\d.]+)/.exec(line);
    const b = /silence_end:\s*([\d.]+)/.exec(line);
    if (a) open = Math.max(0, Number(a[1]));
    if (b && open !== null) { silences.push([open, Number(b[1])]); open = null; }
  }
  if (open !== null && duration > open + 0.5) silences.push([open, duration]);
  const transcript: SourceAnalysis["transcript"] = [];
  try {
    const w = JSON.parse(files.whisper || "{}") as { segments?: Array<{ start: number; end: number; text: string }> };
    for (const s of w.segments ?? []) {
      const t = String(s.text ?? "").replace(/\s+/g, " ").trim();
      if (t && s.end > s.start) transcript.push({ s: Math.round(s.start * 100) / 100, e: Math.round(s.end * 100) / 100, t });
    }
  } catch { /* no transcript */ }
  return {
    duration, width: v?.width ?? 1280, height: v?.height ?? 720, hasAudio: (info.streams ?? []).some((x) => x.codec_type === "audio"),
    cuts: cuts.slice(0, 120), silences: silences.slice(0, 120), transcript: transcript.slice(0, 700),
    tiles: files.tiles.split("\n").filter((x) => x.trim() !== "").map((x) => Number(x.trim())).filter((x) => Number.isFinite(x)),
  };
}

// ---------------- rendering in parts (long videos) ----------------
export const PART_FRAMES = 4500; // 2.5 minutes per part

export function renderScript(dir: string, args: string): string {
  return [
    "set -u",
    "cd " + dir,
    "mkdir -p out",
    "MEM=$(awk '/MemTotal/ {print int($2/1048576)}' /proc/meminfo)",
    "CPU=$(nproc)",
    "CONC=$CPU",
    "[ $((MEM/2)) -lt $CONC ] && CONC=$((MEM/2))",
    "[ $CONC -gt 4 ] && CONC=4",
    "[ $CONC -lt 1 ] && CONC=1",
    "echo \"[Venus Pro] Starting Remotion render with concurrency=$CONC\"",
    "if npx remotion render " + args + " --concurrency=$CONC; then",
    "  :",
    "else",
    "  first_code=$?",
    "  echo \"[Venus Pro] First render attempt failed (exit $first_code); retrying once with a single worker.\"",
    "  npx remotion render " + args + " --concurrency=1 || exit $?",
    "fi",
  ].join("\n");
}

export function verifyScript(file: string): string {
  return "test -s '" + file + "' || { echo '[Venus Pro] Render exited successfully but the MP4 is missing/empty'; exit 1; }\necho '[Venus Pro] Render output verified: " + file + "'";
}

export function concatScript(dir: string, pid: string, kind: string, parts: number): string {
  const lines = ["set -u", "cd " + dir, "mkdir -p work/" + pid, ": > work/" + pid + "/parts.txt"];
  for (let i = 0; i < parts; i++) lines.push("echo \"file '" + dir + "/out/" + pid + "-" + kind + "-p" + i + ".mp4'\" >> work/" + pid + "/parts.txt");
  lines.push(
    "ffmpeg -y -nostats -loglevel error -f concat -safe 0 -i work/" + pid + "/parts.txt -c:v copy -c:a aac -b:a 192k -movflags +faststart out/" + pid + "-" + kind + ".mp4",
    "test -s out/" + pid + "-" + kind + ".mp4 || { echo 'ERR: joining the parts failed'; exit 1; }",
    "rm -f out/" + pid + "-" + kind + "-p*.mp4",
    "echo CONCAT_OK"
  );
  return lines.join("\n");
}

export function uploadScript(dir: string, pid: string, kind: string): string {
  return [
    "set -u",
    "cd " + dir,
    "F=out/" + pid + "-" + kind + ".mp4",
    "test -f $F || { echo MISSING; exit 3; }",
    "SIZE=$(stat -c %s $F)",
    "CODE=$(curl -sS -o /tmp/up.out -w '%{http_code}' --max-time 3000 -X PUT \"$(cat work/" + pid + "/upurl.txt)\" -H 'Content-Type: video/mp4' -H 'x-upsert: true' --data-binary @$F)",
    "rm -f work/" + pid + "/upurl.txt",
    "echo \"UPLOAD $CODE $SIZE\"",
    "head -c 300 /tmp/up.out",
    "[ \"$CODE\" = \"200\" ] || exit 5",
  ].join("\n");
}

export function parseUpload(log: string): { code: number; bytes: number; detail: string } {
  const m = /UPLOAD\s+(\d+)\s+(\d+)/.exec(log);
  return { code: m ? Number(m[1]) : 0, bytes: m ? Number(m[2]) : 0, detail: log.split("\n").slice(-3).join(" ").slice(0, 240) };
}

// ---------------- long background music: several fresh tracks joined together ----------------
export function longMusicScript(dir: string, pid: string, segments: number): string {
  const lines = ["set -u", "cd " + dir, "mkdir -p public/p/" + pid, ": > work/" + pid + "/ml.txt"];
  for (let i = 0; i < segments; i++) {
    const b = "work/" + pid + "/m_" + i;
    lines.push(
      "node synth.cjs music " + b + ".json " + b + ".wav || exit 2",
      "ffmpeg -y -nostats -loglevel error -i " + b + ".wav -codec:a libmp3lame -b:a 128k " + b + ".mp3 && rm -f " + b + ".wav",
      "echo \"file '" + dir + "/" + b + ".mp3'\" >> work/" + pid + "/ml.txt",
      "echo \"[music] part " + (i + 1) + "/" + segments + "\""
    );
  }
  lines.push(
    "ffmpeg -y -nostats -loglevel error -f concat -safe 0 -i work/" + pid + "/ml.txt -c copy public/p/" + pid + "/music.mp3 || exit 3",
    "echo MUSIC_OK"
  );
  return lines.join("\n");
}
