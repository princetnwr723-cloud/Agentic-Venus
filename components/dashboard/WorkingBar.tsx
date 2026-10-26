"use client";

import { useEffect, useRef, useState } from "react";
import {
  Brain, Check, ChevronDown, Download, Film, GitBranch, Monitor, Pencil,
  Rocket, Search, Sparkles, Terminal, Users, Wrench, Zap,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { beginActivity } from "@/lib/avatar-activity";

const mmss = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
};

const dur = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 1) return "";
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
};

/** Removes every emoji / arrow from a step so only the proper icon shows. */
const clean = (s: string) =>
  s.replace(/\p{Extended_Pictographic}|[\uFE0F\u200D▶▸✓]/gu, "").replace(/\s+/g, " ").trim() || s;

/** Picks a small icon that tells you what kind of step this is. */
function iconFor(text: string): LucideIcon {
  const t = text.toLowerCase();
  if (/🔧|tool|chala raha/.test(t) && !/computer/.test(t)) return Wrench;
  if (/deploy|vercel/.test(t)) return Rocket;
  if (/clone|push|github|repo|commit/.test(t)) return GitBranch;
  if (/venus pro|video|render|scene|clip/.test(t)) return Film;
  if (/team|agent|@|collab|cooperat/.test(t)) return Users;
  if (/download|upload|asset/.test(t)) return Download;
  if (/computer|pc|browser|screen|sandbox|chrome/.test(t)) return Monitor;
  if (/terminal|shell|command|npm|apt|install|run /.test(t)) return Terminal;
  if (/search|dhund|dekh|read|padh|check/.test(t)) return Search;
  if (/samajh|think|plan|intent|understand/.test(t)) return Brain;
  if (/jawab|writ|likh|draft|reply|compos/.test(t)) return Pencil;
  if (/memory|skill|recipe|learn/.test(t)) return Sparkles;
  return Zap;
}

type Entry = { text: string; at: number };

const CSS = `
@keyframes wb-in { from { opacity: 0; transform: translateY(6px) scale(.985); } to { opacity: 1; transform: none; } }
@keyframes wb-step-in { from { opacity: 0; transform: translateX(-6px); } to { opacity: 1; transform: none; } }
@keyframes wb-shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
@keyframes wb-dot { 0%, 80%, 100% { transform: translateY(0); opacity: .35; } 40% { transform: translateY(-3px); opacity: 1; } }
@keyframes wb-slide { 0% { transform: translateX(-120%); } 100% { transform: translateX(380%); } }
@keyframes wb-spin { to { transform: rotate(360deg); } }
@keyframes wb-glow { 0%, 100% { box-shadow: 0 0 0 0 rgba(231,178,77,0); } 50% { box-shadow: 0 0 0 3px rgba(231,178,77,.10); } }
.wb-card { animation: wb-in .28s cubic-bezier(.2,.8,.2,1) both, wb-glow 3.2s ease-in-out infinite; }
.wb-step { animation: wb-step-in .22s ease-out both; }
.wb-shimmer {
  background: linear-gradient(90deg, #8B8A90 0%, #8B8A90 38%, #F1F0EC 50%, #8B8A90 62%, #8B8A90 100%);
  background-size: 200% 100%;
  -webkit-background-clip: text; background-clip: text;
  -webkit-text-fill-color: transparent; color: transparent;
  animation: wb-shimmer 2.4s linear infinite;
}
.wb-dot { animation: wb-dot 1.2s ease-in-out infinite; }
.wb-line { animation: wb-slide 1.8s cubic-bezier(.4,0,.2,1) infinite; }
.wb-spin { animation: wb-spin .9s linear infinite; }
@media (prefers-reduced-motion: reduce) {
  .wb-card, .wb-step, .wb-dot, .wb-line, .wb-spin, .wb-shimmer { animation: none !important; }
  .wb-shimmer { -webkit-text-fill-color: #F1F0EC; color: #F1F0EC; background: none; }
}
`;

