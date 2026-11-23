"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw, Search } from "lucide-react";
import { ServiceLogo } from "@/components/dashboard/ConnectCard";

// The "Browse all" list in Connectors: every remote MCP server we know, with logos, categories and one Connect button.
// Connect does the whole job through the Connectors window (onConnect): sign-in page, token box or a plain connect.

export type CatalogItem = {
  id: string; slug: string; title: string; description: string; url: string;
  auth: "oauth" | "token" | "none" | "auto"; domain: string; category: string; source: "seed" | "registry";
};
type Category = { id: string; label: string; count: number };
type Page = { total: number; all: number; entries: CatalogItem[]; categories: Category[]; updatedAt: number; fromRegistry: number; refreshing: boolean };

const PAGE = 30;

const authText = (a: CatalogItem["auth"]) => (a === "oauth" ? "Sign in with your account" : a === "token" ? "Needs a token / API key" : a === "none" ? "No key needed" : "Sign in or no key");

export default function McpCatalogBrowser({
  post, connected, busy, notes, onConnect, isOwner,
}: {
  post: (url: string, body: unknown) => Promise<{ res: Response; data: any }>;
  connected: (item: CatalogItem) => boolean;
  busy: string | null;
  notes: Record<string, string>;
  onConnect: (item: CatalogItem, token: string) => void;
  isOwner?: boolean;
}) {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("all");
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [meta, setMeta] = useState<Omit<Page, "entries"> | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [toks, setToks] = useState<Record<string, string>>({});
  const [syncMsg, setSyncMsg] = useState("");
  const seq = useRef(0);

  const load = useCallback(async (offset: number, replace: boolean) => {
    const mine = ++seq.current;
    setLoading(true); setErr("");
    try {
      const { res, data } = await post("/api/connectors/catalog", { action: "list", q, category: cat, offset, limit: PAGE });
      if (mine !== seq.current) return; // an older answer arriving late is ignored
      if (!res.ok) throw new Error(data.error || "The list could not be loaded.");
      const p = data as Page;
      setItems((old) => (replace ? p.entries : [...old, ...p.entries]));
      setMeta({ total: p.total, all: p.all, categories: p.categories, updatedAt: p.updatedAt, fromRegistry: p.fromRegistry, refreshing: p.refreshing });
    } catch (e) { if (mine === seq.current) setErr(e instanceof Error ? e.message : "The list could not be loaded."); }
    if (mine === seq.current) setLoading(false);
  }, [post, q, cat]);

  // typing waits a moment so every key press is not a request
  useEffect(() => { const h = setTimeout(() => void load(0, true), q ? 300 : 0); return () => clearTimeout(h); }, [load, q]);

  async function sync() {
    setSyncMsg("Reading the official registry…");
    try {
      const { res, data } = await post("/api/connectors/catalog", { action: "sync" });
      if (!res.ok) throw new Error(data.error || "Refresh failed.");
      setSyncMsg(data.ok ? `Done: ${data.count} servers from ${data.pages} pages${data.complete ? "" : " (partial: " + (data.error || "stopped early") + ")"}.` : `Not refreshed: ${data.skipped || data.error || "the registry did not answer"}.`);
      await load(0, true);
    } catch (e) { setSyncMsg(e instanceof Error ? e.message : "Refresh failed."); }
  }

  const box = "w-full rounded-md border border-line bg-bg px-3 py-1.5 text-xs text-ink placeholder:text-faint focus:border-gold";

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search size={13} className="pointer-events-none absolute left-2.5 top-2 text-faint" />
        <input className={box + " pl-8"} placeholder="Search apps: notion, stripe, postgres, calendar…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      <div className="flex flex-wrap gap-1.5">
        {[{ id: "all", label: "All", count: meta?.all ?? 0 }, ...(meta?.categories ?? [])].map((c) => (
          <button key={c.id} onClick={() => setCat(c.id)} className={`rounded-full border px-2.5 py-1 text-[11px] ${cat === c.id ? "border-white bg-white text-bg" : "border-line text-muted hover:text-ink"}`}>
            {c.label}{c.count ? ` · ${c.count}` : ""}
          </button>
        ))}
      </div>

      {meta && (
        <p className="text-[11px] leading-relaxed text-muted">
          {meta.total} {meta.total === 1 ? "server" : "servers"}{q || cat !== "all" ? " match" : ""}.
          {" "}{meta.fromRegistry > 0
            ? `${meta.fromRegistry} come from the official MCP registry${meta.updatedAt ? ` (updated ${new Date(meta.updatedAt).toLocaleDateString()})` : ""}.`
            : meta.refreshing ? "The full registry list is loading in the background: reopen this tab in a minute for more." : "Only the hand-picked list is available right now."}
          {isOwner && <button onClick={() => void sync()} className="ml-2 inline-flex items-center gap-1 text-gold underline"><RefreshCw size={10} /> Refresh now</button>}
        </p>
      )}
      {syncMsg && <p className="text-[11px] text-muted">{syncMsg}</p>}
      {err && <p className="text-[11px] text-red-400">{err}</p>}

      <div className="space-y-2">
        {items.map((h) => {
          const on = connected(h);
          return (
            <div key={h.id} className="rounded-md border border-line p-2.5">
              <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 items-start gap-2.5">
                  <ServiceLogo domain={h.domain} name={h.title} size={34} />
                  <div className="min-w-0">
                    <p className="truncate text-xs font-medium text-ink">
                      {h.title}
                      <span className={`ml-1.5 text-[10px] ${h.source === "seed" ? "text-gold" : "text-faint"}`}>{h.source === "seed" ? "popular" : "community"}</span>
                    </p>
                    {h.description && <p className="mt-0.5 line-clamp-2 text-[11px] leading-relaxed text-muted">{h.description}</p>}
                    <p className="mt-0.5 text-[10px] text-faint">{authText(h.auth)}</p>
                  </div>
                </div>
                {on ? <span className="shrink-0 text-[11px] text-avatar-teal">Connected</span> : (
                  <button
                    disabled={busy === h.url || (h.auth === "token" && !(toks[h.id] ?? "").trim() && h.source === "registry")}
                    onClick={() => onConnect(h, (toks[h.id] ?? "").trim())}
                    className="shrink-0 rounded-md bg-white px-2.5 py-1 text-[11px] font-medium text-bg disabled:opacity-50"
                  >{busy === h.url ? "Working…" : h.auth === "oauth" ? "Sign in" : "Connect"}</button>
                )}
              </div>
              {!on && h.auth === "token" && (
                <input type="password" placeholder="Token / API key for this service" value={toks[h.id] ?? ""} onChange={(e) => setToks((t) => ({ ...t, [h.id]: e.target.value }))} className={`${box} mt-2`} />
              )}
              {!on && h.source === "registry" && <p className="mt-1.5 text-[10px] leading-relaxed text-faint">Listed by its author in the public registry. It is checked when you connect, and anything it sends is treated as untrusted text. Write actions ask you first.</p>}
              {notes[h.url] && <p className="mt-1.5 text-[11px] text-muted">{notes[h.url]}</p>}
            </div>
          );
        })}
        {!loading && items.length === 0 && !err && <p className="text-[11px] text-muted">Nothing found. Try another word, or use the Custom tab to paste an MCP address.</p>}
      </div>

      {meta && items.length < meta.total && (
        <button disabled={loading} onClick={() => void load(items.length, false)} className="w-full rounded-md border border-line py-1.5 text-xs text-muted hover:text-ink disabled:opacity-50">{loading ? "Loading…" : `Show more (${meta.total - items.length} left)`}</button>
      )}
      {loading && items.length === 0 && <p className="text-[11px] text-muted">Loading…</p>}
    </div>
  );
}
