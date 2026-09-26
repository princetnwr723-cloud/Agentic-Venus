import type { AvatarColor } from "@/lib/bots";

const fill: Record<AvatarColor, string> = {
  teal: "#3FC9AE",
  amber: "#EFA83B",
  violet: "#A98BF0",
  sky: "#5FA6F0",
  coral: "#F08A5E",
  sage: "#7FBF93",
};

function Face({ color, size }: { color: AvatarColor; size: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      aria-hidden="true"
      className="shrink-0"
    >
      <circle cx="20" cy="20" r="20" fill={fill[color]} />
      {/* two half-lidded dot eyes — a calm, always-on teammate, not a mouth or brand mark */}
      <circle cx="15.5" cy="19" r="2.1" fill="rgba(10,10,11,0.75)" />
      <circle cx="24.5" cy="19" r="2.1" fill="rgba(10,10,11,0.75)" />
    </svg>
  );
}

export default function BotAvatar({
  color,
  paired,
  size = 36,
  ring = false,
}: {
  color: AvatarColor;
  paired?: AvatarColor;
  size?: number;
  ring?: boolean;
}) {
  if (paired) {
    return (
      <div
        className="relative shrink-0"
        style={{ width: size, height: size }}
      >
        <div className="absolute left-0 top-0">
          <Face color={paired} size={size * 0.72} />
        </div>
        <div className="absolute bottom-0 right-0 rounded-full ring-2 ring-panel">
          <Face color={color} size={size * 0.72} />
        </div>
      </div>
    );
  }

  return (
    <div
      className={ring ? "rounded-full ring-2 ring-gold/70" : ""}
      style={{ width: size, height: size }}
    >
      <Face color={color} size={size} />
    </div>
  );
}