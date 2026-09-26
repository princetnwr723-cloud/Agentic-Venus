import type { ThreadMessage } from "@/lib/bots";
import ToolCallCard from "./ToolCallCard";
import RoutinePill from "./RoutinePill";

export default function ChatThread({
  messages,
}: {
  messages: ThreadMessage[];
}) {
  return (
    <div className="space-y-4">
      {messages.map((m, i) => {
        if (m.kind === "tool-run") {
          return <ToolCallCard key={i} steps={m.steps} />;
        }
        if (m.kind === "routine") {
          return <RoutinePill key={i} name={m.name} />;
        }
        if (m.kind === "cross-bot") {
          return (
            <div key={i} className="space-y-2">
              <p className="text-center text-xs text-faint">
                Messages from {m.from}
              </p>
              <div className="mx-auto max-w-[85%] rounded-xl border border-line bg-panel2 px-4 py-3 text-sm leading-relaxed text-ink">
                {m.body}
              </div>
            </div>
          );
        }
        // text
        const fromUser = m.from === "user";
        return (
          <div
            key={i}
            className={`flex ${fromUser ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[75%] rounded-xl px-4 py-2.5 text-sm leading-relaxed ${
                fromUser
                  ? "bg-ink text-bg"
                  : "border border-line bg-panel2 text-ink"
              }`}
            >
              {m.body}
            </div>
          </div>
        );
      })}
    </div>
  );
}