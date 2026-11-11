// Vmaps: free map tools for the agent (OpenStreetMap, no key, no billing). The work is done in lib/vmaps/core.ts.
// Tools that find places or routes end their answer with a ```vmap block; the chat draws it as a real map card.
import type { Def } from "./plugins";
import { safeFetch } from "./net";
import {
  enrichLeads, fmtDist, fmtMin, geocode, nearbyCategories, normMode, parseLatLon, resolvePlace, reverseGeocode, route, searchNearby, vleadsFence, vmapFence, vmapsConfig,
  type MapMarker, type Place,
} from "@/lib/vmaps/core";

const s = (v: unknown) => String(v ?? "").trim();
const num = (v: unknown): number | null => (v !== null && v !== undefined && s(v) !== "" && Number.isFinite(Number(v)) ? Number(v) : null);

/** Lists arrive as real arrays or as JSON text, depending on the model. */
function asList(v: unknown): unknown[] {
  if (Array.isArray(v)) return v;
  const t = s(v);
  if (!t) return [];
  try { const j = JSON.parse(t); if (Array.isArray(j)) return j; } catch { /* not JSON: treat as one name per line / comma */ }
  return t.split(/\n|;/).map((x) => x.trim()).filter(Boolean);
}

const SHOW = "To show this map in the chat, put the block below in your reply exactly as it is (do not edit it):";
const stale = (on: boolean) => (on ? "\n(Note: the internet was not reachable, so this answer comes from saved results.)" : "");
const where = (p: Place) => `${p.name}${p.address && !p.address.startsWith(p.name) ? `, ${p.address}` : p.address && p.address !== p.name ? ` (${p.address})` : ""}`;

