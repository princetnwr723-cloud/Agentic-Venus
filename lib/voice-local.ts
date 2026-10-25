// Server-only. LOCAL VOICE: a text-to-speech model (Piper, runs on CPU) on the chat's own cloud PC (E2B).
// The chat model writes the words; this model speaks them; Twilio plays the audio on the phone call.
// Calls never depend on it: whenever the local voice is not ready, the call uses the built-in voice instead.
import { createHash, createHmac } from "crypto";
import { getAdminDb } from "@/lib/firebase-admin";
import { resolveValue } from "@/lib/vault";
import type { VoiceSettings } from "@/lib/voice-server";

export const LOCAL_PORT = 8787;
const SERVER_VERSION = "2026.10.1";

// ---------------- country -> language (any country can be called) ----------------
const CALLING_CODES: Record<string, string> = {
  "1": "en-US", "7": "ru-RU", "20": "ar-EG", "27": "en-ZA", "30": "el-GR", "31": "nl-NL", "32": "nl-BE", "33": "fr-FR",
  "34": "es-ES", "36": "hu-HU", "39": "it-IT", "40": "ro-RO", "41": "de-CH", "43": "de-AT", "44": "en-GB", "45": "da-DK",
  "46": "sv-SE", "47": "nb-NO", "48": "pl-PL", "49": "de-DE", "51": "es-PE", "52": "es-MX", "53": "es-CU", "54": "es-AR",
  "55": "pt-BR", "56": "es-CL", "57": "es-CO", "58": "es-VE", "60": "ms-MY", "61": "en-AU", "62": "id-ID", "63": "fil-PH",
  "64": "en-NZ", "65": "en-SG", "66": "th-TH", "81": "ja-JP", "82": "ko-KR", "84": "vi-VN", "86": "zh-CN", "90": "tr-TR",
  "91": "hi-IN", "92": "ur-PK", "93": "fa-IR", "94": "si-LK", "95": "my-MM", "98": "fa-IR",
  "212": "ar-MA", "213": "ar-DZ", "216": "ar-TN", "218": "ar-LY", "233": "en-GH", "234": "en-NG", "254": "sw-KE", "255": "sw-TZ",
  "256": "en-UG", "351": "pt-PT", "352": "fr-LU", "353": "en-IE", "354": "is-IS", "358": "fi-FI", "359": "bg-BG", "370": "lt-LT",
  "371": "lv-LV", "372": "et-EE", "374": "hy-AM", "380": "uk-UA", "381": "sr-RS", "385": "hr-HR", "386": "sl-SI", "420": "cs-CZ",
  "421": "sk-SK", "852": "zh-HK", "855": "km-KH", "856": "lo-LA", "880": "bn-BD", "886": "zh-TW", "961": "ar-LB", "962": "ar-JO",
  "963": "ar-SY", "964": "ar-IQ", "965": "ar-KW", "966": "ar-SA", "967": "ar-YE", "968": "ar-OM", "971": "ar-AE", "972": "he-IL",
  "973": "ar-BH", "974": "ar-QA", "977": "ne-NP", "994": "az-AZ", "995": "ka-GE", "998": "uz-UZ",
};

/** "+81 90 1234 5678" -> "ja-JP". Unknown countries get English. */
export function languageForNumber(number?: string): string {
  const digits = String(number ?? "").replace(/\D/g, "");
  for (const n of [3, 2, 1]) {
    const hit = CALLING_CODES[digits.slice(0, n)];
    if (hit && digits.length > n) return hit;
  }
  return "en-US";
}

/** The saved language setting; "auto" means: follow the country of the number on the call. */
export function resolveLanguage(setting: string | undefined, number?: string): string {
  const s = String(setting ?? "en-US").trim();
  return s === "auto" || !s ? languageForNumber(number) : s;
}

