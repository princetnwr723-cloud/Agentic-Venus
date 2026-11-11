"use client";

// Chat card for a ```vleads block (made by the vmaps.leads tool): lead table, map, and CSV download / copy.
// The block is plain JSON; every field is checked here before it is shown or turned into a link.
import dynamic from "next/dynamic";
import { useMemo, useState, type ReactNode } from "react";
import { Check, Copy, Download, MapPin } from "lucide-react";
import { toCsv, type LeadRow } from "@/lib/vmaps/csv";
import type { VMapSpec } from "./VMapView";

const View = dynamic(() => import("./VMapView"), {
  ssr: false,
  loading: () => <div className="flex h-72 items-center justify-center bg-bg text-xs text-faint"><span className="animate-pulse">Loading map…</span></div>,
});

const str = (v: unknown, n = 160) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const okGeo = (lat: unknown, lon: unknown) => Number.isFinite(Number(lat)) && Number.isFinite(Number(lon)) && Math.abs(Number(lat)) <= 90 && Math.abs(Number(lon)) <= 180;

function web(v: unknown): string | undefined {
  try {
    const u = new URL(str(v, 200));
    return /^https?:$/.test(u.protocol) && u.hostname.includes(".") ? u.toString() : undefined;
  } catch { return undefined; }
}
const mail = (v: unknown) => { const t = str(v, 120).toLowerCase(); return /^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,24}$/.test(t) ? t : undefined; };
const tel = (v: unknown) => { const t = str(v, 24).replace(/[^0-9+()\-\s]/g, "").trim(); return t.replace(/\D/g, "").length >= 6 ? t : undefined; };

export function normLeads(raw: any): { title: string; rows: LeadRow[] } | null {
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.leads)) return null;
  const rows: LeadRow[] = raw.leads
    .filter((l: any) => l && str(l.name) && okGeo(l.lat, l.lon))
    .slice(0, 12)
    .map((l: any) => ({
      name: str(l.name, 100), lat: Number(l.lat), lon: Number(l.lon),
      distM: Number.isFinite(Number(l.distM)) ? Math.round(Number(l.distM)) : undefined,
      address: str(l.address, 120) || undefined, phone: tel(l.phone), website: web(l.website), email: mail(l.email), about: str(l.about, 200) || undefined,
    }));
  return rows.length ? { title: str(raw.title, 90) || "Leads", rows } : null;
}

const dist = (m?: number) => (m === undefined ? "" : m < 950 ? `${Math.max(10, Math.round(m / 10) * 10)} m` : `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`);
const host = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u; } };

export default function VLeadsCard({ code, fallback }: { code: string; fallback: ReactNode }) {
  const data = useMemo(() => {
    try { return normLeads(JSON.parse(code)); } catch { return null; }
  }, [code]);
  const [copied, setCopied] = useState(false);
  if (!data) return <>{fallback}</>;

  const { title, rows } = data;
  const spec: VMapSpec = {
    title,
    markers: rows.map((r) => ({ name: r.name, lat: r.lat, lon: r.lon, note: [dist(r.distM), r.phone].filter(Boolean).join(" · ") || undefined })),
  };
  const withPhone = rows.filter((r) => r.phone).length, withEmail = rows.filter((r) => r.email).length, withSite = rows.filter((r) => r.website).length;

  const download = () => {
    const blob = new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `leads-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "list"}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 4000);
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(toCsv(rows)); setCopied(true); window.setTimeout(() => setCopied(false), 1800); } catch { /* the download button still works */ }
  };

  const btn = "inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium text-ink hover:bg-bg";
  return (
    <div className="my-2 overflow-hidden rounded-xl border border-line bg-panel" style={{ width: "40rem", maxWidth: "100%" }}>
      <div className="flex items-start gap-2 px-4 pt-3">
        <MapPin className="mt-0.5 h-4 w-4 text-faint" />
        <div className="min-w-0 flex-1">
          <div className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-faint">Vmaps leads</div>
          <div className="truncate text-[15px] font-semibold text-ink">{title}</div>
          <div className="text-xs text-faint">{rows.length} leads · {withPhone} phone · {withEmail} email · {withSite} website</div>
        </div>
      </div>
      <div className="flex gap-2 px-4 pt-3">
        <button type="button" onClick={download} className={btn}><Download className="h-3.5 w-3.5" /> Download CSV</button>
        <button type="button" onClick={copy} className={btn}>{copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />} {copied ? "Copied" : "Copy CSV"}</button>
      </div>
      <div className="mt-3"><View spec={spec} /></div>
      <ol className="divide-y divide-line">
        {rows.map((r, i) => (
          <li key={`${i}-${r.lat}-${r.lon}`} className="flex gap-3 px-4 py-3 text-[13px] text-ink">
            <span className="w-4 shrink-0 pt-0.5 text-right text-faint">{i + 1}</span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-semibold">{r.name}</span>
                {r.distM !== undefined && <span className="text-xs text-faint">{dist(r.distM)}</span>}
              </div>
              {r.about && <div className="mt-0.5 text-faint">{r.about}</div>}
              {r.address && <div className="text-xs text-faint">{r.address}</div>}
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                {r.phone && <a className="underline" href={`tel:${r.phone.replace(/[^0-9+]/g, "")}`}>{r.phone}</a>}
                {r.email && <a className="break-all underline" href={`mailto:${r.email}`}>{r.email}</a>}
                {r.website && <a className="break-all underline" target="_blank" rel="noopener noreferrer" href={r.website}>{host(r.website)}</a>}
                {!r.phone && !r.email && !r.website && <span className="text-faint">no contact details found</span>}
              </div>
            </div>
          </li>
        ))}
      </ol>
      <div className="border-t border-line px-4 py-2 text-[11px] text-faint">
        Map data © OpenStreetMap contributors and each business&apos;s own website. Details can be outdated: check them, and follow spam and data-protection rules before contacting anyone.
      </div>
    </div>
  );
}
