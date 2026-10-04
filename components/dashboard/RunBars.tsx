export default function RunBars({
  venusRun, codeRun, teamRun,
}: {
  venusRun: { title: string; label: string; value: number | null } | null;
  codeRun: { title: string; label: string } | null;
  teamRun: string | null;
}) {
  if (!venusRun && !codeRun && !teamRun) return null;
  return (
    <div className="mx-auto w-full max-w-2xl space-y-2 px-6 pb-2">
      {venusRun && (
        <div className="rounded-lg border border-line bg-panel p-3 text-xs text-muted">
          <div className="flex justify-between"><span className="text-ink">🎬 Venus Pro · {venusRun.title}</span><span>{venusRun.value === null ? "…" : Math.round(venusRun.value * 100) + "%"}</span></div>
          <p className="mt-1 truncate">{venusRun.label}</p>
          <div className="mt-2 h-1 overflow-hidden rounded-full bg-panel2"><div className={`h-full rounded-full bg-gold ${venusRun.value === null ? "w-1/3 animate-pulse" : ""}`} style={venusRun.value === null ? undefined : { width: Math.round(venusRun.value * 100) + "%" }} /></div>
        </div>
      )}
      {codeRun && (
        <div className="rounded-lg border border-line bg-panel p-3 text-xs text-muted">
          <span className="text-ink">💻 Venus Code · {codeRun.title}</span><p className="mt-1 truncate">{codeRun.label}</p>
          <div className="mt-2 h-1 overflow-hidden rounded-full bg-panel2"><div className="h-full w-1/3 animate-pulse rounded-full bg-gold" /></div>
        </div>
      )}
      {teamRun && <div className="rounded-lg border border-line bg-panel p-3 text-xs text-muted"><span className="text-ink">👥 Team working · {teamRun}</span> — open the Team panel to follow along.</div>}
    </div>
  );
}
