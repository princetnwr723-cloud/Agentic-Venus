"use client";

// Vmaps screen: free maps for you (no Google, no key): search a place, find what is nearby, get directions, build a lead list.
// It calls the same vmaps.* tools the agent uses, so what you see here is what the agent can do in chat.
import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Crosshair, LoaderCircle, MapPin, Search } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import VMapCard from "@/components/rich/VMapCard";
import VLeadsCard from "@/components/rich/VLeadsCard";
import { parseGeocodeLines, splitToolText, type Block } from "@/lib/vmaps/ui";

type Tab = "places" | "nearby" | "route" | "leads";
type Result = { n: number; summary: string; details: string; block: Block | null };

const TABS: Array<{ key: Tab; label: string; hint: string }> = [
  { key: "places", label: "Places", hint: "Find a place or address" },
  { key: "nearby", label: "Nearby", hint: "What is around a spot" },
  { key: "route", label: "Route", hint: "Directions between two places" },
  { key: "leads", label: "Leads", hint: "Local businesses with contact details, as CSV" },
];
const NEARBY_CHIPS = ["cafe", "restaurant", "hospital", "pharmacy", "atm", "fuel", "hotel", "park", "bus stop", "police"];
const LEAD_CHIPS = ["dentist", "clinic", "school", "coaching", "hotel", "gym", "lawyer", "accountant", "real estate", "company", "restaurant", "factory"];

const box = "w-full rounded-xl border border-line bg-bg px-3 py-2.5 text-sm text-ink outline-none placeholder:text-faint focus:border-ink/40";
const chip = "press rounded-full border border-line px-3 py-1 text-xs text-muted hover:text-ink";

