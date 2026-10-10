"use client";

import { useEffect, useState } from "react";
import { ExternalLink, Search, X } from "lucide-react";
import { FREE_PACK, PLUGINS, safeId } from "@/lib/tools/catalog";
import { OAUTH_PROVIDERS } from "@/lib/tools/oauth-catalog";

type TestResult = { ok: boolean; label?: string; error?: string };
type Hit = { name: string; title: string; description: string; url: string; needsToken: boolean; source: string };

export default function ConnectorsModal({
  open, onClose, chatName, chatId, connectors, onTest, onSave, getToken,
}: {
  open: boolean;
  onClose: () => void;
  chatName: string;
  chatId: string;
  getToken: () => Promise<string>;
  connectors: Record<string, string>;
  onTest: (kind: string, token: string) => Promise<TestResult>;
  onSave: (kind: string, token: string) => Promise<void>;
}) {
  const [tab, setTab] = useState<"plugins" | "custom">("plugins");
  const [drafts, setDrafts] = useState<Record<string, string[]>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<Record<string, string>>({});
  const [ctype, setCtype] = useState<"mcp" | "api">("mcp");
  const [f, setF] = useState({ name: "", url: "", auth: "", desc: "", header: "Authorization", value: "" });
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [searching, setSearching] = useState(false);
  const [toks, setToks] = useState<Record<string, string>>({});

  // MCP search: type a tool's name, a Connect button appears.
  useEffect(() => {
    if (!open || tab !== "custom" || ctype !== "mcp" || q.trim().length < 2) { setHits([]); return; }
    const h = setTimeout(async () => {
      setSearching(true);
      try {
        const r = await fetch("/api/connectors/mcp-search", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ q }) });
        const d = await r.json();
        setHits(Array.isArray(d.results) ? d.results : []);
      } catch { setHits([]); }
      setSearching(false);
    }, 400);
    return () => clearTimeout(h);
  }, [q, tab, ctype, open]);

  if (!open) return null;

  const box = "w-full rounded-md border border-line bg-bg px-3 py-1.5 text-xs text-ink placeholder:text-faint focus:border-gold";
  const say = (id: string, m: string) => setMsg((x) => ({ ...x, [id]: m }));

  async function startOAuth(provider: string) {
    setBusy(provider); say(provider, "");
    try {
      const token = await getToken();
      const res = await fetch("/api/connectors/oauth/start", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ provider, chatId }) });
      const data = await res.json();
      if (!res.ok || !data.url) throw new Error(data.error || "Could not start OAuth.");
      window.location.assign(data.url);
    } catch (e) { say(provider, e instanceof Error ? e.message : "OAuth could not start."); setBusy(null); }
  }

  async function connect(kind: string, token: string, id = kind) {
    setBusy(id);
    say(id, "");
    let r: TestResult;
    try { r = await onTest(kind, token); } catch { r = { ok: false, error: "Could not check it." }; }
    if (r.ok) {
      await onSave(kind, token);
      say(id, r.label ? `Connected · ${r.label}. The agent can use it now.` : "Connected. The agent can use it now.");
    } else say(id, r.error || "Not accepted.");
    setBusy(null);
    return r.ok;
  }

  const Toggle = ({ id, label }: { id: string; label: string }) => {
    const on = connectors["auto:" + id] === "1";
    return (
      <label className="mt-2 flex cursor-pointer items-center gap-2 text-[11px] text-muted">
        <input type="checkbox" checked={on} onChange={() => onSave("auto:" + id, on ? "" : "1")} />
        {label}
      </label>
    );
  };

  const custom = Object.keys(connectors).filter((k) => k.startsWith("mcp:") || k.startsWith("api:"));

  async function addCustom() {
    const name = f.name.trim();
    if (!name || !f.url.trim()) return say("custom", "Give it a name and a URL.");
    const kind = `${ctype}:${safeId(name)}`;
    const payload = ctype === "mcp"
      ? JSON.stringify({ url: f.url.trim(), auth: f.auth.trim() || undefined })
      : JSON.stringify({ baseUrl: f.url.trim(), header: f.value.trim() ? f.header.trim() : undefined, value: f.value.trim() || undefined, description: f.desc.trim() || name });
    if (await connect(kind, payload, "custom")) setF({ name: "", url: "", auth: "", desc: "", header: "Authorization", value: "" });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4" onClick={onClose}>
      <div className="max-h-[88vh] w-full max-w-lg overflow-y-auto rounded-xl2 border border-line bg-panel p-6" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-medium text-ink">Connectors · {chatName}</h2>
          <button onClick={onClose} className="rounded-full p-1.5 text-muted hover:bg-panel2 hover:text-ink"><X size={18} /></button>
        </div>
        <div className="mb-4 flex rounded-full border border-line bg-panel2 p-1 text-xs">
          {([["plugins", "Plugins"], ["custom", "Custom · MCP / API"]] as const).map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)} className={`flex-1 rounded-full px-3 py-1.5 ${tab === k ? "bg-white font-medium text-bg" : "text-muted"}`}>{l}</button>
          ))}
        </div>
        <p className="mb-4 text-xs leading-relaxed text-muted">Only this chat can use these. Tokens are stored encrypted. Once connected, the agent automatically knows its tools and when to use them. Anything that sends or changes something outside asks for your approval first.</p>

        {tab === "plugins" ? (
          <div className="space-y-3">
            <div className="rounded-lg border border-line p-3">
              <div className="flex items-center justify-between"><span className="text-sm text-ink">{FREE_PACK.label}</span><span className="text-[11px] text-avatar-teal">Always on</span></div>
              <p className="mt-1 text-[11px] text-muted">{FREE_PACK.note}</p>
              <p className="mt-1.5 font-mono text-[10.5px] leading-relaxed text-faint">{[...FREE_PACK.tools, "voice.call", "voice.calls"].join(" · ")}</p>
            </div>

            <div className="rounded-lg border border-line p-3">
              <div className="mb-1 flex items-center justify-between"><span className="text-sm font-medium text-ink">OAuth apps</span><span className="text-[10px] text-muted">Official authorization</span></div>
              <p className="mb-3 text-[11px] leading-relaxed text-muted">Connect without pasting your password or token. Each provider needs its app credentials set by the site owner in Vercel.</p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {OAUTH_PROVIDERS.map((p) => {
                  const on = Boolean(connectors[`oauth:${p.id}`]);
                  return (
                    <div key={p.id} className="rounded-md border border-line p-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs text-ink">{p.label}</span>
                        {on ? <span className="text-[10px] text-avatar-teal">Connected</span> : <button disabled={busy === p.id} onClick={() => void startOAuth(p.id)} className="rounded-md bg-white px-2 py-1 text-[10px] font-medium text-bg disabled:opacity-50">{busy === p.id ? "Opening…" : "Connect"}</button>}
                      </div>
                      <p className="mt-1 text-[10px] leading-relaxed text-muted">{p.note}</p>
                      {on && (
                        <div className="mt-1 flex gap-3">
                          <button disabled={busy === p.id} onClick={() => void startOAuth(p.id)} className="text-[10px] text-gold underline">Reconnect</button>
                          <button onClick={() => onSave(`oauth:${p.id}`, "")} className="text-[10px] text-red-400">Disconnect</button>
                        </div>
                      )}
                      {msg[p.id] && <p className="mt-1 text-[10px] text-red-400">{msg[p.id]}</p>}
                    </div>
                  );
                })}
              </div>
            </div>

            {PLUGINS.map((p) => {
              const on = Boolean(connectors[p.id]);
              const vals = drafts[p.id] ?? p.fields.map(() => "");
              const hasWrite = p.tools.some((t) => t.risk === "write");
              return (
                <div key={p.id} className="rounded-lg border border-line p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-ink">{p.label}</span>
                    <div className="flex items-center gap-2">
                      {on && <span className="text-[11px] text-avatar-teal">Connected</span>}
                      {p.keysUrl && <a href={p.keysUrl} target="_blank" rel="noreferrer" title="Get the key" className="text-faint hover:text-muted"><ExternalLink size={13} /></a>}
                    </div>
                  </div>
                  <p className="mt-1 text-[11px] leading-relaxed text-muted">{p.note}</p>
                  {p.tools.length > 0 && <p className="mt-1.5 font-mono text-[10.5px] leading-relaxed text-faint">{p.tools.map((t) => t.name + (t.risk === "write" ? " ✎" : "")).join(" · ")}</p>}
                  {on ? (
                    <>
                      <div className="mt-2 flex items-center gap-3">
                        <button onClick={() => onSave(p.id, "")} className="rounded-md border border-line px-3 py-1.5 text-xs text-ink hover:bg-panel2">Disconnect</button>
                      </div>
                      {hasWrite && <Toggle id={p.id} label="Don't ask before write actions (✎) — only if you trust this chat" />}
                    </>
                  ) : (
                    <div className="mt-2 space-y-2">
                      {p.fields.map((fl, i) => (
                        <input key={fl.key} type={fl.secret ? "password" : "text"} placeholder={fl.placeholder} value={vals[i]} onChange={(e) => setDrafts((d) => ({ ...d, [p.id]: vals.map((v, j) => (j === i ? e.target.value : v)) }))} className={box} />
                      ))}
                      <button
                        disabled={busy === p.id || vals.some((v) => !v.trim())}
                        onClick={async () => { if (await connect(p.id, vals.map((v) => v.trim()).join("::") || "on")) setDrafts((d) => ({ ...d, [p.id]: p.fields.map(() => "") })); }}
                        className="rounded-md bg-white px-3 py-1.5 text-xs font-medium text-bg hover:opacity-90 disabled:opacity-50"
                      >{busy === p.id ? "Checking…" : p.fields.length === 0 ? "Turn on" : "Connect"}</button>
                    </div>
                  )}
                  {msg[p.id] && <p className="mt-1.5 text-[11px] text-muted">{msg[p.id]}</p>}
                </div>
              );
            })}

            <div className="rounded-lg border border-dashed border-line p-3 text-[11px] leading-relaxed text-muted">
              Need <b className="text-ink">Gmail, Calendar, Stripe, Linear</b> or any other service? Open the <b className="text-ink">Custom</b> tab and just type its name — a Connect button appears.
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {custom.map((k) => (
              <div key={k} className="rounded-lg border border-line p-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-ink">{k.startsWith("mcp:") ? "MCP" : "API"} · {k.slice(4)}</span>
                  <button onClick={() => onSave(k, "")} className="text-xs text-faint hover:text-red-400">Disconnect</button>
                </div>
                <p className="mt-1 text-[11px] text-muted">Stored encrypted. Disconnect and add it again to change it.</p>
                <Toggle id={k} label="Don't ask before write actions" />
              </div>
            ))}

            <div className="rounded-lg border border-line p-3">
              <div className="mb-2 flex gap-1.5">
                {(["mcp", "api"] as const).map((t) => (
                  <button key={t} onClick={() => setCtype(t)} className={`rounded-full border px-3 py-1 text-xs ${ctype === t ? "border-white bg-white text-bg" : "border-line text-muted"}`}>{t === "mcp" ? "MCP server" : "REST API + key"}</button>
                ))}
              </div>

              {ctype === "mcp" && (
                <div className="mb-3">
                  <div className="flex items-center gap-2 rounded-md border border-line bg-bg px-3 py-2">
                    <Search size={14} className="text-faint" />
                    <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search a tool: github, stripe, linear, notion, slack…" className="w-full bg-transparent text-xs text-ink placeholder:text-faint focus:outline-none" />
                  </div>
                  {searching && <p className="mt-2 text-[11px] text-muted">Searching…</p>}
                  {!searching && q.trim().length >= 2 && hits.length === 0 && <p className="mt-2 text-[11px] text-muted">Nothing found for “{q}”. If you know the server URL, add it below.</p>}
                  <div className="mt-2 space-y-2">
                    {hits.map((h) => {
                      const kind = `mcp:${safeId(h.name)}`;
                      const on = Boolean(connectors[kind]);
                      return (
                        <div key={h.url} className="rounded-md border border-line p-2.5">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0"><p className="truncate text-xs font-medium text-ink">{h.title}{h.source === "popular" && <span className="ml-1.5 text-[10px] text-gold">popular</span>}</p><p className="mt-0.5 text-[11px] leading-relaxed text-muted">{h.description}</p></div>
                            {on ? <span className="shrink-0 text-[11px] text-avatar-teal">Connected</span> : <button disabled={busy === h.url} onClick={() => void connect(kind, JSON.stringify({ url: h.url, auth: toks[h.url]?.trim() || undefined }), h.url)} className="shrink-0 rounded-md bg-white px-2.5 py-1 text-[11px] font-medium text-bg disabled:opacity-50">{busy === h.url ? "Checking…" : "Connect"}</button>}
                          </div>
                          {!on && h.needsToken && <input type="password" placeholder="Token / API key for this service" value={toks[h.url] ?? ""} onChange={(e) => setToks((t) => ({ ...t, [h.url]: e.target.value }))} className={`${box} mt-2`} />}
                          {msg[h.url] && <p className="mt-1.5 text-[11px] text-muted">{msg[h.url]}</p>}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              <p className="mb-2 text-[11px] leading-relaxed text-muted">
                {ctype === "mcp"
                  ? "Or paste a remote MCP server URL (Streamable HTTP). Its tools show up for the agent automatically. Auth: a token, or a header like “X-Api-Key: abc”."
                  : "Give a base URL and an API key. The agent gets one request tool limited to that host: GET is free, POST/PUT/PATCH/DELETE ask for approval."}
              </p>
              <div className="space-y-2">
                <input className={box} placeholder="Name (e.g. gmail, crm, stripe)" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
                <input className={box} placeholder={ctype === "mcp" ? "https://your-mcp-server.com/mcp" : "https://api.example.com/v1"} value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} />
                {ctype === "mcp" ? (
                  <input className={box} type="password" placeholder="Auth (optional)" value={f.auth} onChange={(e) => setF({ ...f, auth: e.target.value })} />
                ) : (
                  <>
                    <input className={box} placeholder="What is this API for? (the agent reads this)" value={f.desc} onChange={(e) => setF({ ...f, desc: e.target.value })} />
                    <div className="flex gap-2">
                      <input className={`${box} w-2/5`} placeholder="Header" value={f.header} onChange={(e) => setF({ ...f, header: e.target.value })} />
                      <input className={box} type="password" placeholder="Key / “Bearer …”" value={f.value} onChange={(e) => setF({ ...f, value: e.target.value })} />
                    </div>
                  </>
                )}
                <button onClick={addCustom} disabled={busy === "custom"} className="rounded-md bg-white px-3 py-1.5 text-xs font-medium text-bg hover:opacity-90 disabled:opacity-50">{busy === "custom" ? "Checking…" : "Test & connect"}</button>
                {msg.custom && <p className="text-[11px] text-muted">{msg.custom}</p>}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}