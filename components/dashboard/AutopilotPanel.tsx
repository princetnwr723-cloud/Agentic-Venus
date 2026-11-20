"use client";

// One floating panel for the three "team teammate" features:
//   Proposals  - what the agent noticed (deadlines, meetings, failed routines) and wants to prepare; you say yes or no
//   Meetings   - the notetaker: auto-join for your calendar meetings, what is coming up, send it into a call, read the notes
//   Workspace  - share the agent with your team: invite people, set roles, link their Slack
import { useCallback, useEffect, useState } from "react";
import { Bell, CalendarClock, Check, Loader2, Users, Video, X } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { getActiveChat } from "@/lib/avatar-activity";

type Proposal = { id: string; title: string; why: string; urgency: string; status: string; source: string };
type Settings = { enabled: boolean; dailyCap: number; quietStart: number; quietEnd: number };
type Meeting = { botId: string; platform: string; status: string; title?: string; note?: string; durationSec?: number; notes?: { summary: string; items?: unknown[] } };
type Upcoming = { eventId: string; title: string; platform: string; startMs: number; endMs: number; state: "will_join" | "joined" | "skipped" | "private" | "off"; skip?: string };
type Auto = { enabled: boolean; skipWords: string[] };
type Org = { id: string; name: string; members: Array<{ uid: string; name: string; role: string; slackLinked: boolean }> };
const ROLE_OPTIONS = ["admin", "member", "viewer"];
const PLATFORM: Record<string, string> = { meet: "Google Meet", zoom: "Zoom", teams: "Teams", webex: "Webex" };
const STATUS_LABEL: Record<string, string> = { joining: "joining", waiting: "in the lobby", in_call: "in the call", ended: "ended", processing: "writing notes", done: "notes ready", failed: "failed" };

const countdown = (ms: number) => {
  if (ms <= 30_000) return "now";
  const m = Math.round(ms / 60_000);
  if (m < 60) return `in ${Math.max(1, m)} min`;
  const h = Math.floor(m / 60), r = m % 60;
  return h >= 24 ? `in ${Math.round(h / 24)}d` : `in ${h}h${r ? ` ${String(r).padStart(2, "0")}m` : ""}`;
};
const STATE_LABEL: Record<Upcoming["state"], { text: string; cls: string }> = {
  will_join: { text: "will join", cls: "bg-emerald-500/15 text-emerald-400" },
  joined: { text: "joined", cls: "bg-emerald-500/15 text-emerald-400" },
  skipped: { text: "skipped", cls: "bg-white/10 text-zinc-400" },
  private: { text: "private", cls: "bg-white/10 text-zinc-400" },
  off: { text: "auto-join off", cls: "bg-white/10 text-zinc-400" },
};