/** Shows the moment you send a message: what the agent is doing right now, a live timer, and the full step timeline. */
export default function WorkingBar({ label, startedAt, steps }: { label: string; startedAt: number; steps: string[] }) {
  const [now, setNow] = useState(Date.now());
  const [open, setOpen] = useState(false);
  const [log, setLog] = useState<Entry[]>(() => {
    const list = steps.length ? steps : [label];
    return list.map((text, i) => ({ text, at: i === 0 ? startedAt : Date.now() }));
  });
  const listRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // while this bar is on screen the agent avatars show the "under pressure" look
  useEffect(() => beginActivity(), []);

  // remember when each step started so every row can show how long it took
  useEffect(() => {
    const last = steps.length ? steps[steps.length - 1] : label;
    setLog((l) => (l.length && l[l.length - 1].text === last ? l : [...l.slice(-59), { text: last, at: Date.now() }]));
  }, [steps, label]);

  // keep the newest step in view while the list is open (unless the person scrolled up to read)
  useEffect(() => {
    const el = listRef.current;
    if (open && el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [open, log.length]);

  const current = log[log.length - 1];
  const stepMs = now - (current?.at ?? startedAt);
  const slow = stepMs > 40000;

  return (
    <div className="mx-auto w-full max-w-2xl px-6 pb-2">
      <style>{CSS}</style>
      <div role="status" aria-live="polite" className="wb-card relative overflow-hidden rounded-2xl border border-line bg-panel">
        {/* thin moving line on top: tells you it is alive even when the text does not change */}
        <div className="absolute inset-x-0 top-0 h-px overflow-hidden bg-line/60" aria-hidden="true">
          <div className="wb-line h-full w-1/4 bg-gradient-to-r from-transparent via-gold to-transparent" />
        </div>

        <button
          onClick={() => setOpen((v) => !v)}
          className="group flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-panel2/60"
          aria-expanded={open}
        >
          <span className="flex shrink-0 items-center gap-1" aria-hidden="true">
            <span className="wb-dot h-1.5 w-1.5 rounded-full bg-gold" />
            <span className="wb-dot h-1.5 w-1.5 rounded-full bg-gold" style={{ animationDelay: "160ms" }} />
            <span className="wb-dot h-1.5 w-1.5 rounded-full bg-gold" style={{ animationDelay: "320ms" }} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="wb-shimmer block truncate text-sm font-medium">{clean(label)}</span>
            {slow && <span className="mt-0.5 block truncate text-[11px] text-faint">Yeh step thoda time le raha hai, kaam chal raha hai…</span>}
          </span>
          {log.length > 1 && (
            <span className="hidden shrink-0 rounded-full bg-panel2 px-2 py-0.5 text-[11px] text-muted sm:inline">{log.length} steps</span>
          )}
          <span className="shrink-0 font-mono text-xs tabular-nums text-muted">{mmss(now - startedAt)}</span>
          <ChevronDown size={15} className={`shrink-0 text-faint transition-transform duration-200 group-hover:text-muted ${open ? "rotate-180" : ""}`} />
        </button>

        <div className={`grid transition-[grid-template-rows] duration-300 ease-out ${open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}>
          <div className="min-h-0 overflow-hidden">
            <div
              ref={listRef}
              onScroll={(e) => {
                const el = e.currentTarget;
                stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
              }}
              className="max-h-64 overflow-y-auto border-t border-line px-4 py-3"
            >
              <ol className="relative space-y-0.5">
                {/* the vertical line that joins the steps together */}
                <span className="absolute bottom-3 left-[9px] top-3 w-px bg-line" aria-hidden="true" />
                {log.map((e, i) => {
                  const isLast = i === log.length - 1;
                  const Icon = iconFor(e.text);
                  const took = dur((log[i + 1]?.at ?? now) - e.at);
                  return (
                    <li key={`${e.at}-${i}`} className="wb-step relative flex items-start gap-3 py-1">
                      <span
                        className={`relative z-10 mt-0.5 flex h-[19px] w-[19px] shrink-0 items-center justify-center rounded-full border ${
                          isLast ? "border-gold/60 bg-goldSoft text-gold" : "border-line bg-panel2 text-faint"
                        }`}
                      >
                        {isLast ? (
                          <span className="wb-spin block h-2.5 w-2.5 rounded-full border-[1.5px] border-gold border-t-transparent" />
                        ) : (
                          <Check size={11} strokeWidth={3} className="text-avatar-sage" />
                        )}
                      </span>
                      <span className="flex min-w-0 flex-1 items-start gap-2">
                        <Icon size={13} className={`mt-[3px] shrink-0 ${isLast ? "text-gold" : "text-faint"}`} aria-hidden="true" />
                        <span className={`min-w-0 break-words text-[13px] leading-relaxed ${isLast ? "text-ink" : "text-muted"}`}>{clean(e.text)}</span>
                      </span>
                      {took && <span className="mt-0.5 shrink-0 font-mono text-[11px] tabular-nums text-faint">{took}</span>}
                    </li>
                  );
                })}
              </ol>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
