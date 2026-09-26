import { Clock } from "lucide-react";

export default function RoutinePill({ name }: { name: string }) {
  return (
    <div className="flex justify-center py-1">
      <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-panel px-3 py-1 text-xs text-muted">
        Created routine
        <Clock size={12} />
        <span className="text-ink">{name}</span>
      </span>
    </div>
  );
}