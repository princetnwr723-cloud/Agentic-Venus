// Server-only. Vmaps = a free "Google Maps for AI agents" built on OpenStreetMap. No API key, no billing.
//
// Built to run on your own machine / VM:
//  - every outside call goes through the SERVER (the browser never talks to a map host: no CORS / CSP / mixed-content trouble),
//  - polite to the free public servers (identifying User-Agent, 1 request/second for Nominatim, mirrors, retries),
//  - everything is cached on disk, so repeat questions are instant and still work when the internet is down,
//  - point it at your OWN servers with env vars (see VMAPS.md) and it runs 100% offline.
//
// Keep this file free of "@/..." imports: scripts/vmaps-check.mjs and the tests load it straight with node.
import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export type Place = { name: string; lat: number; lon: number; kind?: string; address?: string; distM?: number; extra?: string };
export type RouteMode = "driving" | "walking" | "cycling";
export type RouteResult = {
  mode: RouteMode; km: number; min: number; coords: Array<[number, number]>; steps: string[]; from: Place; to: Place; stale?: boolean;
};

const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const r5 = (n: number) => Math.round(n * 1e5) / 1e5;

// ---------------------------------------------------------------- config (read on every call, so env changes apply at once)

const env = (k: string) => (process.env[k] ?? "").trim().replace(/\/+$/, "");
const offline = () => /^(1|true|yes|on)$/i.test((process.env.VMAPS_OFFLINE ?? "").trim());
const userAgent = () =>
  (process.env.VMAPS_USER_AGENT ?? "").trim() || "AgenticVenus-Vmaps/1.0 (self-hosted; set VMAPS_USER_AGENT to your contact email)";

export function vmapsConfig() {
  const local = {
    nominatim: env("VMAPS_NOMINATIM_URL"), photon: env("VMAPS_PHOTON_URL"), overpass: env("VMAPS_OVERPASS_URL"),
    osrmCar: env("VMAPS_OSRM_URL"), osrmFoot: env("VMAPS_OSRM_FOOT_URL"), osrmBike: env("VMAPS_OSRM_BIKE_URL"), tiles: env("VMAPS_TILE_URL"),
  };
  return { offline: offline(), local, userAgent: userAgent() };
}

// ---------------------------------------------------------------- polite requests

/** Minimum gap between calls to one host. The public Nominatim asks for at most 1 request per second. */
function gapFor(host: string): number {
  if (/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1)/.test(host) || host.endsWith(".local") || !host.includes(".")) return 0;
  if (host.includes("nominatim.openstreetmap.org")) return 1100;
  if (host.includes("openstreetmap.org") && !host.includes("nominatim")) return 0; // tiles are cached, routing is light
  return 250;
}

const lastHit = new Map<string, number>();
const chain = new Map<string, Promise<void>>();
async function gate(host: string): Promise<void> {
  const gap = gapFor(host);
  if (!gap) return;
  const prev = chain.get(host) ?? Promise.resolve();
  const mine = prev.then(async () => {
    const wait = (lastHit.get(host) ?? 0) + gap - Date.now();
    if (wait > 0) await sleep(wait);
    lastHit.set(host, Date.now());
  });
  chain.set(host, mine.catch(() => undefined));
  await mine;
}

async function request(url: string, init: RequestInit = {}, ms = 15_000): Promise<Response> {
  let host = "";
  try { host = new URL(url).hostname; } catch { throw new Error(`Bad map server address: ${url}`); }
  await gate(host);
  const res = await fetch(url, {
    ...init,
    headers: { "User-Agent": userAgent(), Accept: "application/json", ...(init.headers as Record<string, string> | undefined) },
    signal: AbortSignal.timeout(ms),
  });
  if (!res.ok) throw new Error(`${host} answered HTTP ${res.status}`);
  return res;
}

