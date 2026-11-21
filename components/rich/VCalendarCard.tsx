"use client";

// Chat card for a ```vcal block (made by the calendar.show tool and by the agent's morning plan): month or week strip with a dot on every
// busy day, tap a day to see it, and the agenda with the notetaker's status for each meeting. The block is plain JSON; every field is
// checked here before it is shown, and links only open when they are https.
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, ExternalLink, Video } from "lucide-react";

type State = "live" | "notes" | "joined" | "will_join" | "skipped";
type Ev = { id: string; title: string; start: number; end: number; allDay?: boolean; platform?: string; url?: string; who: string[]; place?: string; state?: State };
type Spec = { title: string; tz: string; today: string; from: string; to: string; summary: string; days: Array<{ date: string; events: Ev[] }> };

const str = (v: unknown, n = 120) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const STATES: State[] = ["live", "notes", "joined", "will_join", "skipped"];
const PLATFORM: Record<string, string> = { meet: "Meet", zoom: "Zoom", teams: "Teams", webex: "Webex" };
const PILL: Record<State, { text: string; cls: string }> = {
  live: { text: "in the call", cls: "bg-red-500/15 text-red-400" },
  notes: { text: "notes ready", cls: "bg-emerald-500/15 text-emerald-400" },
  joined: { text: "joined", cls: "bg-emerald-500/15 text-emerald-400" },
  will_join: { text: "will join", cls: "bg-goldSoft text-gold" },
  skipped: { text: "skipped", cls: "bg-panel2 text-faint" },
};
const https = (v: unknown) => { try { const u = new URL(str(v, 400)); return u.protocol === "https:" ? u.toString() : undefined; } catch { return undefined; } };

export function normCal(raw: any): Spec | null {
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.days) || !YMD.test(str(raw.today, 10))) return null;
  try { new Intl.DateTimeFormat("en-GB", { timeZone: str(raw.tz, 60) || "UTC" }); } catch { return null; }
  const days = raw.days.slice(0, 62).filter((d: any) => d && YMD.test(str(d.date, 10))).map((d: any) => ({
    date: str(d.date, 10),
    events: (Array.isArray(d.events) ? d.events : []).slice(0, 40).filter((e: any) => e && str(e.title) && Number.isFinite(Number(e.start)) && Number.isFinite(Number(e.end))).map((e: any): Ev => ({
      id: str(e.id, 80), title: str(e.title, 120), start: Number(e.start), end: Number(e.end), allDay: e.allDay === true, platform: PLATFORM[str(e.platform, 10)] ? str(e.platform, 10) : undefined,
      url: https(e.url), who: (Array.isArray(e.who) ? e.who : []).slice(0, 4).map((w: unknown) => str(w, 40)).filter(Boolean), place: str(e.place, 60) || undefined,
      state: STATES.includes(e.state) ? e.state : undefined,
    })),
  }));
  return days.length ? { title: str(raw.title, 60) || "Calendar", tz: str(raw.tz, 60) || "UTC", today: str(raw.today, 10), from: str(raw.from, 10), to: str(raw.to, 10), summary: str(raw.summary, 80), days } : null;
}

const addDays = (ymd: string, n: number) => { const [y, m, d] = ymd.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
const weekday = (ymd: string) => { const [y, m, d] = ymd.split("-").map(Number); return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7; }; // Monday = 0
const monthName = (ymd: string) => new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", month: "long", year: "numeric" }).format(new Date(ymd + "T00:00:00Z"));
const dayLong = (ymd: string) => new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "long", day: "numeric", month: "short" }).format(new Date(ymd + "T00:00:00Z"));
const WEEK = ["M", "T", "W", "T", "F", "S", "S"];
const countdown = (ms: number) => { const m = Math.round(ms / 60_000); return m < 1 ? "now" : m < 60 ? `in ${m} min` : m < 1440 ? `in ${Math.floor(m / 60)}h${m % 60 ? ` ${String(m % 60).padStart(2, "0")}m` : ""}` : `in ${Math.round(m / 1440)}d`; };

