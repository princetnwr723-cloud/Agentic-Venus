"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, KeyRound, ShieldCheck, Trash2 } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { useKeys } from "@/lib/keys-context";
import { listChats, type Chat } from "@/lib/chats";
import type { VpMeta } from "@/lib/vpassword";

type LogRow = { at: number; label: string; site: string; what: string; chatId: string };
type Kind = "login" | "card" | "session" | "proxy";
const input = "w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm text-ink placeholder:text-faint focus:border-gold focus:outline-none";
const when = (v: number) => new Date(v).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const num = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2 });
// Same maths as the server (kept here so this client page does not pull server-only code into the browser bundle).
function leftOf(e: VpMeta) {
  const used = e.dayKey === new Date().toISOString().slice(0, 10) ? (e.daySpent ?? 0) : 0;
  return {
    budgetLeft: e.budget ? Math.max(0, Math.round((e.budget - (e.spent ?? 0)) * 100) / 100) : null,
    dailyLeft: e.daily ? Math.max(0, Math.round((e.daily - used) * 100) / 100) : null,
  };
}
const EMPTY = {
  label: "", site: "", username: "", password: "", totp: "", number: "", exp: "", cvc: "", name: "", zip: "",
  limit: "", budget: "", daily: "", chat: "", scheme: "http", host: "", port: "", tz: "", lang: "",
};

function Access({ value, chats, onChange }: { value: string[] | "all"; chats: Chat[]; onChange: (v: string[] | "all") => void }) {
  const all = value === "all";
  const sel = Array.isArray(value) ? value : [];
  return (
    <div className="space-y-1.5 text-xs">
      <label className="flex items-center gap-2 text-ink"><input type="checkbox" checked={all} onChange={(e) => onChange(e.target.checked ? "all" : [])} /> All my agents</label>
      {!all && chats.map((c) => (
        <label key={c.id} className="flex items-center gap-2 text-muted">
          <input type="checkbox" checked={sel.includes(c.id)} onChange={(e) => onChange(e.target.checked ? [...sel, c.id] : sel.filter((x) => x !== c.id))} /> {c.agentName}
        </label>
      ))}
      {!all && sel.length === 0 && <p className="text-faint">No agent can use this yet.</p>}
    </div>
  );
}

// Budget, limits and the spent counter of one card. The numbers are enforced on the server.
function CardBudget({ e, onSave, onReset }: { e: VpMeta; onSave: (v: { limit: string; budget: string; daily: string; site: string; anySite: boolean }) => void; onReset: () => void }) {
  const [v, setV] = useState({ limit: e.limit ? String(e.limit) : "", budget: e.budget ? String(e.budget) : "", daily: e.daily ? String(e.daily) : "", site: e.site || "" });
  const [any, setAny] = useState(Boolean(e.anySite));
  const left = leftOf(e);
  const pct = e.budget ? Math.min(100, Math.round(((e.spent ?? 0) / e.budget) * 100)) : 0;
  return (
    <div className="space-y-2 rounded-lg border border-line bg-bg p-3">
      <p className="text-[11px] uppercase tracking-wider text-faint">Budget and limits</p>
      {e.budget ? (
        <div>
          <div className="h-1.5 overflow-hidden rounded-full bg-panel2"><div className="h-full bg-gold" style={{ width: `${pct}%` }} /></div>
          <p className="mt-1 text-xs text-muted">Spent {num(e.spent ?? 0)} of {num(e.budget)} · {num(left.budgetLeft ?? 0)} left{left.dailyLeft !== null ? ` · ${num(left.dailyLeft)} left today` : ""}</p>
        </div>
      ) : (
        <p className="text-xs text-muted">Spent so far: {num(e.spent ?? 0)}. No total budget set.</p>
      )}
      <div className="grid grid-cols-3 gap-2">
        <input className={input} placeholder="Per payment" inputMode="decimal" value={v.limit} onChange={(x) => setV({ ...v, limit: x.target.value })} />
        <input className={input} placeholder="Total budget" inputMode="decimal" value={v.budget} onChange={(x) => setV({ ...v, budget: x.target.value })} />
        <input className={input} placeholder="Per day" inputMode="decimal" value={v.daily} onChange={(x) => setV({ ...v, daily: x.target.value })} />
      </div>
      <input className={input} placeholder="Only on this site (for example shop.com)" value={v.site} disabled={any} onChange={(x) => setV({ ...v, site: x.target.value })} />
      <label className="flex items-center gap-2 text-xs text-muted"><input type="checkbox" checked={any} onChange={(x) => setAny(x.target.checked)} /> Any site (less safe: the card can be used on every site)</label>
      <div className="flex items-center gap-4 text-xs">
        <button onClick={() => onSave({ ...v, site: any ? "" : v.site, anySite: any })} className="rounded-md bg-white px-3 py-1.5 font-medium text-bg">Save limits</button>
        <button onClick={onReset} className="text-muted underline">Reset spent to 0</button>
      </div>
      <p className="text-[11px] leading-relaxed text-faint">Empty = no cap of that kind. “Per day” counts in UTC days. Every payment still needs your approval, and the amount you approve is the amount that counts.</p>
    </div>
  );
}