// What the chat model wrote may be in another language than the call language: speak it with the right voice.
const SCRIPTS: Array<[RegExp, string, string[]]> = [
  [/[\u0900-\u097F]/g, "hi-IN", ["hi", "mr", "ne", "sa"]],
  [/[\u0980-\u09FF]/g, "bn-BD", ["bn", "as"]],
  [/[\u0A00-\u0A7F]/g, "pa-IN", ["pa"]],
  [/[\u0A80-\u0AFF]/g, "gu-IN", ["gu"]],
  [/[\u0B80-\u0BFF]/g, "ta-IN", ["ta"]],
  [/[\u0C00-\u0C7F]/g, "te-IN", ["te"]],
  [/[\u0C80-\u0CFF]/g, "kn-IN", ["kn"]],
  [/[\u0D00-\u0D7F]/g, "ml-IN", ["ml"]],
  [/[\u0600-\u06FF]/g, "ar-SA", ["ar", "fa", "ur", "ps"]],
  [/[\u0400-\u04FF]/g, "ru-RU", ["ru", "uk", "bg", "sr", "be", "kk"]],
  [/[\u0370-\u03FF]/g, "el-GR", ["el"]],
  [/[\u0590-\u05FF]/g, "he-IL", ["he"]],
  [/[\u0E00-\u0E7F]/g, "th-TH", ["th"]],
  [/[\u3040-\u30FF]/g, "ja-JP", ["ja"]],
  [/[\u4E00-\u9FFF]/g, "zh-CN", ["zh", "yue", "ja"]],
  [/[\uAC00-\uD7AF]/g, "ko-KR", ["ko"]],
];
const NON_LATIN = new Set(SCRIPTS.flatMap(([, , fams]) => fams));

export function speechLanguage(text: string, callLang: string): string {
  const fam = (l: string) => l.toLowerCase().split("-")[0];
  const letters = (text.match(/\p{L}/gu) ?? []).length;
  if (!letters) return callLang;
  let best: { n: number; lang: string; fams: string[] } | null = null;
  for (const [re, lang, fams] of SCRIPTS) {
    const n = (text.match(re) ?? []).length;
    if (n > (best?.n ?? 0)) best = { n, lang, fams };
  }
  if (best && best.n / letters >= 0.4) return best.fams.includes(fam(callLang)) ? callLang : best.lang;
  // Roman letters but a non-Roman call language (e.g. Hinglish): read it with an English voice, not a Hindi one.
  if (NON_LATIN.has(fam(callLang))) return /-IN$/.test(callLang) ? "en-IN" : "en-US";
  return callLang;
}

