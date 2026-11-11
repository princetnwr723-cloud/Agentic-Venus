"use client";

// Chat card for a ```vmap block (made by the vmaps.* agent tools). The model never writes HTML: it only sends JSON
// with pins and an optional route; the map itself is drawn by our own code. Bad JSON falls back to plain code.
import dynamic from "next/dynamic";
import { useMemo, type ReactNode } from "react";
import { MapPin } from "lucide-react";
import type { VMapMarker, VMapSpec } from "./VMapView";

const View = dynamic(() => import("./VMapView"), {
  ssr: false,
  loading: () => <div className="flex h-72 items-center justify-center bg-bg text-xs text-faint"><span className="animate-pulse">Loading map…</span></div>,
});

const str = (v: unknown, n = 120) => String(v ?? "").trim().slice(0, n);
const ok = (lat: unknown, lon: unknown) => Number.isFinite(Number(lat)) && Number.isFinite(Number(lon)) && Math.abs(Number(lat)) <= 90 && Math.abs(Number(lon)) <= 180;

export function normVMap(raw: any): VMapSpec | null {
  if (!raw || typeof raw !== "object") return null;
  const markers: VMapMarker[] = (Array.isArray(raw.markers) ? raw.markers : [])
    .filter((m: any) => m && ok(m.lat, m.lon))
    .slice(0, 12)
    .map((m: any) => ({
      name: str(m.name, 80) || "Place", lat: Number(m.lat), lon: Number(m.lon), note: str(m.note, 120) || undefined,
      role: m.role === "center" || m.role === "start" || m.role === "end" ? m.role : undefined,
    }));
  const rc = raw.route && Array.isArray(raw.route.coords) ? raw.route.coords : [];
  const coords = rc.filter((c: any) => Array.isArray(c) && ok(c[0], c[1])).slice(0, 300).map((c: any): [number, number] => [Number(c[0]), Number(c[1])]);
  const route = coords.length > 1 ? { coords, km: Number(raw.route.km) || 0, min: Number(raw.route.min) || 0, mode: str(raw.route.mode, 12) } : undefined;
  if (!markers.length && !route) return null;
  return { title: str(raw.title, 90) || "Map", markers, route };
}

const mins = (m: number) => (m < 60 ? `${Math.max(1, Math.round(m))} min` : `${Math.floor(m / 60)} h ${Math.round(m % 60)} min`);

export default function VMapCard({ code, fallback }: { code: string; fallback: ReactNode }) {
  const spec = useMemo(() => {
    try { return normVMap(JSON.parse(code)); } catch { return null; }
  }, [code]);
  if (!spec) return <>{fallback}</>;

  let n = 0;
  const list = spec.markers.filter((m) => !m.role).map((m) => ({ i: ++n, m }));
  const first = spec.markers[0];
  return (
    <div className="my-2 overflow-hidden rounded-xl border border-line bg-panel" style={{ width: "34rem", maxWidth: "100%" }}>
      <div className="flex items-center gap-2 px-4 pt-3">
        <MapPin className="h-4 w-4 text-faint" />
        <div className="min-w-0 flex-1">
          <div className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-faint">Vmaps</div>
          <div className="truncate text-[15px] font-semibold text-ink">{spec.title}</div>
        </div>
        {spec.route && spec.route.km > 0 && (
          <div className="shrink-0 text-right text-xs text-ink">
            <div className="font-semibold">{spec.route.km} km</div>
            <div className="text-faint">{mins(spec.route.min)}</div>
          </div>
        )}
      </div>
      <div className="mt-3"><View spec={spec} /></div>
      {list.length > 0 && (
        <ol className="space-y-1 px-4 py-3 text-[13px] text-ink">
          {list.map(({ i, m }) => (
            <li key={`${i}-${m.lat}-${m.lon}`} className="flex gap-2">
              <span className="w-4 shrink-0 text-right text-faint">{i}</span>
              <span className="min-w-0"><span className="font-medium">{m.name}</span>{m.note ? <span className="text-faint"> · {m.note}</span> : null}</span>
            </li>
          ))}
        </ol>
      )}
      {first && (
        <div className="border-t border-line px-4 py-2 text-[11px] text-faint">
          Map data © OpenStreetMap contributors ·{" "}
          <a className="underline" target="_blank" rel="noopener noreferrer" href={`https://www.openstreetmap.org/?mlat=${first.lat}&mlon=${first.lon}#map=15/${first.lat}/${first.lon}`}>open in OpenStreetMap</a>
        </div>
      )}
    </div>
  );
}
