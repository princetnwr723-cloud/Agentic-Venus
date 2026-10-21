import BotAvatar from "@/components/BotAvatar";

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
      {/* the red mascot, fixed: no animation */}
      <BotAvatar color="red-calm" size={Math.round(size * 1.6)} animate={false} />
      {withWordmark && (
        <span className="text-[17px] font-semibold tracking-tight text-ink">
          AgenticVenus
        </span>
      )}
    </div>
  );
}