// ---------------- the voice server that runs on the cloud PC ----------------
const PY_SERVER = String.raw`#!/usr/bin/env python3
# Venus local voice server: Piper (CPU text-to-speech) for phone calls. Runs on the chat's cloud PC.
import hashlib, hmac, io, json, os, threading, time, urllib.request, wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import numpy as np

VERSION = "2026.10.1"
HOME = os.environ.get("VENUS_VOICE_HOME") or os.path.join(os.path.expanduser("~"), ".venus-voice")
VOICES = os.path.join(HOME, "voices")
PORT = int(os.environ.get("VENUS_VOICE_PORT", "8787"))
CATALOG = "https://huggingface.co/rhasspy/piper-voices/resolve/main/voices.json"
FILES = "https://huggingface.co/rhasspy/piper-voices/resolve/main/"
QUALITY = {"medium": 0, "high": 1, "low": 2, "x_low": 3}
SPECIAL = {"nb": "no", "nn": "no", "iw": "he", "fil": "tl"}
PREFERRED = ["en_US-lessac-medium", "en_GB-alba-medium", "de_DE-thorsten-medium", "fr_FR-siwis-medium", "es_ES-davefx-medium",
             "es_MX-ald-medium", "it_IT-paola-medium", "pt_BR-faber-medium", "ru_RU-irina-medium", "hi_IN-pratham-medium",
             "tr_TR-dfki-medium", "pl_PL-gosia-medium", "nl_NL-mls-medium", "uk_UA-lada-x_low", "zh_CN-huayan-medium"]
KEY = ""
try:
    import piper  # noqa: F401
    ENGINE = True
except Exception:
    ENGINE = False

_synth_lock = threading.Lock()
_load_lock = threading.Lock()
_catalog = None
_loaded = {}


def log(*a):
    print(time.strftime("%H:%M:%S"), *a, flush=True)


def catalog():
    global _catalog
    if _catalog:
        return _catalog
    path = os.path.join(HOME, "voices.json")
    try:
        if not os.path.exists(path) or time.time() - os.path.getmtime(path) > 7 * 86400:
            req = urllib.request.Request(CATALOG, headers={"User-Agent": "venus-voice"})
            with urllib.request.urlopen(req, timeout=30) as r:
                data = r.read()
            with open(path, "wb") as f:
                f.write(data)
    except Exception as e:
        log("catalog download failed:", e)
    try:
        with open(path, "r", encoding="utf-8") as f:
            _catalog = json.load(f)
    except Exception:
        _catalog = None
    return _catalog or {}


def pick_voice(lang, wanted=""):
    cat = catalog()
    if wanted and wanted in cat:
        return wanted
    parts = (lang or "en-US").replace("-", "_").split("_")
    fam = SPECIAL.get(parts[0].lower(), parts[0].lower())
    region = parts[-1].upper() if len(parts) > 1 else ""
    best = None
    for key, v in cat.items():
        info = v.get("language") or {}
        code = str(info.get("code", ""))
        if str(info.get("family", code.split("_")[0])).lower() != fam:
            continue
        score = QUALITY.get(v.get("quality", ""), 9) * 10
        if region and code.upper().endswith("_" + region):
            score -= 100
        if key in PREFERRED:
            score -= 50
        if int(v.get("num_speakers", 1) or 1) > 1:
            score += 5
        if best is None or (score, key) < best:
            best = (score, key)
    return best[1] if best else None


def fetch_voice(key):
    entry = catalog()[key]
    os.makedirs(VOICES, exist_ok=True)
    onnx = None
    for rel in entry.get("files", {}):
        if not (rel.endswith(".onnx") or rel.endswith(".onnx.json")):
            continue
        dst = os.path.join(VOICES, os.path.basename(rel))
        if not os.path.exists(dst) or os.path.getsize(dst) == 0:
            tmp = dst + ".part"
            req = urllib.request.Request(FILES + rel + "?download=true", headers={"User-Agent": "venus-voice"})
            with urllib.request.urlopen(req, timeout=120) as r, open(tmp, "wb") as f:
                while True:
                    chunk = r.read(1 << 16)
                    if not chunk:
                        break
                    f.write(chunk)
            os.replace(tmp, dst)
        if rel.endswith(".onnx"):
            onnx = dst
    if not onnx:
        raise RuntimeError("voice has no model file: " + key)
    return onnx


def get_voice(key):
    with _load_lock:
        v = _loaded.get(key)
        if v is not None:
            return v
        from piper import PiperVoice
        v = PiperVoice.load(fetch_voice(key))
        if len(_loaded) >= 3:
            _loaded.pop(next(iter(_loaded)))
        _loaded[key] = v
        log("loaded voice", key)
        return v


def synth(voice, text):
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        if hasattr(voice, "synthesize_wav"):
            voice.synthesize_wav(text, w)
        else:
            voice.synthesize(text, w)
    buf.seek(0)
    with wave.open(buf, "rb") as r:
        rate, ch, frames = r.getframerate(), r.getnchannels(), r.readframes(r.getnframes())
    pcm = np.frombuffer(frames, dtype=np.int16)
    if ch > 1:
        pcm = pcm[: len(pcm) // ch * ch].reshape(-1, ch).mean(axis=1).astype(np.int16)
    return pcm, rate


def phone_wav(pcm, rate):
    """8 kHz mono 16-bit WAV: what a phone line carries, and small enough to send fast."""
    x = pcm.astype(np.float32) / 32768.0
    if len(x) and rate != 8000:
        taps = 63
        n = np.arange(taps) - (taps - 1) / 2.0
        h = np.sinc(2.0 * (3600.0 / rate) * n) * np.hamming(taps)
        h /= h.sum()
        x = np.convolve(x, h, mode="same")
        n_out = int(len(x) * 8000.0 / rate)
        x = np.interp(np.arange(n_out) * (rate / 8000.0), np.arange(len(x)), x)
    peak = float(np.max(np.abs(x))) if len(x) else 0.0
    if peak > 0:
        x = x * (0.89 / peak)
    y = np.clip(x * 32767.0, -32768, 32767).astype(np.int16)
    y = np.concatenate([np.zeros(640, dtype=np.int16), y, np.zeros(960, dtype=np.int16)])
    out = io.BytesIO()
    with wave.open(out, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(8000)
        w.writeframes(y.tobytes())
    return out.getvalue()


class Handler(BaseHTTPRequestHandler):
    server_version = "VenusVoice"

    def log_message(self, *a):
        pass

    def _send(self, code, body, ctype="application/json", extra=None):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def _json(self, code, obj):
        self._send(code, json.dumps(obj).encode("utf-8"))

    def do_GET(self):
        if self.path.split("?")[0] == "/health":
            kid = hashlib.sha256(KEY.encode()).hexdigest()[:8]
            return self._json(200, {"ok": ENGINE, "version": VERSION, "kid": kid, "loaded": sorted(_loaded)})
        self._json(404, {"error": "not_found"})

    def do_POST(self):
        try:
            if self.path.split("?")[0] != "/tts":
                return self._json(404, {"error": "not_found"})
            supplied = (self.headers.get("X-Voice-Key") or "").encode("utf-8", "ignore")
            if not KEY or not hmac.compare_digest(supplied, KEY.encode()):
                return self._json(403, {"error": "forbidden"})
            n = int(self.headers.get("Content-Length") or 0)
            if n <= 0 or n > 8192:
                return self._json(413, {"error": "bad_size"})
            body = json.loads(self.rfile.read(n).decode("utf-8"))
            text = " ".join(str(body.get("text", "")).split())[:700]
            lang = str(body.get("lang", "en-US"))[:16]
            wanted = str(body.get("voice", ""))[:80]
            if not text:
                return self._json(400, {"error": "empty_text"})
            if not ENGINE:
                return self._json(503, {"error": "engine_missing"})
            key = pick_voice(lang, wanted)
            if not key:
                return self._json(404, {"error": "no_voice", "lang": lang})
            voice = get_voice(key)
            with _synth_lock:
                pcm, rate = synth(voice, text)
            self._send(200, phone_wav(pcm, rate), "audio/wav", {"X-Voice": key})
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception as e:
            log("tts error:", repr(e))
            try:
                self._json(500, {"error": "tts_failed", "detail": str(e)[:200]})
            except Exception:
                pass


def main():
    global KEY
    os.makedirs(HOME, exist_ok=True)
    with open(os.path.join(HOME, "key"), "r") as f:
        KEY = f.read().strip()
    with open(os.path.join(HOME, "server.pid"), "w") as f:
        f.write(str(os.getpid()))
    ThreadingHTTPServer.daemon_threads = True
    srv = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    log("venus voice server", VERSION, "engine:", ENGINE, "port:", PORT)
    srv.serve_forever()


if __name__ == "__main__":
    main()
`;

