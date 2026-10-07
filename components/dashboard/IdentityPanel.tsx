"use client";

import { useCallback, useEffect, useState } from "react";
import { Copy, Mail, RefreshCw, X } from "lucide-react";
import BotAvatar from "@/components/BotAvatar";
import { browserCreate, browserOverview } from "@/lib/mail-browser";
import type { AvatarColor } from "@/lib/bots";

type MailItem = { id: string; from: string; domain: string; subject: string; at: string; intro: string; body: string; codes: string[]; links: string[] };
type Service = { domain: string; mails: number; lastAt: string; lastSubject: string; codes: string[]; used: boolean };
type LogRow = { at: number; kind: string; site: string; text: string };
type Overview = { enabled: boolean; address: string | null; mails: MailItem[]; services: Service[]; log: LogRow[]; mailError?: string };

const when = (v: string | number) => { const d = new Date(v); return isNaN(d.getTime()) ? "" : d.toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }); };
const KIND: Record<string, string> = { created: "📬 inbox created", mail: "✉️ mail arrived", otp: "🔑 code arrived", used: "✍️ email used" };

export default function IdentityPanel({
  open, onClose, chatId, name, color, presetRole, role, model, plugins, memories, skills, computer, getToken, onEmailCreated,
}: {
  open: boolean; onClose: () => void; chatId: string; name: string; color: AvatarColor; presetRole?: string; role: string; model: string;
  plugins: string[]; memories: number; skills: number; computer: string; getToken: () => Promise<string>;
  onEmailCreated: (placeholder: string) => void;
}) {
  const [tab, setTab] = useState<"profile" | "email" | "activity">("profile");
  const [data, setData] = useState<Overview | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [openMail, setOpenMail] = useState<string | null>(null);
  const [copied, setCopied] = useState("");

  const call = useCallback(async (action: string, extra: Record<string, unknown> = {}) => {
    const res = await fetch("/api/identity", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + (await getToken()) }, body: JSON.stringify({ action, chatId, ...extra }) });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d?.error || "Request failed.");
    return d;
  }, [chatId, getToken]);

  const load = useCallback(async () => {
    setBusy(true); setErr("");
    let d: Overview | null = null;
    try { d = await call("overview"); } catch (e) { setErr(e instanceof Error ? e.message : "Could not load."); }
    // If the server cannot reach the mailbox service, read the inbox from this browser (works for inboxes created here).
    if (d && d.mailError) {
      const raw = localStorage.getItem("av:mail:" + chatId);
      if (raw) {
        try { d = { ...d, ...(await browserOverview(JSON.parse(raw))), mailError: undefined }; } catch { /* keep the server data and its error */ }
      }
    }
    if (d) setData(d);
    setBusy(false);
  }, [call, chatId]);

  useEffect(() => { if (open) { setData(null); void load(); } }, [open, chatId, load]);
  if (!open) return null;

  const copy = (v: string) => { navigator.clipboard?.writeText(v); setCopied(v); setTimeout(() => setCopied(""), 1200); };

  async function enable() {
    setBusy(true); setErr("");
    try {
      const d = await call("enable");
      onEmailCreated(String(d.placeholder));
      await load();
      return;
    } catch (e1) {
      try {
        // The server's network can be blocked by the mailbox services: create the inbox from this browser instead.
        const b = await browserCreate();
        const d = await call("adopt", b);
        localStorage.setItem("av:mail:" + chatId, JSON.stringify(b));
        onEmailCreated(String(d.placeholder));
        await load();
        return;
      } catch (e2) {
        setErr(`Server: ${e1 instanceof Error ? e1.message : "failed"}\nThis browser: ${e2 instanceof Error ? e2.message : "failed"}`);
      }
    }
    setBusy(false);
  }
  const row = "flex justify-between gap-3 border-b border-line py-2 text-sm";

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/60" onClick={onClose}>
      <aside className="flex h-full w-full max-w-[480px] flex-col border-l border-line bg-panel" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 border-b border-line px-5 py-4">
          <BotAvatar color={color} size={44} />
          <div className="min-w-0 flex-1"><p className="truncate text-base font-semibold text-ink">{name}</p><p className="truncate text-xs text-muted">{role || presetRole || "No role yet — tell it in chat, e.g. “you are my CEO”"}</p></div>
          <button onClick={onClose} className="rounded-full p-1.5 text-muted hover:bg-panel2 hover:text-ink"><X size={18} /></button>
        </div>
        <div className="flex gap-1 border-b border-line px-4 py-2 text-xs">
          {([["profile", "Profile"], ["email", "Email"], ["activity", "Activity"]] as const).map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)} className={`rounded-md px-3 py-1.5 ${tab === k ? "bg-panel2 text-ink" : "text-muted hover:text-ink"}`}>{l}</button>
          ))}
          <button onClick={load} title="Refresh" className="ml-auto rounded-md p-1.5 text-muted hover:text-ink"><RefreshCw size={14} className={busy ? "animate-spin" : ""} /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {err && <p className="mb-3 whitespace-pre-wrap break-words rounded-lg border border-red-900/50 bg-red-950/40 px-3 py-2 text-xs text-red-300">{err}</p>}
          {data?.mailError && <p className="mb-3 whitespace-pre-wrap break-words rounded-lg border border-red-900/50 bg-red-950/40 px-3 py-2 text-xs text-red-300">The mailbox service could not be reached from the server: {data.mailError}</p>}

          {tab === "profile" && (
            <div>
              <div className={row}><span className="text-muted">Name</span><span className="text-ink">{name}</span></div>
              <div className={row}><span className="text-muted">Role</span><span className="max-w-[260px] text-right text-ink">{role || presetRole || "—"}</span></div>
              <div className={row}><span className="text-muted">Email</span><span className="text-ink">{data?.address ?? (data ? "not created" : "…")}</span></div>
              <div className={row}><span className="text-muted">Model</span><span className="text-ink">{model}</span></div>
              <div className={row}><span className="text-muted">Computer</span><span className="text-ink">{computer}</span></div>
              <div className={row}><span className="text-muted">Memory (this chat only)</span><span className="text-ink">{memories} notes · {skills} skills</span></div>
              <div className={row}><span className="text-muted">Connected tools</span><span className="max-w-[260px] text-right text-ink">{plugins.length ? plugins.join(", ") : "free pack only"}</span></div>
            </div>
          )}

          {tab === "email" && (
            <div>
              {!data?.address ? (
                <div className="rounded-lg border border-line p-4 text-sm text-muted">
                  <p>This agent has no email of its own yet. It gets a free temporary inbox so it can sign up for services and read verification codes — your real email is never used.</p>
                  <button onClick={enable} disabled={busy} className="mt-3 rounded-lg bg-white px-4 py-2 text-sm font-medium text-bg disabled:opacity-50">{busy ? "Creating…" : "Create the agent's email"}</button>
                </div>
              ) : (
                <>
                  <div className="mb-4 flex items-center gap-2 rounded-lg border border-line bg-bg px-3 py-2.5">
                    <Mail size={15} className="text-gold" /><span className="min-w-0 flex-1 truncate text-sm text-ink">{data.address}</span>
                    <button onClick={() => copy(data.address as string)} className="text-xs text-muted hover:text-ink">{copied === data.address ? "Copied" : <Copy size={14} />}</button>
                  </div>
                  <p className="mb-2 text-xs font-medium uppercase tracking-wider text-faint">Inbox ({data.mails.length})</p>
                  {data.mails.length === 0 && <p className="text-xs text-faint">Nothing has arrived yet.</p>}
                  <div className="space-y-2">
                    {data.mails.map((m) => (
                      <div key={m.id} className="rounded-lg border border-line">
                        <button onClick={() => setOpenMail(openMail === m.id ? null : m.id)} className="w-full px-3 py-2.5 text-left">
                          <div className="flex justify-between gap-2 text-[11px] text-faint"><span className="truncate">{m.from}</span><span className="shrink-0">{when(m.at)}</span></div>
                          <p className="truncate text-sm text-ink">{m.subject || "(no subject)"}</p>
                          {m.codes.length > 0 && <p className="mt-1 text-xs text-gold">Code: {m.codes.join(", ")}</p>}
                        </button>
                        {openMail === m.id && (
                          <div className="space-y-2 border-t border-line p-3 text-xs">
                            {m.codes.map((c) => <button key={c} onClick={() => copy(c)} className="mr-2 rounded bg-goldSoft px-2 py-1 font-mono text-gold">{copied === c ? "copied" : c}</button>)}
                            <p className="whitespace-pre-wrap break-words text-muted">{m.body || m.intro}</p>
                            {m.links.length > 0 && <div className="break-all text-faint">{m.links.map((l) => <a key={l} href={l} target="_blank" rel="noreferrer" className="block underline">{l}</a>)}</div>}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          {tab === "activity" && (
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wider text-faint">Where this email is used</p>
              {(data?.services.length ?? 0) === 0 && <p className="text-xs text-faint">No service has used or mailed this address yet.</p>}
              <div className="space-y-2">
                {data?.services.map((s) => (
                  <div key={s.domain} className="rounded-lg border border-line px-3 py-2.5">
                    <div className="flex items-center justify-between"><span className="text-sm text-ink">{s.domain}</span><span className="text-[11px] text-faint">{s.mails} mail{s.mails === 1 ? "" : "s"}{s.used ? " · agent signed up/typed it" : ""}</span></div>
                    {s.lastSubject && <p className="truncate text-xs text-muted">Last: {s.lastSubject}</p>}
                    {s.codes.length > 0 && <p className="text-xs text-gold">Codes received: {Array.from(new Set(s.codes)).join(", ")}</p>}
                  </div>
                ))}
              </div>
              <p className="mb-2 mt-5 text-xs font-medium uppercase tracking-wider text-faint">Timeline</p>
              {(data?.log.length ?? 0) === 0 && <p className="text-xs text-faint">Empty.</p>}
              <div className="space-y-1.5">
                {data?.log.map((l, i) => (
                  <p key={i} className="text-xs text-muted"><span className="mr-2 font-mono text-faint">{when(l.at)}</span>{KIND[l.kind] ?? l.kind} · <span className="text-ink">{l.site}</span> — {l.text}</p>
                ))}
              </div>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}