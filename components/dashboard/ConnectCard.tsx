"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, ExternalLink } from "lucide-react";

/** What the server puts into a ```connect block (see lib/tools/connect.ts). */
export type ConnectCardData = { v: 1; via: "oauth" | "mcp"; key: string; name: string; domain: string; u: string; n: string; chatId: string };

const BLOCK = /^```connect\n([\s\S]*?)\n```\s*$/;

/** A message that is exactly one connect block becomes a card. Anything malformed stays an ordinary message. */
export function parseConnectCard(text: string): ConnectCardData | null {
  const m = BLOCK.exec(text.trim());
  if (!m) return null;
  try {
    const j = JSON.parse(m[1]) as Partial<ConnectCardData>;
    if (j.v !== 1 || (j.via !== "oauth" && j.via !== "mcp")) return null;
    if (typeof j.key !== "string" || !/^(mcp|oauth):[a-z0-9_]{1,40}$/.test(j.key)) return null;
    if (typeof j.name !== "string" || j.name.length > 80) return null;
    if (typeof j.domain !== "string" || !/^[a-z0-9.-]{3,80}$/i.test(j.domain)) return null;
    if (typeof j.u !== "string" || !/^[A-Za-z0-9_-]{6,128}$/.test(j.u)) return null;
    if (typeof j.n !== "string" || !/^[a-f0-9]{36}$/.test(j.n)) return null;
    if (typeof j.chatId !== "string" || !/^[A-Za-z0-9_-]{4,160}$/.test(j.chatId)) return null;
    return { v: 1, via: j.via, key: j.key, name: j.name, domain: j.domain.toLowerCase(), u: j.u, n: j.n, chatId: j.chatId };
  } catch { return null; }
}

/** The service's logo: its site icon, then a second icon service, then the first letter. */
export function ServiceLogo({ domain, name, size = 44 }: { domain: string; name: string; size?: number }) {
  const [step, setStep] = useState(0);
  const src = step === 0 ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128` : step === 1 ? `https://icons.duckduckgo.com/ip3/${encodeURIComponent(domain)}.ico` : "";
  if (!src) {
    return <div style={{ width: size, height: size }} className="flex shrink-0 items-center justify-center rounded-xl border border-line bg-panel text-base font-semibold text-gold" aria-hidden="true">{(name || "?").slice(0, 1).toUpperCase()}</div>;
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt="" width={size} height={size} referrerPolicy="no-referrer" onError={() => setStep((s) => s + 1)} style={{ width: size, height: size }} className="shrink-0 rounded-xl border border-line bg-white object-contain p-1.5" />
  );
}

export default function ConnectCard({ card }: { card: ConnectCardData }) {
  const [clicked, setClicked] = useState(false);
  const [connected, setConnected] = useState(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  async function check(): Promise<boolean> {
    try {
      const res = await fetch("/api/connectors/status", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chatId: card.chatId, light: true }) });
      if (!res.ok) return false;
      const d = (await res.json()) as { connected?: string[] };
      return Array.isArray(d.connected) && d.connected.includes(card.key);
    } catch { return false; }
  }

  // Already connected (an old card in the history)?
  useEffect(() => { void check().then((ok) => { if (ok && alive.current) setConnected(true); }); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  // After the click: look every 3 seconds for up to 6 minutes until the sign-in is finished.
  useEffect(() => {
    if (!clicked || connected) return;
    let n = 0;
    const t = setInterval(async () => {
      n += 1;
      if (await check()) { if (alive.current) setConnected(true); clearInterval(t); }
      else if (n >= 120) clearInterval(t);
    }, 3000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clicked, connected]);

  const href = `/api/connectors/mcp-oauth/go?u=${encodeURIComponent(card.u)}&n=${encodeURIComponent(card.n)}`;
  return (
    <div className="w-full min-w-[240px] max-w-sm">
      <div className="flex items-center gap-3">
        <ServiceLogo domain={card.domain} name={card.name} />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-ink">{card.name}</p>
          <p className="truncate text-[11px] text-muted">{card.via === "oauth" ? "Official sign-in" : "MCP · sign in with your account"} · {card.domain}</p>
        </div>
      </div>
      {connected ? (
        <p className="mt-3 flex items-center gap-1.5 text-xs text-avatar-teal"><CheckCircle2 size={15} /> Connected. The agent can use {card.name} now.</p>
      ) : (
        <>
          <a
            href={href} target="_blank" rel="noopener noreferrer" onClick={() => setClicked(true)}
            className="mt-3 inline-flex items-center gap-1.5 rounded-md bg-white px-3.5 py-2 text-xs font-medium text-bg hover:opacity-90"
          >
            Connect {card.name} <ExternalLink size={12} />
          </a>
          <p className="mt-2 text-[11px] leading-relaxed text-muted">
            {clicked ? "Finish signing in on the new tab. This turns green by itself when it is done." : "A new tab opens on the official page. You sign in there; the agent never sees your password."}
          </p>
        </>
      )}
    </div>
  );
}