const SETUP_SH = String.raw`#!/bin/bash
# Venus local voice: installs Piper once, then (re)starts the voice server. Safe to run many times.
H="$HOME/.venus-voice"
mkdir -p "$H/voices"
cd "$H" || exit 1
exec 9>"$H/setup.lock"
flock -n 9 || exit 0
export PATH="$HOME/.local/bin:$PATH"
pip_in() { python3 -m pip install --user --quiet "$@" >>"$H/setup.log" 2>&1 || python3 -m pip install --user --quiet --break-system-packages "$@" >>"$H/setup.log" 2>&1; }
if ! python3 -m pip --version >/dev/null 2>&1; then
  sudo apt-get update -y >>"$H/setup.log" 2>&1
  sudo apt-get install -y python3-pip >>"$H/setup.log" 2>&1
fi
python3 -c "import piper, numpy" 2>/dev/null || pip_in piper-tts numpy
if [ -f "$H/server.pid" ]; then
  P=$(cat "$H/server.pid")
  if grep -q server.py "/proc/$P/cmdline" 2>/dev/null; then kill "$P" 2>/dev/null; sleep 1; fi
fi
nohup python3 "$H/server.py" >>"$H/server.log" 2>&1 9>&- < /dev/null &
echo started
`;

function installCommand(key: string): string {
  return [
    `mkdir -p "$HOME/.venus-voice/voices"`,
    `cat > "$HOME/.venus-voice/server.py" <<'VENUS_PY_EOF'\n${PY_SERVER}\nVENUS_PY_EOF`,
    `cat > "$HOME/.venus-voice/setup.sh" <<'VENUS_SH_EOF'\n${SETUP_SH}\nVENUS_SH_EOF`,
    `echo ${key} > "$HOME/.venus-voice/key"`,
    `chmod 600 "$HOME/.venus-voice/key"`,
    `nohup bash "$HOME/.venus-voice/setup.sh" > "$HOME/.venus-voice/setup.out" 2>&1 < /dev/null &`,
    `echo started`,
  ].join("\n");
}

