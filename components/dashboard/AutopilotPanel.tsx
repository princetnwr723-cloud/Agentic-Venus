"use client";

// One floating panel for the three "team teammate" features:
//   Proposals  - what the agent noticed (deadlines, meetings, failed routines) and wants to prepare; you say yes or no
//   Meetings   - send the notetaker into a Zoom / Meet / Teams call and read the notes
//   Workspace  - share the agent with your team: invite people, set roles, link their Slack
import { useCallback, useEffect, useState } from "react";
import { Bell, Check, Loader2, Users, Video, X } from "lucide-react";
import { useAuth } from "@/lib/auth-context";

type Proposal = { id: string; title: string; why: string; urgency: string; status: string; source: string };
type Settings = { enabled: boolean; dailyCap: number; quietStart: number; quietEnd: number };
type Meeting = { botId: string; platform: string; status: string; title?: string; note?: string; notes?: { summary: string } };
type Org = { id: string; name: string; members: Array<{ uid: string; name: string; role: string; slackLinked: boolean }> };
const ROLE_OPTIONS = ["admin", "member", "viewer"];

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
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [orgName, setOrgName] = useState("");
  const [code, setCode] = useState("");
  const [shown, setShown] = useState("");

  const call = useCallback(async (path: string, body: Record<string, unknown>) => {
    if (!user) throw new Error("Sign in first.");
    const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + (await user.getIdToken()) }, body: JSON.stringify({ uid: user.uid, name: user.displayName || (user.email ?? "").split("@")[0], ...body }) });
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

  async function run(label: string, fn: () => Promise<unknown>) {
    setBusy(label); setMsg("");
    try { await fn(); await load(); } catch (e) { setMsg(e instanceof Error ? e.message : "Something failed."); } finally { setBusy(""); }
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
                {configured === false && <div className="rounded-lg bg-amber-500/15 px-3 py-2 text-amber-100">The meeting bot is not set up on this server yet (RECALL_API_KEY, RECALL_REGION, RECALL_WEBHOOK_SECRET).</div>}
                <div className="flex gap-2">
                  <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Paste a Zoom, Google Meet, Teams or Webex link" className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/30 px-3 py-2" />
                  <button disabled={!url.trim() || busy === "join"} onClick={() => run("join", async () => { await call("/api/meetings", { action: "join", url: url.trim() }); setUrl(""); setMsg("The notetaker is joining. Admit it from the waiting room if there is one."); })} className="rounded-lg bg-emerald-600 px-3 py-2 hover:bg-emerald-500 disabled:opacity-50">{busy === "join" ? <Loader2 size={14} className="animate-spin" /> : "Send bot"}</button>
                </div>
                {meetings.length === 0 && <p className="text-zinc-400">No meetings yet.</p>}
                {meetings.map((m) => (
                  <div key={m.botId} className="rounded-lg border border-white/10 p-3">
                    <div className="font-medium">{m.title || `${m.platform} meeting`} <span className="text-xs text-zinc-400">· {m.status}</span></div>
                    {m.notes?.summary && <div className="mt-1 text-zinc-300">{m.notes.summary}</div>}
                    {m.note && <div className="mt-1 text-xs text-amber-200">{m.note}</div>}
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