async function getJson(url: string, init: RequestInit = {}, ms = 15_000): Promise<any> {
  // one quiet retry for the usual hiccups of free servers (busy, 429, 5xx, timeout)
  try {
    return await (await request(url, init, ms)).json();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!/(429|50\d|timeout|timed out|fetch failed|ECONN|socket|aborted|terminated)/i.test(msg)) throw e;
    await sleep(900);
    return await (await request(url, init, ms)).json();
  }
}

/** Tries each source in order; returns the first that answers. Throws one clear error listing every failure. */
async function firstOf<T>(what: string, tries: Array<[string, () => Promise<T | null>]>): Promise<T | null> {
  const errors: string[] = [];
  let answered = false;
  for (const [name, fn] of tries) {
    try {
      const v = await fn();
      answered = true;
      if (v !== null) return v;
    } catch (e) {
      errors.push(`${name}: ${e instanceof Error ? e.message : "failed"}`);
    }
  }
  if (answered) return null; // somebody answered, there was simply nothing
  const hint = offline() ? " (VMAPS_OFFLINE is on: only your own servers are used)" : " Check that this machine has internet, or set up local servers (VMAPS.md).";
  throw new Error(`${what} failed. ${errors.join("; ") || "No map server is configured."}${hint}`);
}

// ---------------------------------------------------------------- disk cache (survives restarts, works offline)

let dirPromise: Promise<string | null> | null = null;
async function cacheDir(): Promise<string | null> {
  if (!dirPromise) {
    dirPromise = (async () => {
      const wanted = (process.env.VMAPS_DATA_DIR ?? "").trim();
      // default sits OUTSIDE the project folder, so the dev server never reloads for it and `git pull` never touches it
      for (const d of [wanted, path.join(os.homedir(), ".agenticvenus", "vmaps-cache"), path.join(os.tmpdir(), "vmaps-cache")]) {
        if (!d) continue;
        try { await mkdir(d, { recursive: true }); return d; } catch { /* read-only disk: try the next place */ }
      }
      return null; // memory only
    })();
  }
  return dirPromise;
}

const mem = new Map<string, { t: number; v: unknown }>();
const fileOf = (key: string) => createHash("sha1").update(key).digest("hex") + ".json";

async function cacheGet<T>(key: string, ttl: number): Promise<T | null> {
  const m = mem.get(key);
  if (m && Date.now() - m.t < ttl) return m.v as T;
  const d = await cacheDir();
  if (!d) return null;
  try {
    const j = JSON.parse(await readFile(path.join(d, fileOf(key)), "utf8")) as { t: number; v: T };
    if (Date.now() - j.t < ttl) { mem.set(key, j); return j.v; }
  } catch { /* no such entry */ }
  return null;
}

async function cacheSet(key: string, v: unknown): Promise<void> {
  if (v === null || (Array.isArray(v) && v.length === 0)) return;
  const rec = { t: Date.now(), v };
  if (mem.size > 500) mem.clear();
  mem.set(key, rec);
  const d = await cacheDir();
  if (!d) return;
  try { await writeFile(path.join(d, fileOf(key)), JSON.stringify(rec)); } catch { /* cache is best effort */ }
}

/** Fresh cache -> live servers -> old cache (so a dead internet link still answers what was asked before). */
async function cached<T>(key: string, ttl: number, load: () => Promise<T | null>): Promise<{ value: T | null; stale: boolean }> {
  const fresh = await cacheGet<T>(key, ttl);
  if (fresh !== null) return { value: fresh, stale: false };
  try {
    const v = await load();
    if (v !== null) await cacheSet(key, v);
    return { value: v, stale: false };
  } catch (e) {
    const old = await cacheGet<T>(key, Infinity);
    if (old !== null) return { value: old, stale: true };
    throw e;
  }
}

// ---------------------------------------------------------------- small geo helpers

