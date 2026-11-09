import DecksRail from "@/components/decks/DecksRail";

// Venus Code gets a "Decks" column (presentations) next to its own project list.
export default function CodeLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen">
      <DecksRail />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}