import type { ToolStep } from "@/lib/bots";

export default function ToolCallCard({ steps }: { steps: ToolStep[] }) {
  return (
    <div className="max-w-[85%] space-y-2 rounded-xl border border-line bg-panel2 px-4 py-3.5 text-sm">
      {steps.map((step) => (
        <div key={step.label} className="flex flex-wrap items-center gap-1.5">
          <span className="text-avatar-teal">✓</span>
          <span className="font-medium text-ink">{step.label}</span>
          <span className="text-muted">→ {step.detail}</span>
        </div>
      ))}
    </div>
  );
}