export default function VCalendarCard({ code, fallback }: { code: string; fallback: ReactNode }) {
  const spec = useMemo(() => { try { return normCal(JSON.parse(code)); } catch { return null; } }, [code]);
  const [now, setNow] = useState(() => Date.now());
  const [picked, setPicked] = useState<string | null>(null);
  const [month, setMonth] = useState<string | null>(null);
  useEffect(() => { const t = window.setInterval(() => setNow(Date.now()), 30_000); return () => window.clearInterval(t); }, []);
  if (!spec) return <>{fallback}</>;

  const byDay = new Map(spec.days.map((d) => [d.date, d.events]));
  const fmt = new Intl.DateTimeFormat("en-GB", { timeZone: spec.tz, hour: "2-digit", minute: "2-digit", hour12: false });
  const time = (e: Ev) => (e.allDay ? "All day" : `${fmt.format(new Date(e.start))}–${fmt.format(new Date(e.end))}`);
  const all = spec.days.flatMap((d) => d.events).filter((e) => !e.allDay);
  const current = all.find((e) => e.start <= now && e.end > now);
  const next = current ? undefined : all.filter((e) => e.start > now).sort((a, b) => a.start - b.start)[0];

  // a week strip for a short range, a month grid for a longer one
  const strip = spec.days.length <= 7;
  const anchor = month ?? (spec.days.find((d) => d.date >= spec.today)?.date ?? spec.days[0].date).slice(0, 7) + "-01";
  const cells: Array<{ date: string; inMonth: boolean }> = [];
  if (strip) spec.days.forEach((d) => cells.push({ date: d.date, inMonth: true }));
  else {
    const start = addDays(anchor, -weekday(anchor));
    for (let i = 0; i < 42; i++) { const date = addDays(start, i); cells.push({ date, inMonth: date.slice(0, 7) === anchor.slice(0, 7) }); }
    while (cells.length > 35 && cells.slice(-7).every((c) => !c.inMonth)) cells.splice(-7, 7);
  }
  const shift = (n: number) => { const [y, m] = anchor.split("-").map(Number); setMonth(new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 10)); };
  const shown = picked ? spec.days.filter((d) => d.date === picked) : spec.days.filter((d) => d.events.length).slice(0, 10);

  return (
    <div className="my-2 overflow-hidden rounded-xl border border-line bg-bg text-ink">
      <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2">
        <div className="flex min-w-0 items-center gap-2"><CalendarDays size={15} className="shrink-0 text-gold" aria-hidden="true" /><span className="truncate text-sm font-medium">{spec.title}</span></div>
        <span className="shrink-0 text-[11px] text-faint">{spec.summary}</span>
      </div>

      {(current || next) && (
        <div className="flex items-center gap-2 border-b border-line bg-goldSoft px-3 py-1.5 text-xs">
          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${current ? "animate-pulse bg-red-500" : "bg-gold"}`} />
          <span className="truncate"><b>{current ? "Now" : "Next"}:</b> {(current ?? next)!.title} <span className="text-muted">{current ? `until ${fmt.format(new Date(current.end))}` : countdown(next!.start - now)}</span></span>
        </div>
      )}

      <div className="px-3 pt-2.5">
        {!strip && (
          <div className="mb-1.5 flex items-center justify-between">
            <button type="button" onClick={() => shift(-1)} aria-label="Previous month" className="rounded p-1 text-muted hover:text-ink"><ChevronLeft size={14} /></button>
            <span className="text-xs font-medium">{monthName(anchor)}</span>
            <button type="button" onClick={() => shift(1)} aria-label="Next month" className="rounded p-1 text-muted hover:text-ink"><ChevronRight size={14} /></button>
          </div>
        )}
        <div className="grid grid-cols-7 gap-1 text-center">
          {WEEK.map((w, i) => <span key={i} className="pb-0.5 text-[10px] text-faint">{w}</span>)}
          {strip && Array.from({ length: weekday(cells[0].date) }, (_, i) => <span key={`pad${i}`} />)}
          {cells.map((c) => {
            const evs = byDay.get(c.date) ?? [], isToday = c.date === spec.today, sel = picked === c.date;
            return (
              <button key={c.date} type="button" onClick={() => setPicked(sel ? null : c.date)} aria-pressed={sel} aria-label={dayLong(c.date)}
                className={`flex h-9 flex-col items-center justify-center rounded-lg text-xs transition-colors ${sel ? "bg-gold text-bg" : isToday ? "ring-1 ring-gold" : "hover:bg-panel2"} ${c.inMonth ? "" : "opacity-30"}`}>
                <span>{Number(c.date.slice(8))}</span>
                <span className="mt-0.5 flex h-1 gap-0.5">{evs.slice(0, 3).map((e, i) => <span key={i} className={`h-1 w-1 rounded-full ${sel ? "bg-bg" : e.state === "notes" ? "bg-emerald-400" : "bg-gold"}`} />)}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="space-y-2.5 px-3 py-2.5">
        {shown.length === 0 && <p className="text-xs text-muted">{picked ? `Nothing planned on ${dayLong(picked)}.` : "Nothing planned in this time."}</p>}
        {shown.map((d) => (
          <div key={d.date}>
            <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-faint">{dayLong(d.date)}{d.date === spec.today ? " · today" : ""}</p>
            {d.events.length === 0 && <p className="text-xs text-muted">Free day.</p>}
            <div className="space-y-1">
              {d.events.map((e, i) => (
                <div key={e.id + i} className={`flex items-start gap-2 rounded-lg border px-2.5 py-1.5 ${e.start <= now && e.end > now && !e.allDay ? "border-red-400/40 bg-red-500/5" : "border-line bg-panel"}`}>
                  <span className="w-[5.6rem] shrink-0 pt-0.5 font-mono text-[11px] tabular-nums text-muted">{time(e)}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium">{e.title}</p>
                    <p className="truncate text-[11px] text-muted">{[e.who.length ? `with ${e.who.join(", ")}` : "", e.place ?? ""].filter(Boolean).join(" · ")}</p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    {e.state && <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${PILL[e.state].cls}`}>{PILL[e.state].text}</span>}
                    {e.url && <a href={e.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-[10px] text-gold hover:underline"><Video size={10} aria-hidden="true" />{e.platform ? PLATFORM[e.platform] : "Join"}<ExternalLink size={9} aria-hidden="true" /></a>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
        {picked && <button type="button" onClick={() => setPicked(null)} className="text-[11px] text-gold hover:underline">Show everything</button>}
      </div>
    </div>
  );
}