export function haversineM(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const R = 6_371_000, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function fmtDist(m: number): string {
  if (m < 950) return `${Math.max(10, Math.round(m / 10) * 10)} m`;
  return `${(m / 1000).toFixed(m < 10_000 ? 1 : 0)} km`;
}

export function fmtMin(min: number): string {
  if (min < 1) return "under 1 min";
  if (min < 60) return `${Math.round(min)} min`;
  const h = Math.floor(min / 60), m = Math.round(min % 60);
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** "28.61, 77.20" -> a point (no network needed). */
export function parseLatLon(text: string): { lat: number; lon: number } | null {
  const m = /^\s*(-?\d{1,2}(?:\.\d+)?)\s*[,;\s]\s*(-?\d{1,3}(?:\.\d+)?)\s*$/.exec(text);
  if (!m) return null;
  const lat = Number(m[1]), lon = Number(m[2]);
  return Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon } : null;
}

const cleanText = (v: unknown, n = 140) => String(v ?? "").replace(/[\u0000-\u001f`]/g, " ").replace(/\s+/g, " ").trim().slice(0, n);

// ---------------------------------------------------------------- geocode / reverse

function fromNominatim(r: any): Place | null {
  const lat = Number(r?.lat), lon = Number(r?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const display = cleanText(r.display_name, 200);
  return { name: cleanText(r.name || r.namedetails?.name || display.split(",")[0], 100) || display, lat: r5(lat), lon: r5(lon), kind: cleanText(r.type || r.category, 30), address: display };
}

function fromPhoton(f: any): Place | null {
  const c = f?.geometry?.coordinates, p = f?.properties ?? {};
  const lon = Number(c?.[0]), lat = Number(c?.[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const addr = [p.name, p.housenumber && p.street ? `${p.street} ${p.housenumber}` : p.street, p.district, p.city, p.state, p.country].filter(Boolean).map((x: unknown) => cleanText(x, 60));
  return { name: cleanText(p.name || p.street || p.city || "Place", 100), lat: r5(lat), lon: r5(lon), kind: cleanText(p.osm_value, 30), address: addr.join(", ") };
}

const geoBases = () => {
  const c = vmapsConfig();
  return {
    nominatim: [c.local.nominatim, ...(c.offline ? [] : ["https://nominatim.openstreetmap.org"])].filter(Boolean),
    photon: [c.local.photon, ...(c.offline ? [] : ["https://photon.komoot.io"])].filter(Boolean),
  };
};

export async function geocode(query: string, limit = 5, near?: { lat: number; lon: number }): Promise<{ places: Place[]; stale: boolean }> {
  const q = cleanText(query, 200);
  if (!q) throw new Error("Tell me which place to look for.");
  const direct = parseLatLon(q);
  if (direct) return { places: [{ name: `${r5(direct.lat)}, ${r5(direct.lon)}`, lat: r5(direct.lat), lon: r5(direct.lon), kind: "point" }], stale: false };
  const n = clamp(Math.round(limit) || 5, 1, 10);
  const key = `geo:${q.toLowerCase()}:${n}:${near ? `${near.lat.toFixed(1)},${near.lon.toFixed(1)}` : ""}`;
  const b = geoBases();
  const { value, stale } = await cached<Place[]>(key, 30 * DAY, async () => {
    const tries: Array<[string, () => Promise<Place[] | null>]> = [];
    for (const base of b.nominatim) {
      tries.push([`nominatim ${new URL(base).hostname}`, async () => {
        const view = near ? `&viewbox=${r5(near.lon - 0.6)},${r5(near.lat + 0.6)},${r5(near.lon + 0.6)},${r5(near.lat - 0.6)}` : "";
        const j = await getJson(`${base}/search?format=jsonv2&addressdetails=0&limit=${n}&q=${encodeURIComponent(q)}${view}`);
        const rows = (Array.isArray(j) ? j : []).map(fromNominatim).filter((p): p is Place => !!p);
        return rows.length ? rows : null;
      }]);
    }
    for (const base of b.photon) {
      tries.push([`photon ${new URL(base).hostname}`, async () => {
        const bias = near ? `&lat=${near.lat}&lon=${near.lon}` : "";
        const j = await getJson(`${base}/api/?limit=${n}&q=${encodeURIComponent(q)}${bias}`);
        const rows = ((j?.features ?? []) as any[]).map(fromPhoton).filter((p): p is Place => !!p);
        return rows.length ? rows : null;
      }]);
    }
    return firstOf("Place search", tries);
  });
  return { places: value ?? [], stale };
}

export async function reverseGeocode(lat: number, lon: number): Promise<{ place: Place; stale: boolean }> {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) throw new Error("lat/lon are not valid coordinates.");
  const b = geoBases();
  const { value, stale } = await cached<Place>(`rev:${lat.toFixed(4)},${lon.toFixed(4)}`, 30 * DAY, async () => {
    const tries: Array<[string, () => Promise<Place | null>]> = [];
    for (const base of b.nominatim) {
      tries.push([`nominatim ${new URL(base).hostname}`, async () => {
        const j = await getJson(`${base}/reverse?format=jsonv2&zoom=18&lat=${lat}&lon=${lon}`);
        return j && !j.error ? fromNominatim(j) : null;
      }]);
    }
    for (const base of b.photon) {
      tries.push([`photon ${new URL(base).hostname}`, async () => {
        const j = await getJson(`${base}/reverse?lat=${lat}&lon=${lon}`);
        return fromPhoton(j?.features?.[0]);
      }]);
    }
    return firstOf("Address lookup", tries);
  });
  return { place: value ?? { name: `${r5(lat)}, ${r5(lon)}`, lat: r5(lat), lon: r5(lon), kind: "point" }, stale };
}

/** A place name, "lat, lon" text, or an object with coordinates -> one Place. */
export async function resolvePlace(input: unknown, near?: { lat: number; lon: number }): Promise<Place> {
  if (input && typeof input === "object") {
    const o = input as Record<string, unknown>;
    const lat = Number(o.lat ?? o.latitude), lon = Number(o.lon ?? o.lng ?? o.longitude);
    if (Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
      return { name: cleanText(o.name ?? o.label ?? o.title ?? `${r5(lat)}, ${r5(lon)}`, 100), lat: r5(lat), lon: r5(lon), kind: cleanText(o.kind, 30), address: cleanText(o.address, 200), extra: cleanText(o.note ?? o.extra, 120) };
    }
    input = o.name ?? o.query ?? o.place ?? "";
  }
  const text = cleanText(input, 200);
  const { places } = await geocode(text, 1, near);
  if (!places[0]) throw new Error(`I could not find "${text}" on the map. Try a more specific name (add the city) or give coordinates like "28.61, 77.20".`);
  return places[0];
}

// ---------------------------------------------------------------- nearby (Overpass)

// word the owner / agent might use -> OpenStreetMap tag filter ("a|b" means any of them)
const CATEGORY_TAGS: Record<string, string> = {
  cafe: "amenity=cafe", restaurant: "amenity=restaurant", "fast food": "amenity=fast_food", bar: "amenity=bar|pub|biergarten", pub: "amenity=pub|bar",
  bakery: "shop=bakery", hospital: "amenity=hospital", clinic: "amenity=clinic|doctors", doctor: "amenity=doctors|clinic", dentist: "amenity=dentist",
  pharmacy: "amenity=pharmacy", atm: "amenity=atm", bank: "amenity=bank", fuel: "amenity=fuel", hotel: "tourism=hotel|guest_house|hostel|motel",
  hostel: "tourism=hostel|guest_house", park: "leisure=park|garden", school: "amenity=school", college: "amenity=college|university", university: "amenity=university|college",
  supermarket: "shop=supermarket|convenience|mall", grocery: "shop=supermarket|convenience|greengrocer", mall: "shop=mall|department_store", market: "amenity=marketplace",
  police: "amenity=police", "fire station": "amenity=fire_station", toilet: "amenity=toilets", "bus stop": "highway=bus_stop", "railway station": "railway=station|halt",
  "metro station": "railway=subway_entrance|station", airport: "aeroway=aerodrome", parking: "amenity=parking", "ev charging": "amenity=charging_station",
  temple: "amenity=place_of_worship", mosque: "amenity=place_of_worship", church: "amenity=place_of_worship", "place of worship": "amenity=place_of_worship",
  gym: "leisure=fitness_centre|sports_centre", cinema: "amenity=cinema", library: "amenity=library", "post office": "amenity=post_office", museum: "tourism=museum",
  attraction: "tourism=attraction|viewpoint|museum", "water": "amenity=drinking_water", "car repair": "shop=car_repair", salon: "shop=hairdresser|beauty",
};
const ALIASES: Record<string, string> = {
  coffee: "cafe", "coffee shop": "cafe", cafes: "cafe", restaurants: "restaurant", food: "restaurant", eat: "restaurant", dhaba: "restaurant", "petrol pump": "fuel",
  "petrol station": "fuel", "petrol": "fuel", "gas station": "fuel", "gas": "fuel", "chemist": "pharmacy", "medical store": "pharmacy", "medical": "pharmacy",
  hospitals: "hospital", doctors: "doctor", clinics: "clinic", banks: "bank", atms: "atm", "cash machine": "atm", hotels: "hotel", "guest house": "hostel", stay: "hotel",
  parks: "park", schools: "school", colleges: "college", "shopping mall": "mall", shops: "market", "police station": "police", toilets: "toilet", washroom: "toilet",
  restroom: "toilet", "bus": "bus stop", "bus stand": "bus stop", "train station": "railway station", station: "railway station", metro: "metro station", "charging station": "ev charging",
  "ev charger": "ev charging", mandir: "temple", masjid: "mosque", gurudwara: "place of worship", gym: "gym", gyms: "gym", libraries: "library", "tourist": "attraction",
  "tourist attraction": "attraction", sightseeing: "attraction", "drinking water": "water", garage: "car repair", mechanic: "car repair", barber: "salon", parlour: "salon",
};

export const nearbyCategories = () => Object.keys(CATEGORY_TAGS);

function tagFilter(category: string): { label: string; filter: string } {
  const raw = cleanText(category, 60).toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  const rawTag = /^([a-z_:]{1,40})=([a-z0-9_:|-]{1,80})$/.exec(cleanText(category, 120).toLowerCase().replace(/\s+/g, ""));
  const spec = rawTag ? `${rawTag[1]}=${rawTag[2]}` : CATEGORY_TAGS[ALIASES[raw] ?? raw] ?? CATEGORY_TAGS[(ALIASES[raw] ?? raw).replace(/s$/, "")];
  if (!spec) throw new Error(`I do not know the category "${category}". Use one of: ${nearbyCategories().join(", ")} (or a raw OpenStreetMap tag like amenity=cafe).`);
  // "key=a|b|c": one key, several accepted values
  const [k, vals] = [spec.slice(0, spec.indexOf("=")), spec.slice(spec.indexOf("=") + 1)];
  const filter = vals.includes("|") ? `["${k}"~"^(${vals})$"]` : `["${k}"="${vals}"]`;
  return { label: ALIASES[raw] ?? raw, filter };
}

const overpassUrls = () => {
  const c = vmapsConfig();
  const pub = c.offline ? [] : ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter", "https://overpass.private.coffee/api/interpreter"];
  return [c.local.overpass, ...pub].filter(Boolean);
};

function fromOverpass(e: any, centre: { lat: number; lon: number }, label: string): Place | null {
  const lat = Number(e?.lat ?? e?.center?.lat), lon = Number(e?.lon ?? e?.center?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const t = e.tags ?? {};
  const street = [t["addr:housenumber"], t["addr:street"]].filter(Boolean).join(" ");
  const address = [street, t["addr:suburb"] || t["addr:neighbourhood"], t["addr:city"]].filter(Boolean).join(", ");
  const extra = [t.opening_hours && `open: ${t.opening_hours}`, (t.phone || t["contact:phone"]) && `tel: ${t.phone || t["contact:phone"]}`, t.cuisine && `cuisine: ${t.cuisine}`].filter(Boolean).join(" · ");
  return {
    name: cleanText(t.name || t["name:en"] || t.brand || t.operator || "", 100) || `(${label}, no name on the map)`,
    lat: r5(lat), lon: r5(lon), kind: label, address: cleanText(address, 120), extra: cleanText(extra, 140), distM: Math.round(haversineM(centre, { lat, lon })),
  };
}

export async function searchNearby(
  centre: { lat: number; lon: number }, category: string, radiusM = 1000, limit = 8
): Promise<{ places: Place[]; label: string; radiusM: number; stale: boolean }> {
  const { label, filter } = tagFilter(category);
  const radius = clamp(Math.round(radiusM) || 1000, 100, 20_000);
  const n = clamp(Math.round(limit) || 8, 1, 15);
  const key = `near:${label}:${filter}:${centre.lat.toFixed(3)},${centre.lon.toFixed(3)}:${radius}:${n}`;
  const q = `[out:json][timeout:20];nwr(around:${radius},${r5(centre.lat)},${r5(centre.lon)})${filter};out center ${Math.min(80, n * 6)};`;
  const { value, stale } = await cached<Place[]>(key, 1 * DAY, async () => {
    const tries: Array<[string, () => Promise<Place[] | null>]> = overpassUrls().map((url) => [
      `overpass ${new URL(url).hostname}`,
      async () => {
        const j = await getJson(url, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: `data=${encodeURIComponent(q)}` }, 25_000);
        const els = (j?.elements ?? []) as any[];
        if (!els.length && /error|timeout|too busy|rate/i.test(String(j?.remark ?? ""))) throw new Error(String(j.remark).slice(0, 80));
        const all = els.map((e) => fromOverpass(e, centre, label)).filter((p): p is Place => !!p);
        // named places first (an unnamed bench is no use to a person), then nearest first
        all.sort((a, b) => Number(a.name.startsWith("(")) - Number(b.name.startsWith("(")) || (a.distM ?? 0) - (b.distM ?? 0));
        const seen = new Set<string>();
        const out = all.filter((p) => { const k = `${p.name}|${p.lat.toFixed(4)}|${p.lon.toFixed(4)}`; if (seen.has(k)) return false; seen.add(k); return true; });
        return out.slice(0, n);
      },
    ]);
    const got = await firstOf("Nearby search", tries);
    return got && got.length ? got : null;
  });
  return { places: value ?? [], label, radiusM: radius, stale };
}

// ---------------------------------------------------------------- routes (OSRM)

const MODE_ALIASES: Record<string, RouteMode> = {
  driving: "driving", drive: "driving", car: "driving", bike: "cycling", cycling: "cycling", cycle: "cycling", bicycle: "cycling", walking: "walking", walk: "walking", foot: "walking", "on foot": "walking",
};
export const normMode = (m: unknown): RouteMode => MODE_ALIASES[String(m ?? "driving").trim().toLowerCase()] ?? "driving";

function osrmBases(mode: RouteMode): string[] {
  const c = vmapsConfig();
  const mine = mode === "driving" ? c.local.osrmCar : mode === "walking" ? c.local.osrmFoot : c.local.osrmBike;
  // public servers: the profile is chosen by the host path, not by the URL profile segment
  const pub = c.offline ? [] :
    mode === "driving" ? ["https://router.project-osrm.org/route/v1/driving", "https://routing.openstreetmap.de/routed-car/route/v1/driving"]
    : mode === "walking" ? ["https://routing.openstreetmap.de/routed-foot/route/v1/driving"]
    : ["https://routing.openstreetmap.de/routed-bike/route/v1/driving"];
  return [mine ? `${mine}/route/v1/driving` : "", ...pub].filter(Boolean);
}

const TURN: Record<string, string> = { left: "left", right: "right", "slight left": "slightly left", "slight right": "slightly right", "sharp left": "sharp left", "sharp right": "sharp right", uturn: "around (U-turn)" };

function sayStep(s: any, i: number): string {
  const m = s?.maneuver ?? {}, name = cleanText(s?.name, 60), onto = name ? ` onto ${name}` : "", on = name ? ` on ${name}` : "";
  const d = fmtDist(Number(s?.distance) || 0);
  if (m.type === "depart") return `Start${on} (${d})`;
  if (m.type === "arrive") return "Arrive at your destination";
  if (m.type === "roundabout" || m.type === "rotary") return `At the roundabout take exit ${m.exit ?? ""}${onto} (${d})`.replace("exit  ", "exit ");
  const dir = TURN[String(m.modifier ?? "")];
  if (!dir || m.type === "new name" || m.type === "continue" || m.modifier === "straight") return `${i === 0 ? "Head" : "Continue"}${on || onto} (${d})`;
  return `Turn ${dir}${onto} (${d})`;
}

function thin(coords: Array<[number, number]>, max: number): Array<[number, number]> {
  if (coords.length <= max) return coords;
  const out: Array<[number, number]> = [];
  const step = (coords.length - 1) / (max - 1);
  for (let i = 0; i < max; i++) out.push(coords[Math.round(i * step)]);
  return out;
}

export async function route(from: Place, to: Place, modeIn: unknown = "driving"): Promise<RouteResult> {
  const mode = normMode(modeIn);
  if (haversineM(from, to) > 4_000_000) throw new Error("Those two places are too far apart for one route (over 4000 km).");
  const key = `route:${mode}:${from.lat.toFixed(4)},${from.lon.toFixed(4)}>${to.lat.toFixed(4)},${to.lon.toFixed(4)}`;
  const coordPart = `${from.lon},${from.lat};${to.lon},${to.lat}`;
  type Raw = { km: number; min: number; coords: Array<[number, number]>; steps: string[] };
  const { value, stale } = await cached<Raw>(key, 1 * DAY, async () => {
    const tries: Array<[string, () => Promise<Raw | null>]> = osrmBases(mode).map((base) => [
      `routing ${new URL(base).hostname}`,
      async () => {
        const j = await getJson(`${base}/${coordPart}?overview=full&geometries=geojson&steps=true&alternatives=false`, {}, 25_000);
        if (j?.code === "NoRoute") throw new Error("no road/path connects these two places");
        const r = j?.routes?.[0];
        if (!r?.geometry?.coordinates?.length) throw new Error(`no route (${j?.code ?? "empty answer"})`);
        const coords = (r.geometry.coordinates as number[][]).map((c): [number, number] => [r5(c[1]), r5(c[0])]);
        const rawSteps = ((r.legs ?? []) as any[]).flatMap((l) => (l.steps ?? []) as any[]);
        // drop tiny "continue" steps so the list stays readable
        const kept = rawSteps.filter((s, i) => i === 0 || i === rawSteps.length - 1 || Number(s.distance) >= 40 || s.maneuver?.type === "turn");
        return { km: Math.round(r.distance / 100) / 10, min: Math.max(1, Math.round(r.duration / 60)), coords: thin(coords, 100), steps: kept.map(sayStep).slice(0, 30) };
      },
    ]);
    return firstOf("Route", tries);
  });
  if (!value) throw new Error("No route found between those places.");
  return { mode, ...value, from, to, stale };
}

// ---------------------------------------------------------------- map card block for the chat (```vmap)

export type MapMarker = { name: string; lat: number; lon: number; note?: string; role?: "center" | "start" | "end" };

/** The fenced block the chat draws as a map. Kept small: tool results are cut at 6000 characters. */
export function vmapFence(opts: { title?: string; markers?: MapMarker[]; route?: { coords: Array<[number, number]>; km: number; min: number; mode: string } }): string {
  const markers = (opts.markers ?? []).slice(0, 12).map((m) => ({
    name: cleanText(m.name, 60), lat: r5(m.lat), lon: r5(m.lon), ...(m.note ? { note: cleanText(m.note, 80) } : {}), ...(m.role ? { role: m.role } : {}),
  }));
  const body: Record<string, unknown> = { title: cleanText(opts.title ?? "Map", 80), markers };
  if (opts.route) body.route = { coords: thin(opts.route.coords, 100), km: opts.route.km, min: opts.route.min, mode: opts.route.mode };
  return "```vmap\n" + JSON.stringify(body) + "\n```";
}

// ---------------------------------------------------------------- map tiles (what the map card shows)

const BLANK_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");
export const blankTile = () => BLANK_PNG;

const tileTemplates = (): string[] => {
  const c = vmapsConfig();
  const mine = (process.env.VMAPS_TILE_URL ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const pub = c.offline ? [] : ["https://tile.openstreetmap.org/{z}/{x}/{y}.png", "https://a.tile.openstreetmap.fr/osmfr/{z}/{x}/{y}.png"];
  return [...mine, ...pub];
};

const TILE_TTL = 14 * DAY; // the OpenStreetMap tile policy asks for at least 7 days
const inflight = new Map<string, Promise<{ bytes: Buffer; type: string; stale: boolean }>>();
let active = 0;
const waiting: Array<() => void> = [];
async function slot<T>(fn: () => Promise<T>): Promise<T> {
  while (active >= 6) await new Promise<void>((r) => waiting.push(r));
  active++;
  try { return await fn(); } finally { active--; waiting.shift()?.(); }
}

export async function getTile(z: number, x: number, y: number): Promise<{ bytes: Buffer; type: string; stale: boolean }> {
  if (![z, x, y].every(Number.isInteger) || z < 0 || z > 19 || x < 0 || y < 0 || x >= 2 ** z || y >= 2 ** z) throw new Error("bad tile");
  const id = `${z}/${x}/${y}`;
  const running = inflight.get(id);
  if (running) return running;
  const job = (async () => {
    const d = await cacheDir();
    const file = d ? path.join(d, "tiles", String(z), String(x), `${y}.png`) : "";
    const readTile = async (maxAge: number) => {
      if (!file) return null;
      try {
        const st = await stat(file);
        return Date.now() - st.mtimeMs < maxAge ? await readFile(file) : null;
      } catch { return null; }
    };
    const fresh = await readTile(TILE_TTL);
    if (fresh) return { bytes: fresh, type: "image/png", stale: false };
    const errors: string[] = [];
    for (const tpl of tileTemplates()) {
      try {
        const url = tpl.replace("{z}", String(z)).replace("{x}", String(x)).replace("{y}", String(y));
        const res = await slot(() => request(url, { headers: { Accept: "image/png,image/*" } }, 12_000));
        const type = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
        if (!type.startsWith("image/")) throw new Error("not an image");
        const bytes = Buffer.from(await res.arrayBuffer());
        if (bytes.length < 50 || bytes.length > 600_000) throw new Error("odd tile size");
        if (file) {
          try { await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, bytes); } catch { /* cache is best effort */ }
        }
        return { bytes, type, stale: false };
      } catch (e) {
        errors.push(e instanceof Error ? e.message : "failed");
      }
    }
    const old = await readTile(Infinity);
    if (old) return { bytes: old, type: "image/png", stale: true };
    throw new Error(`no tile source answered (${errors.join("; ") || "none configured"})`);
  })();
  inflight.set(id, job);
  try { return await job; } finally { inflight.delete(id); }
}
