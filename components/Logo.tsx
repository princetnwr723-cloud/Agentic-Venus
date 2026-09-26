export default function Logo({
  size = 22,
  withWordmark = true,
  className = "",
}: {
  size?: number;
  withWordmark?: boolean;
  className?: string;
}) {
  return (
    <div className={`flex items-center gap-2.5 ${className}`}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 32 32"
        fill="none"
        aria-hidden="true"
        className="shrink-0"
      >
        {/* abstract Venus mark: a ring in orbit with a steady core — the
           always-on teammate, not a literal planet */}
        <circle
          cx="16"
          cy="13"
          r="8.5"
          stroke="#E7B24D"
          strokeWidth="2.1"
        />
        <circle cx="16" cy="13" r="2.6" fill="#E7B24D" />
        <line
          x1="16"
          y1="21.5"
          x2="16"
          y2="27.5"
          stroke="#E7B24D"
          strokeWidth="2.1"
          strokeLinecap="round"
        />
        <line
          x1="12.2"
          y1="24.5"
          x2="19.8"
          y2="24.5"
          stroke="#E7B24D"
          strokeWidth="2.1"
          strokeLinecap="round"
        />
      </svg>
      {withWordmark && (
        <span className="text-[17px] font-semibold tracking-tight text-ink">
          AgenticVenus
        </span>
      )}
    </div>
  );
}