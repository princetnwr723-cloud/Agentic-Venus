// "Are you really finished?" The plan tools (plan.set / plan.done ...) end every result with a status line. If the agent stops
// talking while the last status still says steps are open, it is sent back to work (the loop limits how often).
import type { AgentMsg } from "./types.ts";

export function openPlanSteps(messages: AgentMsg[]): number | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== "user") continue;
    for (let j = m.content.length - 1; j >= 0; j--) {
      const b = m.content[j];
      if (b.type !== "tool_result") continue;
      const open = /PLAN OPEN: (\d+) step/.exec(b.content);
      if (open) return Number(open[1]);
      if (/PLAN COMPLETE|PLAN ENDED WITH BROKEN/.test(b.content)) return 0;
    }
  }
  return null;
}

export function planGate(messages: AgentMsg[]): string | null {
  const open = openPlanSteps(messages);
  return open && open > 0
    ? `NOT FINISHED: your plan still has ${open} open step(s). Continue with the next open step now. Close each step with plan.done and proof. Only write the final answer when the plan is complete, or close the remaining steps as failed/skipped with the real reason.`
    : null;
}
