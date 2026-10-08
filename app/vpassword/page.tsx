"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, KeyRound, ShieldCheck, Trash2 } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { useKeys } from "@/lib/keys-context";
import { listChats, type Chat } from "@/lib/chats";
import type { VpMeta } from "@/lib/vpassword";

type LogRow = { at: number; label: string; site: string; what: string; chatId: string };
const input = "w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm text-ink placeholder:text-faint focus:border-gold focus:outline-none";
const when = (v: number) => new Date(v).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const EMPTY = { label: "", site: "", username: "", password: "", totp: "", number: "", exp: "", cvc: "", name: "", zip: "", limit: "", chat: "" };

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

export default function VPasswordPage() {
  const { user, loading } = useAuth();
  const { e2bKey } = useKeys();
  const router = useRouter();
  const [chats, setChats] = useState<Chat[]>([]);
  const [entries, setEntries] = useState<VpMeta[]>([]);
  const [log, setLog] = useState<LogRow[]>([]);
  const [tab, setTab] = useState<"entries" | "add" | "activity">("entries");
  const [kind, setKind] = useState<"login" | "card" | "session">("login");
  const [f, setF] = useState(EMPTY);
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
      } else {
        await call("add", { kind, label: f.label, site: f.site, username: f.username, password: f.password, totp: f.totp, number: f.number, exp: f.exp, cvc: f.cvc, name: f.name, zip: f.zip, limit: f.limit ? Number(f.limit) : undefined, allowed });
        setMsg("Saved and encrypted. The values can never be shown again.");
      }
      setF(EMPTY); setAllowed([]); await refresh(); setTab("entries");
    } catch (e) { setMsg(e instanceof Error ? e.message : "Failed."); }
    setBusy(false);
  }

  async function setAccess(id: string, v: string[] | "all") {
    setEntries((p) => p.map((e) => (e.id === id ? { ...e, allowed: v } : e)));
    try { await call("update", { id, allowed: v }); } catch (e) { setMsg(e instanceof Error ? e.message : "Could not save."); }
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

  return (
    <div className="min-h-screen bg-bg">
      <div className="mx-auto max-w-3xl px-6 py-8">
        <button onClick={() => router.push("/dashboard")} className="mb-4 flex items-center gap-1.5 text-xs text-muted hover:text-ink"><ArrowLeft size={14} /> Dashboard</button>
        <h1 className="flex items-center gap-2 text-xl font-semibold text-ink"><KeyRound size={20} className="text-gold" /> vPassword</h1>
        <p className="mt-1 text-sm leading-relaxed text-muted">
          Logins, cards and saved sessions your agents can <b className="text-ink">use but never see</b>. Everything is encrypted on the server. An agent only gets a name; the system types the values straight into the page, only on the matching site, and cards ask you before every payment.
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
                  <span className="truncate text-xs text-muted">{e.site || e.hint}</span>
                  <span className="text-[11px] text-faint">{e.allowed === "all" ? "all agents" : `${(e.allowed as string[]).length} agent(s)`}</span>
                </button>
                {open === e.id && (
                  <div className="space-y-3 border-t border-line p-3.5">
                    <p className="text-xs text-muted">{e.hint}{e.limit ? ` · limit ${e.limit}` : ""}{e.uses ? ` · used ${e.uses}×` : ""}{e.lastUsedAt ? ` · last ${when(e.lastUsedAt)}` : ""}</p>
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
            <div className="flex gap-1.5">
              {([["login", "Login"], ["card", "Card"], ["session", "Session"]] as const).map(([k, l]) => (
                <button key={k} onClick={() => { setKind(k); setMsg(""); }} className={`rounded-full border px-3 py-1 text-xs ${kind === k ? "border-white bg-white text-bg" : "border-line text-muted"}`}>{l}</button>
              ))}
            </div>
            {field("label", kind === "card" ? "Name (for example Business card)" : "Name (for example Work GitHub)")}
            {kind === "login" && (<>
              {field("site", "Site (for example github.com)")}
              {field("username", "Username or email")}
              {field("password", "Password", "password")}
              {field("totp", "2FA setup key (optional, base32): the agent never needs an OTP", "password")}
            </>)}
            {kind === "card" && (<>
              {field("site", "Only on this site (optional, for example shop.com)")}
              {field("number", "Card number")}
              <div className="grid grid-cols-3 gap-2">{field("exp", "MM/YY")}{field("cvc", "CVC", "password")}{field("zip", "ZIP / PIN")}</div>
              {field("name", "Name on card")}
              {field("limit", "Maximum amount per payment (optional)")}
              <p className="text-[11px] leading-relaxed text-faint">Every payment still asks for your approval, showing the site and the amount. The limit is enforced on the server.</p>
            </>)}
            {kind === "session" && (<>
              <p className="text-xs leading-relaxed text-muted">
                1. In the chat, open the computer panel, press <b className="text-ink">Take control</b>, and log in to the site yourself (do the OTP once).<br />
                2. Come back here, pick that chat, enter the site, press Capture. Later computers will already be signed in.
              </p>
              {field("site", "Site you logged into (for example mail.google.com)")}
              <select className={input} value={f.chat} onChange={(e) => setF({ ...f, chat: e.target.value })}>
                <option value="">Pick the chat whose computer you logged in on…</option>
                {chats.filter((c) => c.pcSandboxId).map((c) => <option key={c.id} value={c.id}>{c.agentName}</option>)}
              </select>
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