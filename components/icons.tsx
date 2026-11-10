// Small SVG icons drawn for AgenticVenus buttons (they take the text color, so they work in Night and Light mode).
type P = { size?: number; className?: string };
const base = (size: number) => ({ width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true });

/** Dashboard: four tiles of different sizes. */
export function DashboardIcon({ size = 20, className }: P) {
  return (
    <svg {...base(size)} className={className}>
      <rect x="3" y="3" width="8" height="10" rx="2.2" />
      <rect x="13" y="3" width="8" height="6" rx="2.2" />
      <rect x="13" y="11" width="8" height="10" rx="2.2" />
      <rect x="3" y="15" width="8" height="6" rx="2.2" />
    </svg>
  );
}

/** Decks: a presentation screen on a stand with a play mark. */
export function DeckIcon({ size = 20, className }: P) {
  return (
    <svg {...base(size)} className={className}>
      <rect x="3" y="3.5" width="18" height="12.5" rx="2.4" />
      <path d="M12 16v4M8 20.5h8" />
      <path d="M10.2 7.6l4.2 2.15-4.2 2.15z" fill="currentColor" />
    </svg>
  );
}

/** Sparkle: "generate". */
export function SparkIcon({ size = 18, className }: P) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M12 3l1.9 5.3L19.2 10l-5.3 1.9L12 17.2l-1.9-5.3L4.8 10l5.3-1.7z" />
      <path d="M19 16.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z" />
    </svg>
  );
}