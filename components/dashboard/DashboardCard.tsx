"use client";
// The small dashboard card in the Identity panel (Profile tab, right under "Agent cooperation").
// It shows the live numbers of this chat's dashboard and opens the full dashboard.
import { useState } from "react";
import { ArrowRight, CalendarCheck, CheckCheck, Code2, Phone } from "lucide-react";
import AgentDashboard, { DashboardStyles, useCount, useDashStats } from "@/components/dashboard/AgentDashboard";
import type { AvatarColor } from "@/lib/bots";

const fmt = (n: number) => new Intl.NumberFormat("en-US").format(Math.round(n));

function Tile({ label, value, delta, icon }: { label: string; value: number; delta: number | null; icon: React.ReactNode }) {
  const v = useCount(value);
  return (
    <div className="vd-kpi" style={{ padding: "14px 16px", borderRadius: 20, cursor: "default" }}>
      <div className="vd-kl" style={{ fontSize: 12, paddingRight: 34 }}>{label}</div>
      <span className="vd-kic" style={{ width: 30, height: 30, right: 12, top: 10 }}>{icon}</span>
      <div className="vd-kv" style={{ fontSize: 24, margin: "6px 0 0" }}>{fmt(v)}{delta !== null && <span className={`vd-badge ${delta < 0 ? "down" : ""}`}>{delta >= 0 ? "+" : ""}{delta}%</span>}</div>
    </div>
  );
}

function Spark({ a, b }: { a: number[]; b: number[] }) {
  const W = 300, H = 70, max = Math.max(1, ...a, ...b);
  const pts = (v: number[]) => v.map((n, i) => `${(i * W) / Math.max(1, v.length - 1)},${H - 6 - (n / max) * (H - 14)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: 64, display: "block" }} aria-hidden>
      <polyline points={pts(a)} fill="none" stroke="var(--vd-blue)" strokeWidth="1.8" strokeLinejoin="round" />
      <polyline points={pts(b)} fill="none" stroke="var(--vd-purple)" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}

export default function DashboardCard({ chatId, agentName, color, enabledHint }: { chatId: string; agentName: string; color: AvatarColor; enabledHint?: boolean }) {
  const { stats, error } = useDashStats(chatId, true);
  const [full, setFull] = useState(false);

  if (stats && !stats.enabled) {
    return (
      <div className="mt-4 rounded-lg border border-dashed border-line p-3 text-[11px] leading-relaxed text-muted">
        <p className="text-sm font-medium text-ink">📊 Dashboard</p>
        <p className="mt-1">Is chat ka dashboard abhi nahi bana. Chat me <b className="text-ink">[dashboard</b> likho: ek hi baar banta hai, phir yahin (Agent cooperation ke neeche) hamesha dikhega aur apne aap update hoga.</p>
      </div>
    );
  }
  if (!stats) {
    return (
      <div className="mt-4 rounded-lg border border-line p-3 text-[11px] text-muted">
        <p className="text-sm font-medium text-ink">📊 Dashboard</p>
        <p className="mt-1">{error ? error : enabledHint === false ? "" : "Loading…"}</p>
      </div>
    );
  }
  const k = stats.kpis!, s = stats.series!;
  return (
    <div className="vd-root mt-4" style={{ color: "inherit" }}>
      <DashboardStyles />
      <div style={{ border: "1px solid var(--vd-line)", borderRadius: 24, background: "var(--vd-panel)", padding: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div className="vd-orb" style={{ width: 44, height: 44, animationDuration: "6s" }} aria-hidden />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 15, fontWeight: 500 }}>Dashboard</div>
            <div className="vd-live" style={{ marginTop: 2 }}><i />Live · {stats.agent?.successPct == null ? "no judged tasks yet" : `${stats.agent.successPct}% success`}</div>
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 12 }}>
          <Tile label="Tasks done" value={k.tasks.value} delta={k.tasks.delta} icon={<CheckCheck size={14} />} />
          <Tile label="Calls made" value={k.calls.value} delta={k.calls.delta} icon={<Phone size={14} />} />
          <Tile label="Code (lines)" value={k.code.value} delta={null} icon={<Code2 size={14} />} />
          <Tile label="Clients booked" value={k.bookings.value} delta={k.bookings.delta} icon={<CalendarCheck size={14} />} />
        </div>
        <div style={{ marginTop: 10 }}><Spark a={s.tasks} b={s.calls} /></div>
        <button type="button" className="vd-cta" style={{ width: "100%", justifyContent: "center", padding: "13px 18px", fontSize: 14, marginTop: 8 }} onClick={() => setFull(true)}>Open full dashboard <ArrowRight size={17} /></button>
      </div>
      <AgentDashboard open={full} onClose={() => setFull(false)} chatId={chatId} agentName={agentName} color={color} />
    </div>
  );
}