export default function VmapsPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("nearby");
  const [f, setF] = useState({
    q: "", category: "cafe", near: "", radius: "1000", from: "", to: "", mode: "driving",
    ltype: "dentist", lnear: "", lradius: "3000", enrich: true, contactOnly: true,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((p) => ({ ...p, [k]: v }));

  useEffect(() => { if (!loading && !user) router.replace("/"); }, [loading, user, router]);

  if (!user) return <div className="flex h-screen items-center justify-center bg-bg text-sm text-muted">Loading…</div>;

  const locate = (apply: (v: string) => void) => {
    if (!navigator.geolocation) { setError("This browser cannot share your location. Type the place name instead."); return; }
    navigator.geolocation.getCurrentPosition(
      (p) => { setError(""); apply(`${p.coords.latitude.toFixed(5)}, ${p.coords.longitude.toFixed(5)}`); },
      () => setError("Location did not work. Browsers allow it only on https or localhost, and only if you say yes. Type the place name instead."),
      { enableHighAccuracy: false, timeout: 10_000 }
    );
  };

  const call = async (tool: string, args: Record<string, unknown>) => {
    const res = await fetch("/api/vmaps", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${await user.getIdToken()}` },
      body: JSON.stringify({ tool, args }),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d.error || `Request failed (HTTP ${res.status}).`);
    return String(d.text ?? "");
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setError("");
    let tool = "", args: Record<string, unknown> = {};
    if (tab === "places") {
      if (!f.q.trim()) return setError("Type a place or address.");
      tool = "vmaps.geocode"; args = { query: f.q, limit: 6 };
    } else if (tab === "nearby") {
      if (!f.category.trim() || !f.near.trim()) return setError("Pick what to find and where (a place name, or use the target button).");
      tool = "vmaps.nearby"; args = { category: f.category, near: f.near, radius_m: Number(f.radius) };
    } else if (tab === "route") {
      if (!f.from.trim() || !f.to.trim()) return setError("Fill both From and To.");
      tool = "vmaps.route"; args = { from: f.from, to: f.to, mode: f.mode };
    } else {
      if (!f.ltype.trim() || !f.lnear.trim()) return setError("Pick the kind of business and the city or area.");
      tool = "vmaps.leads"; args = { category: f.ltype, near: f.lnear, radius_m: Number(f.lradius), enrich: f.enrich, contact_only: f.contactOnly };
    }
    setBusy(true);
    try {
      const text = await call(tool, args);
      const parts = splitToolText(text);
      let block = parts.block;
      if (tab === "places" && !block) {
        const markers = parseGeocodeLines(text);
        if (markers.length) block = { kind: "vmap", code: JSON.stringify({ title: f.q.trim().slice(0, 80), markers }) };
      }
      setResult({ n: (result?.n ?? 0) + 1, summary: parts.summary, details: parts.details, block });
    } catch (err) {
      setResult(null);
      setError(err instanceof Error ? err.message : "Search failed.");
    }
    setBusy(false);
  };

  const field = (label: string, node: React.ReactNode) => (
    <label className="block"><span className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-faint">{label}</span>{node}</label>
  );
  const where = (value: string, onChange: (v: string) => void, placeholder: string) => (
    <div className="flex gap-2">
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className={box} />
      <button type="button" onClick={() => locate(onChange)} title="Use my location" aria-label="Use my location" className="press shrink-0 rounded-xl border border-line px-3 text-muted hover:text-ink">
        <Crosshair size={16} />
      </button>
    </div>
  );

  return (
    <div className="min-h-screen bg-bg">
      <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-8">
        <button onClick={() => router.push("/dashboard")} className="mb-4 flex items-center gap-1.5 text-xs text-muted hover:text-ink"><ArrowLeft size={14} /> Dashboard</button>
        <h1 className="flex items-center gap-2 text-xl font-semibold text-ink"><MapPin size={20} className="text-avatar-teal" /> Vmaps</h1>
        <p className="mt-1 text-sm text-muted">Free maps and local research for you and your agents. Built on OpenStreetMap: no Google, no key, no card.</p>

        <div className="mt-5 grid grid-cols-2 sm:grid-cols-4 gap-1 rounded-xl border border-line bg-panel p-1">
          {TABS.map((t) => (
            <button key={t.key} type="button" onClick={() => { setTab(t.key); setError(""); }} aria-pressed={tab === t.key}
              className={`rounded-lg py-2 text-xs font-medium sm:text-sm ${tab === t.key ? "bg-panel2 text-ink" : "text-muted hover:text-ink"}`}>{t.label}</button>
          ))}
        </div>
        <p className="mt-2 text-xs text-faint">{TABS.find((t) => t.key === tab)?.hint}</p>

        <form onSubmit={submit} className="mt-4 space-y-3">
          {tab === "places" && field("Place or address", <input value={f.q} onChange={(e) => set("q", e.target.value)} placeholder="e.g. India Gate, New Delhi" className={box} />)}

          {tab === "nearby" && (
            <>
              {field("What to find", <input value={f.category} onChange={(e) => set("category", e.target.value)} placeholder="cafe, hospital, atm ..." className={box} />)}
              <div className="flex flex-wrap gap-1.5">{NEARBY_CHIPS.map((c) => <button key={c} type="button" onClick={() => set("category", c)} className={chip}>{c}</button>)}</div>
              {field("Near", where(f.near, (v) => set("near", v), "place name, or lat, lon"))}
              {field("Distance", (
                <select value={f.radius} onChange={(e) => set("radius", e.target.value)} className={box}>
                  <option value="500">500 m</option><option value="1000">1 km</option><option value="2000">2 km</option><option value="5000">5 km</option>
                </select>
              ))}
            </>
          )}

          {tab === "route" && (
            <>
              {field("From", where(f.from, (v) => set("from", v), "place name, or lat, lon"))}
              {field("To", <input value={f.to} onChange={(e) => set("to", e.target.value)} placeholder="place name" className={box} />)}
              {field("Travel by", (
                <select value={f.mode} onChange={(e) => set("mode", e.target.value)} className={box}>
                  <option value="driving">Car</option><option value="walking">Walking</option><option value="cycling">Bicycle</option>
                </select>
              ))}
            </>
          )}

          {tab === "leads" && (
            <>
              {field("Kind of business", <input value={f.ltype} onChange={(e) => set("ltype", e.target.value)} placeholder="dentist, lawyer, hotel ..." className={box} />)}
              <div className="flex flex-wrap gap-1.5">{LEAD_CHIPS.map((c) => <button key={c} type="button" onClick={() => set("ltype", c)} className={chip}>{c}</button>)}</div>
              {field("City or area", where(f.lnear, (v) => set("lnear", v), "e.g. Malviya Nagar, Jaipur"))}
              {field("Distance", (
                <select value={f.lradius} onChange={(e) => set("lradius", e.target.value)} className={box}>
                  <option value="1000">1 km</option><option value="3000">3 km</option><option value="5000">5 km</option><option value="10000">10 km</option>
                </select>
              ))}
              <label className="flex items-center gap-2 text-sm text-ink"><input type="checkbox" checked={f.enrich} onChange={(e) => set("enrich", e.target.checked)} /> Read each website for email and a short description (slower)</label>
              <label className="flex items-center gap-2 text-sm text-ink"><input type="checkbox" checked={f.contactOnly} onChange={(e) => set("contactOnly", e.target.checked)} /> Only businesses with a phone, website or email</label>
            </>
          )}

          <button type="submit" disabled={busy} className="press inline-flex items-center gap-2 rounded-xl bg-ink px-4 py-2.5 text-sm font-medium text-bg disabled:opacity-60">
            {busy ? <LoaderCircle size={15} className="animate-spin" /> : <Search size={15} />} {busy ? "Searching…" : tab === "leads" ? "Find leads" : tab === "route" ? "Get route" : "Search"}
          </button>
          {busy && tab === "leads" && f.enrich && <p className="text-xs text-faint">Reading websites can take up to 30 seconds.</p>}
        </form>

        {error && <p className="mt-4 rounded-xl border border-line bg-panel px-3.5 py-3 text-sm text-red-400">{error}</p>}

        {result && (
          <div className="mt-5">
            {result.summary && <p className="text-sm text-ink">{result.summary}</p>}
            {result.block?.kind === "vmap" && <VMapCard key={result.n} code={result.block.code} fallback={<p className="text-xs text-faint">Could not draw the map.</p>} />}
            {result.block?.kind === "vleads" && <VLeadsCard key={result.n} code={result.block.code} fallback={<p className="text-xs text-faint">Could not draw the lead list.</p>} />}
            {result.details && (
              <details className="mt-3 rounded-xl border border-line bg-panel px-3.5 py-2.5">
                <summary className="cursor-pointer text-xs text-muted">Details</summary>
                <pre className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-muted">{result.details}</pre>
              </details>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
