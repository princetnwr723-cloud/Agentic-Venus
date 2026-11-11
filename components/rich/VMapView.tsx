"use client";

// The real map (Leaflet). Loaded only in the browser through VMapCard. Tiles come from OUR server (/api/vmaps/tiles),
// so the map works on a VM / local network with no outside map host, key or billing.
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { useEffect, useRef } from "react";

export type VMapMarker = { name: string; lat: number; lon: number; note?: string; role?: "center" | "start" | "end" };
export type VMapSpec = {
  title: string;
  markers: VMapMarker[];
  route?: { coords: Array<[number, number]>; km: number; min: number; mode: string };
};

const TEAL = "#3FC9AE";
const GOLD = "#E7B24D";
const RED = "#F08A5E";

function pin(label: string, color: string, dark = true): L.DivIcon {
  const el = document.createElement("div");
  el.textContent = label;
  el.style.cssText =
    `width:26px;height:26px;border-radius:50%;background:${color};color:${dark ? "#0b0b0d" : "#fff"};border:2px solid #fff;` +
    "box-shadow:0 1px 5px rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;font:700 12px/1 system-ui,sans-serif;";
  return L.divIcon({ html: el, className: "", iconSize: [26, 26], iconAnchor: [13, 13], popupAnchor: [0, -14] });
}

function popup(m: VMapMarker): HTMLElement {
  const box = document.createElement("div");
  const b = document.createElement("b");
  b.textContent = m.name;
  box.appendChild(b);
  if (m.note) { box.appendChild(document.createElement("br")); box.appendChild(document.createTextNode(m.note)); }
  return box;
}

/** Numbers for ordinary pins (1, 2, 3 ...); centre / start / end pins have their own look. */
export function pinLabels(markers: VMapMarker[]): string[] {
  let n = 0;
  return markers.map((m) => (m.role === "start" ? "A" : m.role === "end" ? "B" : m.role === "center" ? "•" : String(++n)));
}

export default function VMapView({ spec }: { spec: VMapSpec }) {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const touch = L.Browser.mobile;
    // on a phone one finger scrolls the chat; two fingers move / zoom the map
    const map = L.map(el, { scrollWheelZoom: false, dragging: !touch, zoomControl: true, attributionControl: true, worldCopyJump: true });
    L.tileLayer("/api/vmaps/tiles/{z}/{x}/{y}", { maxZoom: 19, attribution: "© OpenStreetMap contributors" }).addTo(map);

    const pts: Array<[number, number]> = [];
    if (spec.route && spec.route.coords.length > 1) {
      L.polyline(spec.route.coords, { color: "#0b0b0d", weight: 8, opacity: 0.35 }).addTo(map);
      L.polyline(spec.route.coords, { color: TEAL, weight: 5, opacity: 0.95 }).addTo(map);
      pts.push(...spec.route.coords);
    }
    const labels = pinLabels(spec.markers);
    spec.markers.forEach((m, i) => {
      const color = m.role === "start" ? "#7FBF93" : m.role === "end" ? RED : m.role === "center" ? GOLD : TEAL;
      L.marker([m.lat, m.lon], { icon: pin(labels[i], color), title: m.name, riseOnHover: true }).addTo(map).bindPopup(popup(m));
      pts.push([m.lat, m.lon]);
    });

    if (pts.length > 1) map.fitBounds(L.latLngBounds(pts), { padding: [28, 28], maxZoom: 17 });
    else if (pts.length === 1) map.setView(pts[0], 15);
    else map.setView([20, 0], 2);
    // the card can appear while its container is still being laid out
    const t = window.setTimeout(() => map.invalidateSize(), 150);
    return () => { window.clearTimeout(t); map.remove(); };
  }, [spec]);

  return <div ref={host} style={{ height: 288, width: "100%", position: "relative", zIndex: 0, background: "#1a1a1e" }} />;
}