/** Reads one web page for lead enrichment. Website addresses come from map data (untrusted), so only public hosts are allowed. */
async function getHtml(url: string): Promise<string> {
  const res = await safeFetch(url, { headers: { "User-Agent": vmapsConfig().userAgent, Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5", "Accept-Language": "en" } }, 7_000);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const type = res.headers.get("content-type") ?? "";
  if (type && !/html|text|xml/i.test(type)) throw new Error("not a web page");
  const reader = res.body?.getReader();
  if (!reader) return (await res.text()).slice(0, 300_000);
  const dec = new TextDecoder();
  let out = "", n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.length;
    out += dec.decode(value, { stream: true });
    if (n > 300_000) { await reader.cancel().catch(() => undefined); break; } // a homepage never needs more
  }
  return out;
}

const contactLine = (p: Place) => [p.phone && `tel ${p.phone}`, p.email && `email ${p.email}`, p.website && `web ${p.website}`].filter(Boolean).join(" · ");

async function centreOf(a: Record<string, unknown>): Promise<Place> {
  const lat = num(a.lat), lon = num(a.lon ?? a.lng);
  if (lat !== null && lon !== null) return resolvePlace({ name: s(a.near) || "Your spot", lat, lon });
  const near = s(a.near ?? a.place ?? a.location ?? a.around);
  if (!near) throw new Error("Tell me where to look: near:\"a place name\" or lat and lon.");
  return resolvePlace(near);
}

export const VMAPS_TOOLS: Def[] = [
  {
    name: "vmaps.geocode",
    description: "Vmaps: find a place by name or address and get its coordinates. Free, no key. Use near to prefer results close to another place.",
    params: "query:string, near?:string, limit?:number",
    risk: "read",
    run: async (a) => {
      const q = s(a.query ?? a.place ?? a.address);
      const nearText = s(a.near);
      const bias = nearText ? await resolvePlace(nearText).catch(() => null) : null;
      const { places, stale: old } = await geocode(q, num(a.limit) ?? 5, bias ?? undefined);
      if (!places.length) return `Vmaps found nothing for "${q}". Try a fuller name (add the city or country).`;
      return `Vmaps found ${places.length} place(s) for "${q}":\n` + places.map((p, i) => `${i + 1}. ${where(p)} — lat ${p.lat}, lon ${p.lon}${p.kind ? ` [${p.kind}]` : ""}`).join("\n") + stale(old);
    },
  },
  {
    name: "vmaps.reverse",
    description: "Vmaps: turn coordinates into the address / place name there.",
    params: "lat:number, lon:number",
    risk: "read",
    run: async (a) => {
      const lat = num(a.lat), lon = num(a.lon ?? a.lng);
      if (lat === null || lon === null) throw new Error("vmaps.reverse needs lat and lon as numbers.");
      const { place, stale: old } = await reverseGeocode(lat, lon);
      return `At ${lat}, ${lon}: ${where(place)}${stale(old)}`;
    },
  },
  {
    name: "vmaps.nearby",
    description:
      "Vmaps: find places of one kind around a spot (cafe, restaurant, hospital, pharmacy, atm, fuel, hotel, park, bus stop, police, toilet, ev charging, gym, ...). Sorted nearest first; returns a map card block. " +
      `Categories: ${nearbyCategories().join(", ")}.`,
    params: "category:string, near:string (place name or \"lat,lon\"), radius_m?:number (default 1000), limit?:number (default 8)",
    risk: "read",
    run: async (a) => {
      const centre = await centreOf(a);
      const { places, label, radiusM, stale: old } = await searchNearby(centre, s(a.category ?? a.type ?? a.kind), num(a.radius_m ?? a.radius) ?? 1000, num(a.limit) ?? 8);
      if (!places.length) {
        return `Vmaps found no ${label} within ${fmtDist(radiusM)} of ${centre.name}. Try a bigger radius_m (up to 20000) or another spelling of the place.${stale(old)}`;
      }
      const lines = places.map((p, i) => `${i + 1}. ${p.name} — ${fmtDist(p.distM ?? 0)}${p.address ? ` — ${p.address}` : ""}${p.extra ? ` — ${p.extra}` : ""}${contactLine(p) ? ` — ${contactLine(p)}` : ""} (lat ${p.lat}, lon ${p.lon})`);
      const markers: MapMarker[] = [
        { name: centre.name, lat: centre.lat, lon: centre.lon, role: "center", note: "search centre" },
        ...places.map((p) => ({ name: p.name, lat: p.lat, lon: p.lon, note: [fmtDist(p.distM ?? 0), p.phone, p.extra].filter(Boolean).join(" · ") })),
      ];
      return `${places.length} ${label} within ${fmtDist(radiusM)} of ${centre.name}, nearest first:\n${lines.join("\n")}${stale(old)}\n\n${SHOW}\n` +
        vmapFence({ title: `${label} near ${centre.name}`, markers });
    },
  },
  {
    name: "vmaps.leads",
    description:
      "Vmaps: build a LEAD LIST of local businesses (dentist, clinic, school, hotel, gym, lawyer, accountant, real estate, company, factory, restaurant, shop ...) around a place. " +
      "Each lead has phone / website / email when the map or the business's own website has them, plus a one-line description read from the website. Shows a table, a map and a Download CSV button. " +
      "Only businesses with some contact detail are listed unless contact_only is false.",
    params: "category:string, near:string (city / area name or \"lat,lon\"), radius_m?:number (default 3000), limit?:number (default 10, max 12), enrich?:boolean (default true: read each website), contact_only?:boolean (default true)",
    risk: "read",
    run: async (a) => {
      const centre = await centreOf(a);
      const contactOnly = a.contact_only === undefined ? true : !/^(false|0|no)$/i.test(s(a.contact_only));
      const doEnrich = a.enrich === undefined ? true : !/^(false|0|no)$/i.test(s(a.enrich));
      const limit = Math.min(12, num(a.limit) ?? 10);
      const found = await searchNearby(centre, s(a.category ?? a.type ?? a.kind), num(a.radius_m ?? a.radius) ?? 3000, limit, { contactOnly });
      if (!found.places.length) {
        return contactOnly
          ? `Vmaps found no ${found.label} with a phone, website or email on the map within ${fmtDist(found.radiusM)} of ${centre.name}. Try contact_only:false (names and locations only), a bigger radius_m (up to 20000), or a bigger city name.${stale(found.stale)}`
          : `Vmaps found no ${found.label} within ${fmtDist(found.radiusM)} of ${centre.name}. Try a bigger radius_m or another area.${stale(found.stale)}`;
      }
      let leads = found.places;
      let read = 0, failed = 0;
      if (doEnrich && leads.some((p) => p.website)) {
        const r = await enrichLeads(leads, getHtml, { concurrency: 4, budgetMs: 25_000 });
        leads = r.places; read = r.read; failed = r.failed;
      }
      const count = (f: (p: Place) => unknown) => leads.filter(f).length;
      return `${leads.length} ${found.label} leads within ${fmtDist(found.radiusM)} of ${centre.name}: ${count((p) => p.phone)} with phone, ${count((p) => p.email)} with email, ${count((p) => p.website)} with website` +
        (doEnrich ? ` (${read} websites read${failed ? `, ${failed} unreachable` : ""})` : "") + ".\n" +
        "Data = OpenStreetMap tags + each business's own public website. It can be outdated or incomplete: check before outreach and follow spam / data-protection rules." +
        `${stale(found.stale)}\n\n${SHOW}\nThe card has a table, a map and a Download CSV button. After the block, tell the user in 2-3 lines which leads look most useful.\n` +
        vleadsFence(`${found.label} leads near ${centre.name}`, leads);
    },
  },
  {
    name: "vmaps.route",
    description: "Vmaps: directions between two places: distance, time, turn-by-turn steps and a map card with the route. mode is driving, walking or cycling.",
    params: "from:string (place name or \"lat,lon\"), to:string, mode?:driving|walking|cycling",
    risk: "read",
    run: async (a) => {
      const from = await resolvePlace(a.from ?? a.origin ?? a.start);
      const to = await resolvePlace(a.to ?? a.destination ?? a.end, from);
      const r = await route(from, to, normMode(a.mode));
      const verb = r.mode === "driving" ? "driving" : r.mode === "walking" ? "on foot" : "by bike";
      return `Route ${verb}: ${r.km} km, about ${fmtMin(r.min)}.\nFrom ${where(from)}\nTo ${where(to)}\nSteps:\n${r.steps.map((x, i) => `${i + 1}. ${x}`).join("\n")}` +
        `\nTimes are typical road estimates, with no live traffic.${stale(!!r.stale)}\n\n${SHOW}\n` +
        vmapFence({
          title: `${from.name} → ${to.name}`,
          markers: [{ name: from.name, lat: from.lat, lon: from.lon, role: "start" }, { name: to.name, lat: to.lat, lon: to.lon, role: "end" }],
          route: { coords: r.coords, km: r.km, min: r.min, mode: r.mode },
        });
    },
  },
  {
    name: "vmaps.show_map",
    description: "Vmaps: draw a map card with pins for places you already know. places is a list of names, or objects {name, lat, lon, note?}. Names are looked up for you.",
    params: "title?:string, places:array",
    risk: "read",
    run: async (a) => {
      const items = asList(a.places ?? a.markers ?? a.pins).slice(0, 10);
      if (!items.length) throw new Error("vmaps.show_map needs places: a list of names or {name, lat, lon}.");
      const markers: MapMarker[] = [];
      const missed: string[] = [];
      for (const it of items) {
        try {
          const label = typeof it === "string" ? it : s((it as Record<string, unknown>)?.name);
          const direct = typeof it === "string" ? parseLatLon(it) : null;
          const p = await resolvePlace(direct ? { name: label, ...direct } : it);
          const note = it && typeof it === "object" ? s((it as Record<string, unknown>).note) : "";
          markers.push({ name: p.name, lat: p.lat, lon: p.lon, note: note || undefined });
        } catch {
          missed.push(typeof it === "string" ? it : s((it as Record<string, unknown>)?.name) || "(unnamed)");
        }
      }
      if (!markers.length) throw new Error(`Vmaps could not place any of these: ${missed.join(", ")}.`);
      return `Map with ${markers.length} pin(s)${missed.length ? `; not found: ${missed.join(", ")}` : ""}.\n\n${SHOW}\n` + vmapFence({ title: s(a.title) || "Map", markers });
    },
  },
];
