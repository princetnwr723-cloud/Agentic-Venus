"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, Cpu, Download, HardDrive, Loader2, Monitor, Play, Square, Trash2 } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { isNativeApp } from "@/lib/native";
import {
  computerCancelSetup, computerReset, computerSetEnabled, computerSetLimits, computerSetup, computerStart, computerStatus, computerStop,
  isSettingUp, pct, ramNote, sizeText, stateTitle, subscribeComputer, type ComputerStatus,
} from "@/lib/native-computer";

const shell = "mx-auto min-h-screen max-w-md bg-bg px-4 pb-[calc(var(--sab)+28px)] pt-[calc(var(--sat)+12px)] text-ink";
const card = "mb-4 rounded-2xl border border-line bg-panel p-4";
const h2 = "mb-1 text-[15px] font-semibold";
const small = "text-[13px] leading-snug text-muted";

function Bar({ value, warn }: { value: number; warn?: boolean }) {
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-panel2">
      <div className={`h-full rounded-full ${warn ? "bg-red-400" : "bg-gold"}`} style={{ width: `${value}%` }} />
    </div>
  );
}

function Chips({ options, value, label, recommended, onPick, disabled }: { options: number[]; value: number; label: (n: number) => string; recommended: number; onPick: (n: number) => void; disabled?: boolean }) {
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {options.map((o) => (
        <button
          key={o}
          disabled={disabled}
          onClick={() => onPick(o)}
          className={`press rounded-full border px-3.5 py-1.5 text-[13px] disabled:opacity-50 ${o === value ? "border-gold bg-goldSoft font-medium text-ink" : "border-line text-muted"}`}
        >
          {label(o)}{o === recommended ? " ★" : ""}
        </button>
      ))}
    </div>
  );
}

