"use client";

import { useEffect, useState } from "react";
import { ExternalLink, Search, X } from "lucide-react";
import { FREE_PACK, PLUGINS, safeId } from "@/lib/tools/catalog";
import { OAUTH_PROVIDERS } from "@/lib/tools/oauth-catalog";
import { apiPayload, findPreset } from "@/lib/tools/api-presets";
import { brandDomain } from "@/lib/tools/brand";
import { ServiceLogo } from "@/components/dashboard/ConnectCard";

type TestResult = { ok: boolean; label?: string; error?: string; needsOAuth?: boolean; resourceMetadata?: string };
type Hit = { name: string; title: string; description: string; url: string; auth: "oauth" | "token" | "none"; source: string };
type CustomInfo = { type: "mcp" | "api"; host: string; url?: string; oauth: boolean };
type Status = { broken: string[]; accounts: Record<string, string>; custom: Record<string, CustomInfo> };

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");
const hostOf = (u: string) => { try { return new URL(u).hostname; } catch { return ""; } };

function AutoToggle({ on, label, onChange }: { on: boolean; label: string; onChange: () => void }) {
  return (
    <label className="mt-2 flex cursor-pointer items-center gap-2 text-[11px] text-muted">
      <input type="checkbox" checked={on} onChange={onChange} />
      {label}
    </label>
  );
}

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
  // Custom form: a name plus ONE thing (an MCP address or an API key). Everything else is optional.
  const [name, setName] = useState("");
  const [mcpUrl, setMcpUrl] = useState("");
  const [mcpToken, setMcpToken] = useState("");
  const [showTok, setShowTok] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [header, setHeader] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [searching, setSearching] = useState(false);
  const [toks, setToks] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<Status>({ broken: [], accounts: {}, custom: {} });
  const [hint, setHint] = useState("");

  async function callStatus(sync: boolean) {
    try {
      const token = await getToken();
      const res = await fetch("/api/connectors/status", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ chatId, sync }) });
      const d = await res.json();
      if (res.ok) setStatus({ broken: d.broken ?? [], accounts: d.accounts ?? {}, custom: d.custom ?? {} });
    } catch { /* the window still works without it */ }
  }
  useEffect(() => { if (open) void callStatus(false); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [open, chatId, connectors]);
  const close = () => { void callStatus(true); onClose(); }; // posts "Agent updated" in the chat if something changed

  // Type a tool's name: matching MCP servers appear (small typos are fine).
  useEffect(() => {
    if (!open || tab !== "custom" || ctype !== "mcp" || name.trim().length < 2) { setHits([]); return; }
    const h = setTimeout(async () => {
      setSearching(true);
      try { setHits(await searchMcp(name)); } catch { setHits([]); }
      setSearching(false);
    }, 400);
    return () => clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, tab, ctype, open]);

  if (!open) return null;

  const box = "w-full rounded-md border border-line bg-bg px-3 py-1.5 text-xs text-ink placeholder:text-faint focus:border-gold";
  const say = (id: string, m: string) => setMsg((x) => ({ ...x, [id]: m }));

  async function authedPost(url: string, body: unknown) {
    const token = await getToken();
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
    return { res, data: await res.json().catch(() => ({})) };
  }

  async function searchMcp(q: string): Promise<Hit[]> {
    const { data } = await authedPost("/api/connectors/mcp-search", { q });
    return Array.isArray(data.results) ? data.results : [];
  }

  async function startOAuth(provider: string) {
    setBusy(provider); say(provider, "");
    try {
      const { res, data } = await authedPost("/api/connectors/oauth/start", { provider, chatId, hint: hint.trim() || undefined });
      if (!res.ok || !data.url) throw new Error(data.error || "Could not start OAuth.");
      window.location.assign(data.url);
    } catch (e) { say(provider, e instanceof Error ? e.message : "OAuth could not start."); setBusy(null); }
  }

  // Sign in to an MCP server (no developer app needed: the server registers us automatically).
  async function startMcpOAuth(kind: string, url: string, id: string, resourceMetadata?: string) {
    setBusy(id); say(id, "Opening the sign-in page…");
    try {
      const { res, data } = await authedPost("/api/connectors/mcp-oauth/start", { name: kind.slice(4), url, chatId, resourceMetadata });
      if (!res.ok || !data.url) throw new Error(data.error || "Sign-in could not start.");
      window.location.assign(data.url);
    } catch (e) { say(id, e instanceof Error ? e.message : "Sign-in could not start."); setBusy(null); }
  }

  async function connect(kind: string, token: string, id = kind): Promise<TestResult> {
    setBusy(id);
    say(id, "");
    let r: TestResult;
    try { r = await onTest(kind, token); } catch { r = { ok: false, error: "Could not check it." }; }
    if (r.ok) {
      await onSave(kind, token);
      await callStatus(true);
      say(id, r.label ? `Connected · ${r.label}` : "Connected. The agent can use it now.");
    } else if (r.needsOAuth && kind.startsWith("mcp:")) {
      let url = "";
      try { url = (JSON.parse(token) as { url?: string }).url ?? ""; } catch { /* ignore */ }
      if (url) { await startMcpOAuth(kind, url, id, r.resourceMetadata); return r; }
      say(id, r.error || "Sign-in required.");
    } else say(id, r.error || "Not accepted.");
    setBusy(null);
    return r;
  }

  const custom = Object.keys(connectors).filter((k) => k.startsWith("mcp:") || k.startsWith("api:"));
  const preset = ctype === "api" ? findPreset(name) : undefined;
  const needsBase = ctype === "api" && name.trim().length > 0 && !preset;

  // MCP: a name is enough for known tools. The server's own sign-in page does the rest.
  async function addMcp() {
    const nm = name.trim();
    let url = mcpUrl.trim();
    const tk = mcpToken.trim();
    if (!nm && !url) return say("custom", "Type the tool's name, for example canva.");
    setBusy("custom"); say("custom", "Looking it up…");
    let idName = nm;
    let auth: Hit["auth"] | undefined;
    if (!url) {
      let found: Hit[] = [];
      try { found = await searchMcp(nm); } catch { /* handled below */ }
      const q = norm(nm);
      const hit = found.find((h) => norm(h.name) === q || norm(h.title) === q) ?? found.find((h) => h.source === "popular") ?? (found.length === 1 ? found[0] : undefined);
      if (!hit) { say("custom", `I could not find “${nm}”. Paste its MCP address in the second box.`); setBusy(null); return; }
      url = hit.url; idName = hit.name; auth = hit.auth;
    } else if (!idName) idName = brandDomain(hostOf(url)).split(".")[0] || "mcp";
    const kind = `mcp:${safeId(idName)}`;
    if (!tk && auth === "oauth") { await startMcpOAuth(kind, url, "custom"); return; }
    const r = await connect(kind, JSON.stringify({ url, auth: tk || undefined }), "custom");
    if (r.ok) { setName(""); setMcpUrl(""); setMcpToken(""); setShowTok(false); }
  }

  // API key: connects directly. The check afterwards only reports; it never blocks.
  async function addApi() {
    const nm = name.trim();
    const key = apiKey.trim();
    if (!nm || !key) return say("custom", "Type the service name and paste the API key.");
    let payload;
    try { payload = apiPayload({ name: nm, key, preset, baseUrl, header }); }
    catch (e) { return say("custom", e instanceof Error ? e.message : "Check the fields."); }
    const kind = `api:${safeId(preset?.id ?? nm)}`;
    const body = JSON.stringify(payload);
    setBusy("custom"); say("custom", "Connecting…");
    try { await onSave(kind, body); } catch { say("custom", "Could not save it."); setBusy(null); return; }
    setApiKey(""); setName(""); setBaseUrl(""); setHeader("");
    say("custom", "Connected. Checking the key…");
    let r: TestResult;
    try { r = await onTest(kind, body); } catch { r = { ok: false, error: "Could not check the key." }; }
    await callStatus(true);
    say("custom", r.ok ? `Connected · key accepted${r.label ? " (" + r.label + ")" : ""}.` : `Connected, but check the key: ${r.error || "the service did not accept it."}`);
    setBusy(null);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4" onClick={close}>
      <div className="max-h-[88vh] w-full max-w-lg overflow-y-auto rounded-xl2 border border-line bg-panel p-6" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-medium text-ink">Connectors · {chatName}</h2>
          <button onClick={close} className="rounded-full p-1.5 text-muted hover:bg-panel2 hover:text-ink"><X size={18} /></button>
        </div>
        <div className="mb-4 flex rounded-full border border-line bg-panel2 p-1 text-xs">
          {([["plugins", "Plugins & chat apps"], ["custom", "Custom · MCP / API"]] as const).map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)} className={`flex-1 rounded-full px-3 py-1.5 ${tab === k ? "bg-white font-medium text-bg" : "text-muted"}`}>{l}</button>
          ))}
        </div>
        <p className="mb-4 text-xs leading-relaxed text-muted">Only this chat can use these. Tokens are stored encrypted. Once connected, the agent automatically knows its tools and when to use them. Anything that sends or changes something outside asks for your approval first. You can also just write in the chat: “connect Canva”.</p>

        {tab === "plugins" ? (
          <div className="space-y-3">
            <div className="rounded-lg border border-line p-3">
              <div className="flex items-center justify-between"><span className="text-sm text-ink">{FREE_PACK.label}</span><span className="text-[11px] text-avatar-teal">Always on</span></div>
              <p className="mt-1 text-[11px] text-muted">{FREE_PACK.note}</p>
              <p className="mt-1.5 font-mono text-[10.5px] leading-relaxed text-faint">{FREE_PACK.tools.join(" · ")}</p>
            </div>

            <div className="rounded-lg border border-line p-3">
              <div className="mb-1 flex items-center justify-between"><span className="text-sm font-medium text-ink">OAuth apps</span><span className="text-[10px] text-muted">Official authorization</span></div>
              <p className="mb-3 text-[11px] leading-relaxed text-muted">Connect without pasting your password or token. Each provider needs its app credentials set by the site owner in Vercel. After scopes change, press Reconnect.</p>
              <input className={box + " mb-2"} placeholder="Account to use, e.g. you@gmail.com (optional but recommended)" value={hint} onChange={(e) => setHint(e.target.value)} />
              {status.broken.length > 0 && <p className="mb-2 rounded-md border border-red-900/60 bg-red-950/30 p-2 text-[11px] text-red-200">These connections can&apos;t be opened any more: <b>{status.broken.join(", ")}</b>. Press Reconnect, or Disconnect and connect again.</p>}
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {OAUTH_PROVIDERS.map((p) => {
                  const on = Boolean(connectors[`oauth:${p.id}`]);
                  return (
                    <div key={p.id} className="rounded-md border border-line p-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs text-ink">{p.label}</span>
                        {on ? <span className="text-[10px] text-avatar-teal">{status.broken.includes(`oauth:${p.id}`) ? "Needs reconnect" : `Connected${status.accounts[p.id] ? " as " + status.accounts[p.id] : ""}`}</span> : <button disabled={busy === p.id} onClick={() => void startOAuth(p.id)} className="rounded-md bg-white px-2 py-1 text-[10px] font-medium text-bg disabled:opacity-50">{busy === p.id ? "Opening…" : "Connect"}</button>}
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
                      {hasWrite && <AutoToggle on={connectors["auto:" + p.id] === "1"} label="Don't ask before write actions (✎) — only if you trust this chat" onChange={() => onSave("auto:" + p.id, connectors["auto:" + p.id] === "1" ? "" : "1")} />}
                    </>
                  ) : (
                    <div className="mt-2 space-y-2">
                      {p.fields.map((fl, i) => (
                        <input key={fl.key} type={fl.secret ? "password" : "text"} placeholder={fl.placeholder} value={vals[i]} onChange={(e) => setDrafts((d) => ({ ...d, [p.id]: vals.map((v, j) => (j === i ? e.target.value : v)) }))} className={box} />
                      ))}
                      <button
                        disabled={busy === p.id || vals.some((v) => !v.trim())}
                        onClick={async () => { const r = await connect(p.id, vals.map((v) => v.trim()).join("::") || "on"); if (r.ok) setDrafts((d) => ({ ...d, [p.id]: p.fields.map(() => "") })); }}
                        className="rounded-md bg-white px-3 py-1.5 text-xs font-medium text-bg hover:opacity-90 disabled:opacity-50"
                      >{busy === p.id ? "Checking…" : p.fields.length === 0 ? "Turn on" : "Connect"}</button>
                    </div>
                  )}
                  {msg[p.id] && <p className="mt-1.5 whitespace-pre-wrap break-words text-[11px] text-muted">{msg[p.id]}</p>}
                </div>
              );
            })}

            <div className="rounded-lg border border-dashed border-line p-3 text-[11px] leading-relaxed text-muted">
              Need <b className="text-ink">Notion, Linear, Stripe, Sentry</b> or any other service? Open the <b className="text-ink">Custom</b> tab and type its name, or just tell the agent in the chat: <b className="text-ink">“connect Notion”</b>.
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {custom.map((k) => {
              const info = status.custom[k];
              const label = k.slice(4);
              const broken = status.broken.includes(k);
              return (
                <div key={k} className="rounded-lg border border-line p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <ServiceLogo domain={info?.host ? brandDomain(info.host) : label} name={label} size={28} />
                      <div className="min-w-0">
                        <p className="truncate text-sm text-ink">{k.startsWith("mcp:") ? "MCP" : "API"} · {label}</p>
                        {info?.host && <p className="truncate text-[10px] text-faint">{info.host}</p>}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      {broken && <span className="text-[10px] text-red-300">Needs reconnect</span>}
                      {k.startsWith("mcp:") && info?.oauth && info.url && (
                        <button disabled={busy === k} onClick={() => void startMcpOAuth(k, info.url as string, k)} className="text-[11px] text-gold underline disabled:opacity-50">Reconnect</button>
                      )}
                      <button onClick={() => onSave(k, "")} className="text-xs text-faint hover:text-red-400">Disconnect</button>
                    </div>
                  </div>
                  <AutoToggle on={connectors["auto:" + k] === "1"} label="Don't ask before write actions" onChange={() => onSave("auto:" + k, connectors["auto:" + k] === "1" ? "" : "1")} />
                  {msg[k] && <p className="mt-1.5 text-[11px] text-muted">{msg[k]}</p>}
                </div>
              );
            })}

            <div className="rounded-lg border border-line p-3">
              <div className="mb-3 flex gap-1.5">
                {(["mcp", "api"] as const).map((t) => (
                  <button key={t} onClick={() => { setCtype(t); say("custom", ""); }} className={`rounded-full border px-3 py-1 text-xs ${ctype === t ? "border-white bg-white text-bg" : "border-line text-muted"}`}>{t === "mcp" ? "MCP · sign in" : "API key · direct"}</button>
                ))}
              </div>

              <div className="space-y-2">
                <input className={box} placeholder={ctype === "mcp" ? "Name, e.g. canva, notion, linear" : "Name, e.g. stripe, openai, github"} value={name} onChange={(e) => setName(e.target.value)} />

                {ctype === "mcp" ? (
                  <>
                    <input className={box} placeholder="MCP address (leave empty for known tools)" value={mcpUrl} onChange={(e) => setMcpUrl(e.target.value)} />
                    {showTok
                      ? <input className={box} type="password" placeholder="Token or header like “X-Api-Key: abc” (only if the server has no sign-in)" value={mcpToken} onChange={(e) => setMcpToken(e.target.value)} />
                      : <button type="button" onClick={() => setShowTok(true)} className="text-[11px] text-faint underline hover:text-muted">The server uses a token, not a sign-in</button>}
                    <button onClick={addMcp} disabled={busy === "custom"} className="rounded-md bg-white px-3 py-1.5 text-xs font-medium text-bg hover:opacity-90 disabled:opacity-50">{busy === "custom" ? "Working…" : "Connect"}</button>
                    <p className="text-[11px] leading-relaxed text-muted">If the service has a sign-in, its official login page opens. You approve there; no password is typed here.</p>
                  </>
                ) : (
                  <>
                    <input className={box} type="password" placeholder="API key" value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
                    {needsBase && (
                      <>
                        <input className={box} placeholder="Base URL, e.g. https://api.example.com/v1" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
                        <input className={box} placeholder="Header name (optional, default Authorization)" value={header} onChange={(e) => setHeader(e.target.value)} />
                      </>
                    )}
                    {preset && <p className="text-[11px] text-avatar-teal">Known service: {preset.label}. Only the key is needed.</p>}
                    {needsBase && <p className="text-[11px] text-muted">I do not know this service yet, so I need its address once.</p>}
                    <button onClick={addApi} disabled={busy === "custom"} className="rounded-md bg-white px-3 py-1.5 text-xs font-medium text-bg hover:opacity-90 disabled:opacity-50">{busy === "custom" ? "Connecting…" : "Connect"}</button>
                    <p className="text-[11px] leading-relaxed text-muted">The key connects right away and is stored encrypted. The agent gets one request tool limited to that service: GET is free, POST/PUT/PATCH/DELETE ask for approval.</p>
                  </>
                )}
                {msg.custom && <p className="text-[11px] text-muted">{msg.custom}</p>}
              </div>

              {ctype === "mcp" && name.trim().length >= 2 && (
                <div className="mt-3">
                  {searching && <p className="text-[11px] text-muted">Searching…</p>}
                  {!searching && hits.length === 0 && <p className="text-[11px] text-muted">Nothing found for “{name}”. If you know the server address, paste it above.</p>}
                  <div className="mt-1 space-y-2">
                    {hits.slice(0, 6).map((h) => {
                      const kind = `mcp:${safeId(h.name)}`;
                      const on = Boolean(connectors[kind]);
                      return (
                        <div key={h.url} className="rounded-md border border-line p-2.5">
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex min-w-0 items-start gap-2.5">
                              <ServiceLogo domain={brandDomain(hostOf(h.url))} name={h.title} size={30} />
                              <div className="min-w-0">
                                <p className="truncate text-xs font-medium text-ink">{h.title}{h.source === "popular" && <span className="ml-1.5 text-[10px] text-gold">popular</span>}</p>
                                <p className="mt-0.5 text-[11px] leading-relaxed text-muted">{h.description}</p>
                                <p className="mt-0.5 text-[10px] text-faint">{h.auth === "oauth" ? "Sign in with your account" : h.auth === "token" ? "Needs a token / API key" : "No key needed"}</p>
                              </div>
                            </div>
                            {on ? <span className="shrink-0 text-[11px] text-avatar-teal">Connected</span> : (
                              <button
                                disabled={busy === h.url}
                                onClick={() => h.auth === "oauth" ? void startMcpOAuth(kind, h.url, h.url) : void connect(kind, JSON.stringify({ url: h.url, auth: toks[h.url]?.trim() || undefined }), h.url)}
                                className="shrink-0 rounded-md bg-white px-2.5 py-1 text-[11px] font-medium text-bg disabled:opacity-50"
                              >{busy === h.url ? "Working…" : h.auth === "oauth" ? "Sign in" : "Connect"}</button>
                            )}
                          </div>
                          {!on && h.auth === "token" && <input type="password" placeholder="Token / API key for this service" value={toks[h.url] ?? ""} onChange={(e) => setToks((t) => ({ ...t, [h.url]: e.target.value }))} className={`${box} mt-2`} />}
                          {msg[h.url] && <p className="mt-1.5 text-[11px] text-muted">{msg[h.url]}</p>}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