// ---------------- keys ----------------
function signingSecret() {
  const s = process.env.ROUTINE_RUNNER_SECRET;
  if (!s || s.length < 32) throw new Error("Voice needs ROUTINE_RUNNER_SECRET (at least 32 characters).");
  return s;
}
/** The voice server only answers requests that carry this key. It is derived, never stored. */
export const voiceKey = (sandboxId: string) => createHmac("sha256", signingSecret()).update("venus-local-voice:" + sandboxId).digest("hex").slice(0, 40);
const keyId = (key: string) => createHash("sha256").update(key).digest("hex").slice(0, 8);

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const withTimeout = <T,>(p: Promise<T>, ms: number, what: string): Promise<T> =>
  Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`${what} took too long.`)), ms))]);

// ---------------- start / wake the voice server ----------------
export type LocalVoiceState =
  | { state: "ready"; url: string; sandboxId: string }
  | { state: "installing" | "no_computer" | "error"; detail: string };

const inflight = new Map<string, Promise<LocalVoiceState>>();
const cooldown = new Map<string, number>();

async function doEnsure(uid: string, chatId: string | undefined, budgetMs: number): Promise<LocalVoiceState> {
  const t0 = Date.now();
  try {
    const userRef = getAdminDb().collection("users").doc(uid);
    const user = (await userRef.get()).data() as { e2bKey?: string; pcSandboxId?: string | null } | undefined;
    let sandboxId = user?.pcSandboxId ?? "";
    if (chatId) {
      const chat = (await userRef.collection("chats").doc(chatId).get()).data() as { pcSandboxId?: string | null } | undefined;
      if (chat?.pcSandboxId) sandboxId = chat.pcSandboxId;
    }
    if (!user?.e2bKey || !sandboxId) return { state: "no_computer", detail: "Is chat ka cloud PC abhi bana nahi hai (ya E2B key saved nahi hai). Pehle PC kholo." };
    const e2bKey = await resolveValue(uid, user.e2bKey);
    const { connect, exec } = await import("@/lib/e2b-server");
    const sb = await withTimeout(connect(e2bKey, sandboxId), Math.max(4000, Math.min(budgetMs, 15_000)), "Waking the cloud PC");
    const url = `https://${(sb as unknown as { getHost: (p: number) => string }).getHost(LOCAL_PORT)}`;
    const key = voiceKey(sandboxId);
    const kid = keyId(key);
    const ready = async () => {
      try {
        const r = await exec(sb, `curl -s --max-time 3 http://127.0.0.1:${LOCAL_PORT}/health || true`, 8000);
        const j = JSON.parse(r.stdout.trim()) as { ok?: boolean; version?: string; kid?: string };
        return j.ok === true && j.version === SERVER_VERSION && j.kid === kid;
      } catch { return false; }
    };
    if (!(await ready())) {
      await exec(sb, installCommand(key), 20_000);
      let ok = false;
      while (Date.now() - t0 < budgetMs) {
        await sleep(2500);
        if (await ready()) { ok = true; break; }
      }
      if (!ok) {
        const log = await exec(sb, `tail -n 4 "$HOME/.venus-voice/setup.log" 2>/dev/null; true`, 6000).catch(() => ({ stdout: "" }));
        return { state: "installing", detail: `Local voice abhi install ho rahi hai (pehli baar 1-2 minute lagte hain). Tab tak built-in voice chalegi.${log.stdout.trim() ? "\n" + log.stdout.trim().slice(-300) : ""}` };
      }
    }
    await userRef.set({ voiceSettings: { localVoiceUrl: url, localVoiceSandbox: sandboxId, localVoiceAt: Date.now() } }, { merge: true });
    return { state: "ready", url, sandboxId };
  } catch (e) {
    return { state: "error", detail: (e instanceof Error ? e.message : String(e)).slice(0, 240) };
  }
}

