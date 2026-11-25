"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AlarmClock, BatteryCharging, Bell, Check, ChevronLeft, LogOut, Power, RefreshCw, Smartphone } from "lucide-react";
import { auth } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import { isNativeApp } from "@/lib/native";
import {
  askBatteryUnrestricted, askExactAlarm, openAppSettings, openAutostart, reliability, resyncScheduler, schedulerStatus, setupScheduler, testAlarm,
  type SchedulerStatus,
} from "@/lib/native-scheduler";

const at = (ms: number) => (ms ? new Date(ms).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" }) : "none");
const late = (ms: number) => (ms < 5000 ? "on time" : ms < 60_000 ? `${Math.round(ms / 1000)}s late` : `${Math.round(ms / 60_000)} min late`);

type Row = { key: string; ok: boolean; icon: React.ReactNode; title: string; body: string; action?: { label: string; run: () => Promise<unknown> | void } };

/** Is this phone set up so that routines run on time? One screen to check it, fix it and test it. */
export default function Reliability() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [s, setS] = useState<SchedulerStatus | null>(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => schedulerStatus().then(setS).catch(() => undefined), []);

  useEffect(() => {
    if (!loading && !user) router.replace(isNativeApp() ? "/app-login" : "/");
  }, [user, loading, router]);

  // coming back from a system settings page: look again
  useEffect(() => {
    void refresh();
    const id = window.setInterval(refresh, 4000);
    const onVis = () => { if (document.visibilityState === "visible") void refresh(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { window.clearInterval(id); document.removeEventListener("visibilitychange", onVis); };
  }, [refresh]);

  const header = (
    <header className="mb-5 flex items-center gap-2">
      <button onClick={() => router.push("/m")} aria-label="Back" className="press flex h-10 w-10 items-center justify-center rounded-full bg-panel2"><ChevronLeft size={20} /></button>
      <h1 className="text-[20px] font-semibold">Schedules on this phone</h1>
    </header>
  );
  const shell = "mx-auto min-h-screen max-w-md bg-bg px-4 pb-[calc(var(--sab)+28px)] pt-[calc(var(--sat)+12px)] text-ink";

  if (!s) return <main className={shell}>{header}<p className="py-10 text-center text-sm text-muted">Loading…</p></main>;

  if (s.unavailable) {
    return (
      <main className={shell}>
        {header}
        <section className="rounded-2xl border border-line bg-panel p-4 text-[14px] leading-relaxed text-muted">
          <p className="mb-2 text-[15px] font-semibold text-ink">This app version is too old.</p>
          It does not have the phone scheduler inside yet. Build the newest Android APK on GitHub (Actions, Android APK, Run workflow), install it over this one, and open this screen again.
        </section>
      </main>
    );
  }

  const r = reliability(s);
  const rows: Row[] = [];
  if (s.platform === "android") {
    rows.push(
      { key: "login", ok: s.configured && !s.authLost, icon: <Smartphone size={20} />, title: "Phone is connected", body: s.authLost ? "Your login ended. Sign in again." : "The phone can talk to your account while the app is closed.", action: s.configured && !s.authLost ? undefined : { label: "Connect", run: async () => { await setupScheduler(); await refresh(); } } },
      { key: "exact", ok: s.exactAlarm, icon: <AlarmClock size={20} />, title: "Exact alarms", body: "Lets Android wake the phone at the exact minute. Without it, routines can be minutes late.", action: s.exactAlarm ? undefined : { label: "Allow", run: askExactAlarm } },
      { key: "battery", ok: s.batteryUnrestricted, icon: <BatteryCharging size={20} />, title: "No battery limits", body: "Stops battery saver from putting the app to sleep.", action: s.batteryUnrestricted ? undefined : { label: "Allow", run: askBatteryUnrestricted } },
      { key: "notifications", ok: s.notifications, icon: <Bell size={20} />, title: "Notifications", body: "So you see when a routine runs and when it needs you.", action: s.notifications ? undefined : { label: "Open settings", run: openAppSettings } },
    );
    if (s.needsAutostart) {
      rows.push({ key: "autostart", ok: false, icon: <Power size={20} />, title: `Autostart (${s.manufacturer ?? "your phone"})`, body: "Your phone brand has an extra switch that can stop alarms. Open it and allow AgenticVenus to start and run in the background. Android can not tell us if it is on, so this stays as a reminder.", action: { label: "Open", run: async () => { await openAutostart(); } } });
    }
  }

  const test = async () => {
    setBusy(true); setMsg("Test alarm set. Lock your phone and wait 15 seconds…");
    await testAlarm(15);
    window.setTimeout(() => { setBusy(false); setMsg(""); void refresh(); }, 22_000);
  };
  const sync = async () => { setBusy(true); setMsg("Updating…"); const n = await resyncScheduler(); setMsg(`${n} alarm${n === 1 ? "" : "s"} armed.`); setBusy(false); void refresh(); };

  return (
    <main className={shell}>
      {header}

      {s.platform === "android" ? (
        <>
          <section className="mb-5 flex items-center gap-4 rounded-2xl border border-line bg-panel p-4">
            <div className="relative flex h-16 w-16 shrink-0 items-center justify-center rounded-full" style={{ background: `conic-gradient(rgb(var(--c-gold)) ${r.score * 3.6}deg, rgb(var(--c-line)) 0)` }}>
              <div className="flex h-[52px] w-[52px] items-center justify-center rounded-full bg-panel text-[17px] font-semibold">{r.score}</div>
            </div>
            <div className="min-w-0">
              <p className="text-[15px] font-semibold">{r.score >= 95 ? "Ready. Routines run on time." : r.score >= 60 ? "Almost there." : "Needs setup."}</p>
              <p className="mt-0.5 text-[13px] text-muted">{s.armed} alarm{s.armed === 1 ? "" : "s"} armed · next {at(s.nextAt)}</p>
            </div>
          </section>

          <ul className="space-y-2.5">
            {rows.map((row) => (
              <li key={row.key} className="flex items-start gap-3 rounded-2xl border border-line bg-panel p-3.5">
                <span className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${row.ok ? "bg-emerald-500/10 text-emerald-300" : "bg-panel2 text-muted"}`}>{row.ok ? <Check size={18} /> : row.icon}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-medium">{row.title}</span>
                  <span className="mt-0.5 block text-[13px] leading-snug text-muted">{row.body}</span>
                </span>
                {row.action && <button onClick={() => { void row.action?.run(); }} className="press shrink-0 self-center rounded-full bg-ink px-3.5 py-1.5 text-[13px] font-medium text-bg">{row.action.label}</button>}
              </li>
            ))}
          </ul>

          <div className="mt-4 grid grid-cols-2 gap-2.5">
            <button disabled={busy} onClick={test} className="press rounded-2xl border border-line bg-panel py-3 text-[14px] font-medium disabled:opacity-60">Test alarm (15 s)</button>
            <button disabled={busy} onClick={sync} className="press flex items-center justify-center gap-2 rounded-2xl border border-line bg-panel py-3 text-[14px] font-medium disabled:opacity-60"><RefreshCw size={15} />Update now</button>
          </div>
          {msg && <p className="mt-3 text-center text-[13px] text-muted">{msg}</p>}

          <h2 className="mb-2 mt-7 text-[13px] font-semibold uppercase tracking-wide text-faint">Last alarms</h2>
          {s.log.length === 0 ? (
            <p className="text-[13px] text-muted">Nothing yet. Press “Test alarm” to see it work.</p>
          ) : (
            <ul className="divide-y divide-line/60 rounded-2xl border border-line bg-panel">
              {s.log.slice(0, 8).map((l, i) => (
                <li key={i} className="flex items-center justify-between gap-3 px-3.5 py-2.5 text-[13px]">
                  <span className="min-w-0 truncate">{l.name}</span>
                  <span className="shrink-0 text-muted">{l.status === "ok" || l.status === "started" ? late(l.lateMs) : l.status}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-5 text-[12.5px] leading-relaxed text-faint">If your phone is off or has no internet at the exact time, the cloud scheduler runs the routine a few minutes later, so nothing is lost.</p>
        </>
      ) : (
        <section className="rounded-2xl border border-line bg-panel p-4 text-[14px] leading-relaxed text-muted">
          {s.platform === "ios"
            ? "On iPhone, Apple does not let any app run its own code at an exact time in the background. So the cloud scheduler runs your routines at the exact minute, and this phone gets a notification with the result."
            : "Open the AgenticVenus app on your phone to set up schedules that run on the phone. On the website, routines run in the cloud."}
        </section>
      )}

      <button onClick={() => { void auth.signOut().then(() => router.replace(isNativeApp() ? "/app-login" : "/")); }} className="press mt-8 flex w-full items-center justify-center gap-2 rounded-2xl border border-line py-3 text-[14px] text-muted">
        <LogOut size={16} />Sign out
      </button>
    </main>
  );
}