export default function AutopilotPanel() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"proposals" | "meetings" | "workspace">("proposals");
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const [settings, setSettings] = useState<Settings | null>(null);
  const [props, setProps] = useState<Proposal[]>([]);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [url, setUrl] = useState("");
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [auto, setAuto] = useState<Auto | null>(null);
  const [skipText, setSkipText] = useState("");
  const [upcoming, setUpcoming] = useState<Upcoming[]>([]);
  const [calConnected, setCalConnected] = useState<boolean | null>(null);
  const [calAgent, setCalAgent] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [orgName, setOrgName] = useState("");
  const [code, setCode] = useState("");
  const [shown, setShown] = useState("");

  const call = useCallback(async (path: string, body: Record<string, unknown>) => {
    if (!user) throw new Error("Sign in first.");
    const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + (await user.getIdToken()) }, body: JSON.stringify({ uid: user.uid, name: user.displayName || (user.email ?? "").split("@")[0], ...(path === "/api/meetings" ? { chatId: getActiveChat() ?? undefined } : {}), ...body }) });
    const d = await res.json().catch(() => ({}));
    if (!res.ok || d.ok === false) throw new Error(d.error || `Request failed (${res.status}).`);
    return d;
  }, [user]);

  const load = useCallback(async () => {
    try {
      const [w, m, o, c] = await Promise.all([call("/api/watchers", { action: "get" }), call("/api/meetings", { action: "list" }), call("/api/orgs", { action: "list" }), call("/api/meetings", { action: "status" })]);
      setSettings(w.settings); setProps(w.proposals); setMeetings(m.meetings); setOrgs(o.orgs); setConfigured(c.configured);
    } catch (e) { setMsg(e instanceof Error ? e.message : "Could not load."); }
  }, [call]);
  useEffect(() => { if (open) void load(); }, [open, load]);

  // the calendar side of the Meetings tab (one Google Calendar call, so only while that tab is open)
  const loadCalendar = useCallback(async () => {
    try {
      const [a, u] = await Promise.all([call("/api/meetings", { action: "auto_get" }), call("/api/meetings", { action: "upcoming" })]);
      setAuto(a.settings as Auto); setSkipText((a.settings as Auto).skipWords.join(", "));
      setUpcoming(u.meetings as Upcoming[]); setCalConnected(Boolean(u.connected)); setCalAgent(typeof u.agentName === "string" ? u.agentName : "");
    } catch (e) { setMsg(e instanceof Error ? e.message : "Could not load the calendar."); }
  }, [call]);
  useEffect(() => {
    if (!open || tab !== "meetings") return;
    void loadCalendar();
    const refresh = window.setInterval(() => void loadCalendar(), 60_000);
    const clock = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => { window.clearInterval(refresh); window.clearInterval(clock); };
  }, [open, tab, loadCalendar]);

  async function run(label: string, fn: () => Promise<unknown>) {
    setBusy(label); setMsg("");
    try { await fn(); await load(); } catch (e) { setMsg(e instanceof Error ? e.message : "Something failed."); } finally { setBusy(""); }
  }
  async function setAutoJoin(patch: Partial<Auto>) {
    setBusy("auto"); setMsg("");
    try {
      const d = await call("/api/meetings", { action: "auto_set", ...patch });
      setAuto(d.settings as Auto); setSkipText((d.settings as Auto).skipWords.join(", "));
      await loadCalendar();
    } catch (e) { setMsg(e instanceof Error ? e.message : "Could not save."); } finally { setBusy(""); }
  }
  if (!user) return null;
  const pending = props.filter((p) => p.status === "pending").length;
  const org = orgs[0];

  return (
    <>
      <button onClick={() => setOpen(true)} className="fixed bottom-4 left-4 z-40 flex items-center gap-2 rounded-full bg-emerald-600 px-3.5 py-2 text-sm font-medium text-white shadow-lg hover:bg-emerald-500" aria-label="Open Autopilot">
        <Bell size={15} /> Autopilot{pending > 0 && <span className="rounded-full bg-white/90 px-1.5 text-xs font-semibold text-emerald-700">{pending}</span>}
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-3 sm:items-center" onClick={() => setOpen(false)}>
          <div className="max-h-[88vh] w-full max-w-xl overflow-y-auto rounded-2xl border border-white/10 bg-zinc-900 p-4 text-sm text-zinc-100 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <div className="flex gap-1">
                {([["proposals", "Proposals", Bell], ["meetings", "Meetings", Video], ["workspace", "Workspace", Users]] as const).map(([id, label, Icon]) => (
                  <button key={id} onClick={() => setTab(id)} className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 ${tab === id ? "bg-white/10" : "text-zinc-400 hover:bg-white/5"}`}><Icon size={14} />{label}</button>
                ))}
              </div>
              <button onClick={() => setOpen(false)} aria-label="Close"><X size={18} /></button>
            </div>
            {msg && <div className="mb-3 rounded-lg bg-red-500/15 px-3 py-2 text-red-200">{msg}</div>}

            {tab === "proposals" && (
              <div className="space-y-3">
                <label className="flex items-center justify-between rounded-lg bg-white/5 px-3 py-2">
                  <span>Watch my mail, calendar, GitHub and routines and suggest what to prepare<br /><span className="text-xs text-zinc-400">Nothing is done until you say yes. Quiet hours {settings?.quietStart ?? 22}:00–{settings?.quietEnd ?? 8}:00, at most {settings?.dailyCap ?? 5} a day.</span></span>
                  <input type="checkbox" checked={Boolean(settings?.enabled)} onChange={(e) => run("settings", () => call("/api/watchers", { action: "set_settings", settings: { enabled: e.target.checked } }))} className="h-5 w-5" />
                </label>
                <button disabled={busy === "scan"} onClick={() => run("scan", async () => { const d = await call("/api/watchers", { action: "scan" }); setMsg(d.sent ? `${d.sent} new proposal(s).` : "Nothing new to suggest right now."); })} className="rounded-lg bg-white/10 px-3 py-1.5 hover:bg-white/15">{busy === "scan" ? <Loader2 size={14} className="inline animate-spin" /> : "Scan now"}</button>
                {props.length === 0 && <p className="text-zinc-400">No proposals yet.</p>}
                {props.map((p) => (
                  <div key={p.id} className="rounded-lg border border-white/10 p-3">
                    <div className="font-medium">{p.urgency === "now" ? "⏰ " : ""}{p.title}</div>
                    <div className="text-zinc-400">{p.why}</div>
                    {p.status === "pending" ? (
                      <div className="mt-2 flex gap-2">
                        <button onClick={() => run(p.id, async () => { const d = await call("/api/watchers", { action: "decide", id: p.id, approve: true }); setMsg(d.message); })} className="flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1 hover:bg-emerald-500"><Check size={14} /> Prepare it</button>
                        <button onClick={() => run(p.id, () => call("/api/watchers", { action: "decide", id: p.id, approve: false }))} className="rounded-lg bg-white/10 px-3 py-1 hover:bg-white/15">Skip</button>
                      </div>
                    ) : <div className="mt-1 text-xs text-zinc-500">{p.status}</div>}
                  </div>
                ))}
              </div>
            )}

            {tab === "meetings" && (
              <div className="space-y-3">
                {configured === false && <div className="rounded-lg bg-amber-500/15 px-3 py-2 text-amber-100">The meeting bot is not set up on this server yet (add MEETINGBAAS_API_KEY and redeploy).</div>}

                <div className="rounded-lg bg-white/5 px-3 py-2">
                  <label className="flex items-center justify-between gap-3">
                    <span>Join my calendar meetings by itself<br /><span className="text-xs text-zinc-400">A few minutes before each Google Meet, Zoom or Teams meeting in your Google Calendar. Everyone sees “{calAgent || "your agent"} (notetaker)” in the call.</span></span>
                    <input type="checkbox" disabled={busy === "auto"} checked={Boolean(auto?.enabled)} onChange={(e) => void setAutoJoin({ enabled: e.target.checked })} className="h-5 w-5" />
                  </label>
                  <div className="mt-2 flex items-center gap-2 text-xs text-zinc-400">
                    <span className="shrink-0">Skip titles with</span>
                    <input value={skipText} onChange={(e) => setSkipText(e.target.value)} onBlur={() => { const words = skipText.split(",").map((w) => w.trim()).filter(Boolean); void setAutoJoin({ skipWords: words }); }} placeholder="private, personal" className="min-w-0 flex-1 rounded-md border border-white/10 bg-black/30 px-2 py-1 text-zinc-100" />
                  </div>
                  {calAgent && calConnected !== false && <p className="mt-2 text-xs text-zinc-400">Using this chat’s agent: {calAgent}. To use another one, open that chat and switch this on there.</p>}
                  {calConnected === false && <p className="mt-2 text-xs text-amber-200">Google Calendar is not connected to {calAgent ? `“${calAgent}”` : "this agent"} yet. Connect it in Connectors of this chat, then the meetings show up here.</p>}
                </div>

                <div>
                  <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-zinc-400"><CalendarClock size={13} /> Coming up</p>
                  {calConnected !== false && upcoming.length === 0 && <p className="text-zinc-400">No video meetings in the next 24 hours.</p>}
                  <div className="space-y-1.5">
                    {upcoming.map((u) => {
                      const st = STATE_LABEL[u.state];
                      const ongoing = u.startMs <= now;
                      return (
                        <div key={u.eventId + u.startMs} className="flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2">
                          <div className="min-w-0 flex-1">
                            <div className="truncate font-medium">{u.title}</div>
                            <div className="text-xs text-zinc-400">{PLATFORM[u.platform] || u.platform} · {ongoing ? "started" : countdown(u.startMs - now)} · {new Date(u.startMs).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div>
                          </div>
                          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] ${st.cls}`}>{st.text}</span>
                          {(u.state === "will_join" || u.state === "off") && <button disabled={busy === "skip"} onClick={() => run("skip", async () => { await call("/api/meetings", { action: "skip", eventId: u.eventId, startMs: u.startMs, skip: true }); await loadCalendar(); })} className="shrink-0 rounded-lg bg-white/10 px-2 py-1 text-xs hover:bg-white/15">Skip</button>}
                          {u.state === "skipped" && <button disabled={busy === "skip"} onClick={() => run("skip", async () => { await call("/api/meetings", { action: "skip", eventId: u.eventId, startMs: u.startMs, skip: false }); await loadCalendar(); })} className="shrink-0 rounded-lg bg-white/10 px-2 py-1 text-xs hover:bg-white/15">Undo</button>}
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="flex gap-2">
                  <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Or paste a Zoom, Google Meet or Teams link" className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/30 px-3 py-2" />
                  <button disabled={!url.trim() || busy === "join"} onClick={() => run("join", async () => { await call("/api/meetings", { action: "join", url: url.trim() }); setUrl(""); setMsg("The notetaker is joining. Admit it from the waiting room if there is one."); })} className="rounded-lg bg-emerald-600 px-3 py-2 hover:bg-emerald-500 disabled:opacity-50">{busy === "join" ? <Loader2 size={14} className="animate-spin" /> : "Send bot"}</button>
                </div>

                {meetings.length === 0 && <p className="text-zinc-400">No meetings yet.</p>}
                {meetings.map((m) => (
                  <div key={m.botId} className="rounded-lg border border-white/10 p-3">
                    <div className="font-medium">{m.title || `${PLATFORM[m.platform] || m.platform} meeting`} <span className="text-xs text-zinc-400">· {STATUS_LABEL[m.status] || m.status}{m.durationSec ? ` · ${Math.max(1, Math.round(m.durationSec / 60))} min` : ""}{m.notes?.items ? ` · ${m.notes.items.length} action items` : ""}</span></div>
                    {m.notes?.summary && <div className="mt-1 text-zinc-300">{m.notes.summary}</div>}
                    {m.note && <div className="mt-1 text-xs text-amber-200">{m.note}</div>}
                    {(m.status === "joining" || m.status === "waiting" || m.status === "in_call") && <button disabled={busy === m.botId} onClick={() => run(m.botId, async () => { await call("/api/meetings", { action: "leave", botId: m.botId }); setMsg("The notetaker was asked to leave. The notes follow in the chat."); })} className="mt-2 rounded-lg bg-white/10 px-3 py-1 text-xs hover:bg-white/15">{busy === m.botId ? <Loader2 size={12} className="inline animate-spin" /> : "Leave meeting"}</button>}
                  </div>
                ))}
              </div>
            )}

            {tab === "workspace" && (
              <div className="space-y-3">
                {!org ? (
                  <>
                    <p className="text-zinc-400">Share your agent with your team. Members talk to it in Slack with their own identity and role.</p>
                    <div className="flex gap-2">
                      <input value={orgName} onChange={(e) => setOrgName(e.target.value)} placeholder="Workspace name" className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/30 px-3 py-2" />
                      <button onClick={() => run("create", () => call("/api/orgs", { action: "create", orgName: orgName || "Team" }))} className="rounded-lg bg-emerald-600 px-3 py-2 hover:bg-emerald-500">Create</button>
                    </div>
                    <div className="flex gap-2">
                      <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Have an invite code?" className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/30 px-3 py-2" />
                      <button disabled={!code.trim()} onClick={() => run("join", async () => { await call("/api/orgs", { action: "join", code }); setCode(""); })} className="rounded-lg bg-white/10 px-3 py-2 hover:bg-white/15">Join</button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="font-medium">{org.name}</div>
                    {org.members.map((m) => (
                      <div key={m.uid} className="flex items-center justify-between rounded-lg bg-white/5 px-3 py-2">
                        <span>{m.name} <span className="text-xs text-zinc-400">· {m.role}{m.slackLinked ? " · Slack ✓" : ""}</span></span>
                        {m.role !== "owner" && m.uid !== user.uid && (
                          <span className="flex gap-1">
                            <select value={m.role} onChange={(e) => run(m.uid, () => call("/api/orgs", { action: "set_role", orgId: org.id, targetUid: m.uid, role: e.target.value }))} className="rounded bg-black/40 px-1 py-0.5">{ROLE_OPTIONS.map((r) => <option key={r}>{r}</option>)}</select>
                            <button onClick={() => run(m.uid, () => call("/api/orgs", { action: "remove", orgId: org.id, targetUid: m.uid }))} className="rounded bg-white/10 px-2">Remove</button>
                          </span>
                        )}
                      </div>
                    ))}
                    <div className="flex flex-wrap gap-2">
                      {ROLE_OPTIONS.map((r) => <button key={r} onClick={() => run("invite", async () => { const d = await call("/api/orgs", { action: "invite", orgId: org.id, role: r }); setShown(`Invite code for a ${r} (valid 3 days, one use): ${d.code}`); })} className="rounded-lg bg-white/10 px-3 py-1.5 hover:bg-white/15">Invite {r}</button>)}
                      <button onClick={() => run("link", async () => { const d = await call("/api/orgs", { action: "slack_link_code", orgId: org.id }); setShown(`Send this to the Slack bot in a direct message within 15 minutes: link ${d.code}`); })} className="rounded-lg bg-white/10 px-3 py-1.5 hover:bg-white/15">Link my Slack</button>
                    </div>
                    {shown && <div className="rounded-lg bg-emerald-500/15 px-3 py-2 text-emerald-100 select-all">{shown}</div>}
                    <p className="text-xs text-zinc-500">Members reach the shared agent through Slack. Viewers can ask and read; members can approve ordinary actions; money, secrets and confidential content need an admin or the owner.</p>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
