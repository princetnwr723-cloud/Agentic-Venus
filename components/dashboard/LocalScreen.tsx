"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, CornerDownLeft, Delete, Loader2 } from "lucide-react";

export const LOCAL_VIEW_PREFIX = "venus-view://";
export const isLocalView = (url: string | null | undefined): url is string => typeof url === "string" && url.startsWith(LOCAL_VIEW_PREFIX);
export const localViewSandbox = (url: string) => url.slice(LOCAL_VIEW_PREFIX.length);

async function call(body: Record<string, unknown>) {
  const res = await fetch("/api/e2b/view", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(d?.error || "Could not read the computer's screen.");
  return d;
}

/**
 * The live screen of a computer that runs on this phone / on the user's PC. It shows a fresh screenshot about every second
 * (one request at a time, paused while the tab is hidden). With "control" on, a tap on the picture clicks there, and the small
 * bar underneath types text and presses keys.
 */
export default function LocalScreen({
  apiKey, url, control, className = "",
}: { apiKey: string; url: string; control: boolean; className?: string }) {
  const sandboxId = localViewSandbox(url);
  const [shot, setShot] = useState<{ src: string; w: number; h: number } | null>(null);
  const [err, setErr] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const img = useRef<HTMLImageElement>(null);
  const nudge = useRef<() => void>(() => {});

  useEffect(() => {
    let dead = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let fails = 0;
    const loop = async () => {
      if (dead) return;
      if (typeof document !== "undefined" && document.hidden) { timer = setTimeout(loop, 1500); return; }
      try {
        const d = await call({ apiKey, sandboxId });
        if (dead) return;
        fails = 0;
        setErr("");
        setShot({ src: `data:${d.mediaType || "image/png"};base64,${d.data}`, w: Number(d.width) || 1280, h: Number(d.height) || 720 });
        timer = setTimeout(loop, 900);
      } catch (e) {
        if (dead) return;
        fails += 1;
        setErr(e instanceof Error ? e.message : "Could not read the screen.");
        timer = setTimeout(loop, Math.min(8000, 1500 + fails * 1500)); // keep trying: the phone may just be waking up
      }
    };
    nudge.current = () => { if (timer) clearTimeout(timer); void loop(); };
    void loop();
    return () => { dead = true; if (timer) clearTimeout(timer); };
  }, [apiKey, sandboxId]);

  async function send(body: Record<string, unknown>) {
    setBusy(true);
    try { await call({ apiKey, sandboxId, action: "input", ...body }); setErr(""); }
    catch (e) { setErr(e instanceof Error ? e.message : "That did not work."); }
    finally { setBusy(false); nudge.current(); }
  }

  function tap(e: React.MouseEvent<HTMLImageElement>) {
    if (!control || !shot || !img.current) return;
    const r = img.current.getBoundingClientRect();
    const x = Math.round(((e.clientX - r.left) / r.width) * shot.w);
    const y = Math.round(((e.clientY - r.top) / r.height) * shot.h);
    void send({ type: "click", x, y });
  }

  const keyBtn = "flex items-center gap-1 rounded-md border border-line px-2.5 py-1.5 text-xs text-ink hover:bg-panel2 disabled:opacity-40";

  return (
    <div className={`flex h-full w-full flex-col bg-black ${className}`}>
      <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden">
        {shot ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            ref={img} src={shot.src} alt="Computer screen" onClick={tap} draggable={false}
            className={`max-h-full max-w-full select-none object-contain ${control ? "cursor-crosshair" : ""}`}
          />
        ) : (
          <div className="flex flex-col items-center gap-2 px-6 text-center text-xs text-white/70">
            <Loader2 size={20} className="animate-spin" />
            {err || "Opening the computer… the first picture can take a few seconds while it starts."}
          </div>
        )}
        {shot && err && <div className="absolute inset-x-2 bottom-2 rounded-md bg-black/70 px-3 py-1.5 text-center text-[11px] text-amber-300">{err}</div>}
      </div>

      {control && (
        <div className="space-y-2 border-t border-white/10 bg-panel p-2">
          <form onSubmit={(e) => { e.preventDefault(); const t = text; if (!t) return; setText(""); void send({ type: "type", text: t }); }} className="flex gap-2">
            <input
              value={text} onChange={(e) => setText(e.target.value)} placeholder="Type on the computer…" autoComplete="off"
              className="min-w-0 flex-1 rounded-md border border-line bg-bg px-3 py-1.5 text-sm text-ink placeholder:text-faint focus:border-gold focus:outline-none"
            />
            <button type="submit" disabled={busy || !text} className="rounded-md bg-white px-3 text-xs font-medium text-bg disabled:opacity-40">Type</button>
          </form>
          <div className="flex flex-wrap gap-1.5">
            <button type="button" disabled={busy} onClick={() => void send({ type: "key", keys: "Return" })} className={keyBtn}><CornerDownLeft size={12} /> Enter</button>
            <button type="button" disabled={busy} onClick={() => void send({ type: "key", keys: "BackSpace" })} className={keyBtn}><Delete size={12} /> Back</button>
            <button type="button" disabled={busy} onClick={() => void send({ type: "key", keys: "Tab" })} className={keyBtn}>Tab</button>
            <button type="button" disabled={busy} onClick={() => void send({ type: "key", keys: "Escape" })} className={keyBtn}>Esc</button>
            <button type="button" disabled={busy} onClick={() => void send({ type: "scroll", direction: "up", amount: 5 })} className={keyBtn}><ArrowUp size={12} /> Up</button>
            <button type="button" disabled={busy} onClick={() => void send({ type: "scroll", direction: "down", amount: 5 })} className={keyBtn}><ArrowDown size={12} /> Down</button>
          </div>
        </div>
      )}
    </div>
  );
}