/** Makes sure the voice server is running on the chat's cloud PC (wakes the PC if it sleeps). Never throws. */
export function ensureLocalVoice(uid: string, chatId: string | undefined, budgetMs = 20_000): Promise<LocalVoiceState> {
  const k = `${uid}:${chatId ?? ""}`;
  const hit = inflight.get(k);
  if (hit) return hit;
  const p = doEnsure(uid, chatId, budgetMs).finally(() => inflight.delete(k));
  inflight.set(k, p);
  return p;
}

type Audio = { bytes: Buffer; mime: string };

async function requestTts(url: string, sandboxId: string, text: string, lang: string, voice: string, timeoutMs: number): Promise<Response | null> {
  try {
    return await fetch(`${url}/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Voice-Key": voiceKey(sandboxId) },
      body: JSON.stringify({ text: text.slice(0, 700), lang, voice }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch { return null; }
}

const PIPER_NAME = /^[a-z]{2,3}_[A-Z]{2}-[A-Za-z0-9_]+-[a-z_]+$/;

/** Speech from the local voice model, or null when the caller should hear the built-in voice instead. */
export async function localTts(s: VoiceSettings, text: string, lang: string, opts: { uid: string; chatId?: string; wake?: boolean }): Promise<Audio | null> {
  let url = s.localVoiceUrl ?? "";
  let sandboxId = s.localVoiceSandbox ?? "";
  const voice = PIPER_NAME.test(s.ttsVoice ?? "") ? (s.ttsVoice as string) : "";
  const wake = async (): Promise<boolean> => {
    if (!opts.wake || Date.now() < (cooldown.get(opts.uid) ?? 0)) return false;
    const st = await ensureLocalVoice(opts.uid, opts.chatId, 9000);
    if (st.state === "ready") { url = st.url; sandboxId = st.sandboxId; return true; }
    cooldown.set(opts.uid, Date.now() + 60_000); // do not make every sentence wait for a PC that is not there
    return false;
  };
  if (!url || !sandboxId) { if (!(await wake())) return null; }
  let r = await requestTts(url, sandboxId, text, lang, voice, 7000);
  if (r && r.status === 404) return null; // no local voice for this language: the built-in voice speaks
  if (!r || !r.ok) {
    if (!(await wake())) return null;
    r = await requestTts(url, sandboxId, text, lang, voice, 7000);
  }
  if (!r || !r.ok) return null;
  const bytes = Buffer.from(await r.arrayBuffer());
  return bytes.length > 44 ? { bytes, mime: "audio/wav" } : null;
}

/** Start the PC + voice server and load the voice for this language, so the first sentence of a call is fast. Never throws. */
export async function warmLocalVoice(uid: string, chatId: string | undefined, lang: string, budgetMs = 20_000): Promise<LocalVoiceState> {
  const t0 = Date.now();
  const st = await ensureLocalVoice(uid, chatId, budgetMs);
  if (st.state !== "ready") return st;
  const left = Math.max(3000, budgetMs - (Date.now() - t0));
  await requestTts(st.url, st.sandboxId, "ok", lang, "", left);
  return st;
}