export default function VPasswordPage() {
  const { user, loading } = useAuth();
  const { e2bKey } = useKeys();
  const router = useRouter();
  const [chats, setChats] = useState<Chat[]>([]);
  const [entries, setEntries] = useState<VpMeta[]>([]);
  const [log, setLog] = useState<LogRow[]>([]);
  const [tab, setTab] = useState<"entries" | "add" | "activity">("entries");
  const [kind, setKind] = useState<Kind>("login");
  const [f, setF] = useState(EMPTY);
  const [anySite, setAnySite] = useState(false);
  const [allowed, setAllowed] = useState<string[] | "all">([]);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [codes, setCodes] = useState<Record<string, string>>({});
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => { if (!loading && !user) router.replace("/"); }, [loading, user, router]);

  const call = useCallback(async (action: string, extra: Record<string, unknown> = {}) => {
    const res = await fetch("/api/vpassword", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + (await user!.getIdToken()) },
      body: JSON.stringify({ action, ...extra }),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d?.error || "Request failed.");
    return d;
  }, [user]);

  const refresh = useCallback(async () => {
    try {
      const [a, b] = await Promise.all([call("list"), call("activity")]);
      setEntries(a.entries ?? []);
      setLog(b.log ?? []);
    } catch (e) { setMsg(e instanceof Error ? e.message : "Could not load."); }
  }, [call]);

  useEffect(() => {
    if (!user) return;
    listChats(user.uid).then(setChats).catch(() => {});
    void refresh();
  }, [user, refresh]);

  async function submit() {
    setBusy(true); setMsg("");
    try {
      if (kind === "session") {
        const chat = chats.find((c) => c.id === f.chat);
        if (!chat?.pcSandboxId) throw new Error("Pick a chat that has a computer (run a computer task there once first).");
        const d = await call("capture_session", { site: f.site, label: f.label, allowed, e2bKey, sandboxId: chat.pcSandboxId });
        setMsg(`Saved the session: ${d.count} cookies for ${d.site}.`);
      } else if (kind === "proxy") {
        await call("add", { kind, label: f.label, scheme: f.scheme, host: f.host, port: f.port, username: f.username, password: f.password, tz: f.tz, lang: f.lang, allowed });
        setMsg("Proxy saved and encrypted. The agent's browser will use it on its next computer task.");
      } else {
        await call("add", { kind, label: f.label, site: f.site, anySite, username: f.username, password: f.password, totp: f.totp, number: f.number, exp: f.exp, cvc: f.cvc, name: f.name, zip: f.zip, limit: f.limit, budget: f.budget, daily: f.daily, allowed });
        setMsg("Saved and encrypted. The values can never be shown again.");
      }
      setF(EMPTY); setAnySite(false); setAllowed([]); await refresh(); setTab("entries");
    } catch (e) { setMsg(e instanceof Error ? e.message : "Failed."); }
    setBusy(false);
  }

  async function setAccess(id: string, v: string[] | "all") {
    setEntries((p) => p.map((e) => (e.id === id ? { ...e, allowed: v } : e)));
    try { await call("update", { id, allowed: v }); } catch (e) { setMsg(e instanceof Error ? e.message : "Could not save."); }
  }
  async function saveCard(id: string, v: { limit: string; budget: string; daily: string; site: string; anySite: boolean }) {
    try { await call("update", { id, limit: v.limit, budget: v.budget, daily: v.daily, site: v.site, anySite: v.anySite }); setMsg("Limits saved."); await refresh(); }
    catch (e) { setMsg(e instanceof Error ? e.message : "Could not save."); }
  }
  async function resetSpent(id: string) {
    if (!window.confirm("Set the spent counter back to 0?")) return;
    try { await call("update", { id, resetSpent: true }); await refresh(); } catch (e) { setMsg(e instanceof Error ? e.message : "Could not reset."); }
  }
  async function remove(e: VpMeta) {
    if (!window.confirm(`Delete “${e.label}” for good?`)) return;
    try { await call("delete", { id: e.id }); await refresh(); } catch (er) { setMsg(er instanceof Error ? er.message : "Could not delete."); }
  }
  async function preview(id: string) {
    try { const d = await call("totp_preview", { id }); setCodes((c) => ({ ...c, [id]: `${d.code} (valid ${d.expiresIn}s)` })); } catch (e) { setMsg(e instanceof Error ? e.message : "Failed."); }
  }

  if (!user) return <div className="flex h-screen items-center justify-center bg-bg text-sm text-muted">Loading…</div>;
  const nameOf = (id: string) => chats.find((c) => c.id === id)?.agentName ?? "—";
  const field = (k: keyof typeof EMPTY, ph: string, type = "text") => (
    <input type={type} className={input} placeholder={ph} value={f[k]} autoComplete="off" onChange={(e) => setF({ ...f, [k]: e.target.value })} />
  );
  const kinds: [Kind, string][] = [["login", "Login"], ["card", "Card"], ["session", "Session"], ["proxy", "Proxy"]];

  return (
    <div className="min-h-screen bg-bg">
      <div className="mx-auto max-w-3xl px-6 py-8">
        <button onClick={() => router.push("/dashboard")} className="mb-4 flex items-center gap-1.5 text-xs text-muted hover:text-ink"><ArrowLeft size={14} /> Dashboard</button>
        <h1 className="flex items-center gap-2 text-xl font-semibold text-ink"><KeyRound size={20} className="text-gold" /> vPassword</h1>
        <p className="mt-1 text-sm leading-relaxed text-muted">
          Logins, cards, Google/Gmail sessions and a proxy your agents can <b className="text-ink">use but never see</b>. Everything is encrypted on the server. An agent only gets a name; the system types the values straight into the page, only on the matching site. Cards have a budget and limits, and <b className="text-ink">every payment needs your approval</b> (a banner appears in the dashboard).
        </p>

        <div className="mt-5 flex gap-1 text-xs">
          {([["entries", `Saved (${entries.length})`], ["add", "+ Add"], ["activity", "Activity"]] as const).map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)} className={`rounded-md px-3 py-1.5 ${tab === k ? "bg-panel2 text-ink" : "text-muted hover:text-ink"}`}>{l}</button>
          ))}
        </div>
        {msg && <p className="mt-3 rounded-lg border border-line bg-panel px-3 py-2 text-xs text-muted">{msg}</p>}

        {tab === "entries" && (
          <div className="mt-4 space-y-2">
            {entries.length === 0 && <p className="text-xs text-faint">Nothing saved yet. Use “+ Add”.</p>}
            {entries.map((e) => (
              <div key={e.id} className="rounded-lg border border-line bg-panel">
                <button onClick={() => setOpen(open === e.id ? null : e.id)} className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left">
                  <span className="rounded-full border border-line px-2 py-0.5 text-[10px] uppercase text-muted">{e.kind}</span>
                  <span className="min-w-0 flex-1 truncate text-sm text-ink">{e.label}</span>
                  <span className="truncate text-xs text-muted">{e.site || (e.kind === "card" && e.anySite ? "any site" : e.hint)}</span>
                  <span className="text-[11px] text-faint">{e.allowed === "all" ? "all agents" : `${(e.allowed as string[]).length} agent(s)`}</span>
                </button>
                {open === e.id && (
                  <div className="space-y-3 border-t border-line p-3.5">
                    <p className="text-xs text-muted">{e.hint}{e.uses ? ` · used ${e.uses}×` : ""}{e.lastUsedAt ? ` · last ${when(e.lastUsedAt)}` : ""}</p>
                    {e.kind === "card" && <CardBudget key={`${e.id}-${e.spent ?? 0}-${e.budget ?? 0}-${e.limit ?? 0}-${e.daily ?? 0}`} e={e} onSave={(v) => saveCard(e.id, v)} onReset={() => resetSpent(e.id)} />}
                    {e.kind === "card" && !e.site && !e.anySite && <p className="text-xs text-red-300">This card has no site yet, so agents cannot use it. Set a site above (or “any site”).</p>}
                    <div><p className="mb-1.5 text-[11px] uppercase tracking-wider text-faint">Which agents may use it</p><Access value={e.allowed} chats={chats} onChange={(v) => setAccess(e.id, v)} /></div>
                    <div className="flex items-center gap-4 text-xs">
                      {e.hasTotp && <button onClick={() => preview(e.id)} className="text-muted underline">{codes[e.id] ? `2FA code: ${codes[e.id]}` : "Check the 2FA code"}</button>}
                      <button onClick={() => remove(e)} className="flex items-center gap-1 text-red-400"><Trash2 size={12} /> Delete</button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {tab === "add" && (
          <div className="mt-4 space-y-3 rounded-xl border border-line bg-panel p-4">
            <div className="flex flex-wrap gap-1.5">
              {kinds.map(([k, l]) => (
                <button key={k} onClick={() => { setKind(k); setMsg(""); }} className={`rounded-full border px-3 py-1 text-xs ${kind === k ? "border-white bg-white text-bg" : "border-line text-muted"}`}>{l}</button>
              ))}
            </div>
            {field("label", kind === "card" ? "Name (for example Business card)" : kind === "proxy" ? "Name (for example India residential)" : "Name (for example Work GitHub)")}
            {kind === "login" && (<>
              {field("site", "Site (for example github.com)")}
              {field("username", "Username or email")}
              {field("password", "Password", "password")}
              {field("totp", "2FA setup key (optional, base32): the agent never needs an OTP", "password")}
            </>)}
            {kind === "card" && (<>
              {field("site", "Only on this site (for example shop.com)")}
              <label className="flex items-center gap-2 text-xs text-muted"><input type="checkbox" checked={anySite} onChange={(e) => setAnySite(e.target.checked)} /> Any site (less safe: leave the site empty only if you really want this)</label>
              {field("number", "Card number")}
              <div className="grid grid-cols-3 gap-2">{field("exp", "MM/YY")}{field("cvc", "CVC", "password")}{field("zip", "ZIP / PIN")}</div>
              {field("name", "Name on card")}
              <div className="grid grid-cols-3 gap-2">{field("limit", "Per payment")}{field("budget", "Total budget")}{field("daily", "Per day")}</div>
              <p className="text-[11px] leading-relaxed text-faint">The agent can never spend more than the total budget, the daily limit or the per-payment limit, and every payment asks you first (site and amount shown). These are checked on the server. For the strongest protection also use a card that has its own limit at your bank.</p>
            </>)}
            {kind === "session" && (<>
              <p className="text-xs leading-relaxed text-muted">
                1. In the chat, open the computer panel, press <b className="text-ink">Take control</b>, and log in to the site yourself (do the OTP once).<br />
                2. Come back here, pick that chat, enter the site, press Capture. Later computers will already be signed in.<br />
                <b className="text-ink">Your Gmail / Google account:</b> log in to google.com on the computer, then capture it with the site <button onClick={() => setF({ ...f, site: "google.com", label: f.label || "My Google account" })} className="underline">google.com</button>. The browser then opens already signed in, so “Continue with Google” works and the agent can read mail codes with the Gmail connector.
              </p>
              {field("site", "Site you logged into (for example google.com)")}
              <select className={input} value={f.chat} onChange={(e) => setF({ ...f, chat: e.target.value })}>
                <option value="">Pick the chat whose computer you logged in on…</option>
                {chats.filter((c) => c.pcSandboxId).map((c) => <option key={c.id} value={c.id}>{c.agentName}</option>)}
              </select>
            </>)}
            {kind === "proxy" && (<>
              <p className="text-xs leading-relaxed text-muted">The computer&apos;s browser goes through this proxy so shopping sites see a home-like IP instead of a data-centre IP. Use an http/https proxy (a residential proxy works best). The browser will not start without it if it fails the check.</p>
              <div className="grid grid-cols-3 gap-2">
                <select className={input} value={f.scheme} onChange={(e) => setF({ ...f, scheme: e.target.value })}><option value="http">http</option><option value="https">https</option></select>
                <div className="col-span-2">{field("host", "Proxy host (for example proxy.example.com)")}</div>
              </div>
              <div className="grid grid-cols-3 gap-2">{field("port", "Port")}{field("username", "Username")}{field("password", "Password", "password")}</div>
              <div className="grid grid-cols-2 gap-2">{field("tz", "Time zone (optional, Asia/Kolkata)")}{field("lang", "Language (optional, en-IN)")}</div>
              <p className="text-[11px] leading-relaxed text-faint">Set the time zone and language to match the proxy&apos;s country: sites compare them with the IP.</p>
            </>)}
            <div><p className="mb-1.5 text-[11px] uppercase tracking-wider text-faint">Which agents may use it</p><Access value={allowed} chats={chats} onChange={setAllowed} /></div>
            <button onClick={submit} disabled={busy} className="flex items-center gap-2 rounded-lg bg-white px-4 py-2 text-sm font-medium text-bg disabled:opacity-50">
              <ShieldCheck size={15} /> {busy ? "Working…" : kind === "session" ? "Capture session" : "Encrypt and save"}
            </button>
          </div>
        )}

        {tab === "activity" && (
          <div className="mt-4 space-y-1.5">
            {log.length === 0 && <p className="text-xs text-faint">No activity yet.</p>}
            {log.map((l, i) => (
              <p key={i} className="text-xs text-muted"><span className="mr-2 font-mono text-faint">{when(l.at)}</span><span className="text-ink">{l.label}</span> · {l.site} · {l.what}{l.chatId ? ` · by ${nameOf(l.chatId)}` : ""}</p>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