/** The computer on this phone: a small Linux with Chrome and a terminal. Set it up once; it uses RAM only while a task runs. */
export default function PhoneComputer() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [s, setS] = useState<ComputerStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  const refresh = useCallback(() => computerStatus().then(setS).catch(() => undefined), []);

  useEffect(() => {
    if (!loading && !user) router.replace(isNativeApp() ? "/app-login" : "/");
  }, [user, loading, router]);

  useEffect(() => {
    void refresh();
    const id = window.setInterval(refresh, 3000);
    const off = subscribeComputer(setS);
    const onVis = () => { if (document.visibilityState === "visible") void refresh(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { window.clearInterval(id); off(); document.removeEventListener("visibilitychange", onVis); };
  }, [refresh]);

  const act = async (f: () => Promise<ComputerStatus>) => {
    setBusy(true);
    try { setS(await f()); } finally { setBusy(false); }
  };

  const header = (
    <header className="mb-5 flex items-center gap-2">
      <button onClick={() => router.push("/m")} aria-label="Back" className="press flex h-10 w-10 items-center justify-center rounded-full bg-panel2"><ChevronLeft size={20} /></button>
      <h1 className="text-[20px] font-semibold">Phone computer</h1>
    </header>
  );

  if (!s) return <main className={shell}>{header}<p className="py-10 text-center text-sm text-muted">Loading…</p></main>;

  if (s.unavailable) {
    return (
      <main className={shell}>
        {header}
        <section className={`${card} ${small}`}>
          <p className="mb-2 text-[15px] font-semibold text-ink">Only in the Android app.</p>
          The phone computer needs the newest AgenticVenus Android app. Build the newest APK on GitHub (Actions, Android APK, Run workflow), install it over this one and open this screen again. On the website and on iPhone your computer runs in the cloud as before.
        </section>
      </main>
    );
  }

  if (s.state === "unsupported" || !s.supported) {
    return (
      <main className={shell}>
        {header}
        <section className={`${card} ${small}`}>
          <p className="mb-2 text-[15px] font-semibold text-ink">{stateTitle("unsupported")}</p>
          {s.reason || "This phone cannot run the computer."} Your tasks keep running in the cloud computer.
        </section>
      </main>
    );
  }

  const setting = isSettingUp(s.state);
  const picked = s.ramLimitMB;
  const note = ramNote(s, picked);
  const noteColor = note.kind === "ok" ? "text-emerald-300" : note.kind === "warn" ? "text-gold" : "text-red-300";
  const ramPct = pct(s.usedRamMB, s.ramLimitMB);
  const diskPct = pct(s.usedDiskMB, s.diskLimitGB * 1024);

  return (
    <main className={shell}>
      {header}

      {/* what it is + state */}
      <section className={card}>
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-panel2"><Monitor size={20} /></span>
          <div className="min-w-0">
            <p className="text-[15px] font-semibold">{stateTitle(s.state)}</p>
            <p className={small}>{s.detail || "A small Linux with Chrome and a terminal, nothing else."}</p>
          </div>
        </div>

        {setting && (
          <div className="mt-3">
            <Bar value={Math.max(3, s.percent)} />
            <button disabled={busy} onClick={() => void act(computerCancelSetup)} className="press mt-3 w-full rounded-2xl border border-line py-2.5 text-[14px] disabled:opacity-60">Cancel</button>
          </div>
        )}

        {!s.installed && !setting && (
          <div className="mt-3">
            <button disabled={busy} onClick={() => void act(() => computerSetup(false))} className="press flex w-full items-center justify-center gap-2 rounded-2xl bg-ink py-3 text-[15px] font-medium text-bg disabled:opacity-60">
              {busy ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
              {s.state === "error" ? "Try again" : "Set up now"}
            </button>
            <p className={`mt-2 ${small}`}>One time, about 250 MB download and 1.5 GB on the phone. {s.metered ? "You are on mobile data: Wi-Fi is better." : "You are on Wi-Fi."}</p>
          </div>
        )}

        {s.installed && (
          <div className="mt-3 grid grid-cols-2 gap-2.5">
            {s.running || s.state === "starting" ? (
              <button disabled={busy || s.state === "stopping"} onClick={() => void act(computerStop)} className="press col-span-2 flex items-center justify-center gap-2 rounded-2xl border border-line py-3 text-[14px] font-medium disabled:opacity-60"><Square size={15} />Stop now and give the RAM back</button>
            ) : (
              <button disabled={busy} onClick={() => void act(computerStart)} className="press col-span-2 flex items-center justify-center gap-2 rounded-2xl border border-line py-3 text-[14px] font-medium disabled:opacity-60">
                {busy ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />}Start it now (test)
              </button>
            )}
          </div>
        )}
      </section>

      {/* live use */}
      {s.running && (
        <section className={card}>
          <h2 className={h2}>Using right now</h2>
          <div className="mt-2 space-y-3">
            <div>
              <div className="mb-1 flex justify-between text-[13px]"><span className="flex items-center gap-1.5"><Cpu size={14} />RAM</span><span className="text-muted">{sizeText(s.usedRamMB)} of {sizeText(s.ramLimitMB)}</span></div>
              <Bar value={ramPct} warn={ramPct > 90} />
            </div>
            <div>
              <div className="mb-1 flex justify-between text-[13px]"><span className="flex items-center gap-1.5"><HardDrive size={14} />Storage</span><span className="text-muted">{s.usedDiskMB >= 0 ? sizeText(s.usedDiskMB) : "…"} of {s.diskLimitGB} GB</span></div>
              <Bar value={diskPct} warn={diskPct > 90} />
            </div>
          </div>
          {s.ramWarned && <p className="mt-3 text-[13px] text-gold">The RAM limit was reached: Chrome was closed to stay inside it. You can allow more RAM below.</p>}
        </section>
      )}

      {/* the choices */}
      <section className={card}>
        <h2 className={h2}>RAM for the computer</h2>
        <p className={small}>This phone has {sizeText(s.phoneRamMB)} RAM ({sizeText(s.phoneFreeRamMB)} free now). The computer takes RAM <b>only while a task runs</b>. A few minutes after the last task it stops completely and the RAM is yours again. ★ is what we recommend.</p>
        <Chips options={s.plan.ramOptionsMB} value={picked} label={sizeText} recommended={s.plan.ramRecommendedMB} disabled={busy} onPick={(n) => void act(() => computerSetLimits({ ramMB: n }))} />
        <p className={`mt-2 text-[12.5px] ${noteColor}`}>{note.text}</p>
        {s.running && <p className={`mt-1 ${small}`}>A new RAM limit applies the next time the computer starts.</p>}

        <h2 className={`${h2} mt-5`}>Storage for the computer</h2>
        <p className={small}>This phone has {sizeText(s.freeStorageMB)} free. The computer can grow up to the size you choose; when it is full, new tasks are refused until you allow more or reset it.</p>
        <Chips options={s.plan.diskOptionsGB} value={s.diskLimitGB} label={(n) => `${n} GB`} recommended={s.plan.diskRecommendedGB} disabled={busy} onPick={(n) => void act(() => computerSetLimits({ diskGB: n }))} />
        {s.diskFull && <p className="mt-2 text-[13px] text-red-300">Storage is full. Choose a bigger size or reset the computer.</p>}

        <h2 className={`${h2} mt-5`}>Stop by itself after</h2>
        <Chips options={[1, 3, 5, 10, 30]} value={s.idleMinutes} label={(n) => `${n} min`} recommended={3} disabled={busy} onPick={(n) => void act(() => computerSetLimits({ idleMinutes: n }))} />
        <p className={`mt-2 ${small}`}>Time with no task before the computer shuts down. Starting it again takes a few seconds.</p>
      </section>

      {s.installed && (
        <section className={card}>
          <label className="flex items-start gap-3">
            <input type="checkbox" className="mt-1 h-4 w-4" checked={s.enabled} disabled={busy} onChange={(e) => void act(() => computerSetEnabled(e.target.checked))} />
            <span>
              <span className="block text-[15px] font-medium">Use this phone&apos;s computer for my tasks</span>
              <span className={`mt-0.5 block ${small}`}>On: computer tasks run here, on your phone, for free. Off: they run in your cloud computer as before. Works while the app is open or a task is running.</span>
            </span>
          </label>
        </section>
      )}

      {s.state === "error" && s.log && (
        <details className={`${card} ${small}`}>
          <summary className="cursor-pointer text-[13px] font-medium text-ink">Details for debugging</summary>
          <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-words text-[11.5px] text-muted">{s.log}</pre>
        </details>
      )}

      {s.installed && (
        <div className="mt-2">
          {!confirmReset ? (
            <button onClick={() => setConfirmReset(true)} className="press flex w-full items-center justify-center gap-2 rounded-2xl border border-line py-3 text-[14px] text-muted"><Trash2 size={15} />Reset computer (delete everything in it)</button>
          ) : (
            <div className="rounded-2xl border border-red-400/50 p-3.5">
              <p className="mb-3 text-[13.5px]">This deletes the computer with all its files and frees the storage. You can set it up again later.</p>
              <div className="grid grid-cols-2 gap-2.5">
                <button onClick={() => setConfirmReset(false)} className="press rounded-xl border border-line py-2.5 text-[14px]">Keep it</button>
                <button disabled={busy} onClick={() => { setConfirmReset(false); void act(computerReset); }} className="press rounded-xl bg-red-500 py-2.5 text-[14px] font-medium text-white disabled:opacity-60">Delete</button>
              </div>
            </div>
          )}
        </div>
      )}
    </main>
  );
}
