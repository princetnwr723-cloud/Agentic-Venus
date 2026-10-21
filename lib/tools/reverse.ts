// reverse.guide: the REA ("Reverse Engineer Anything") playbook for the chat agent.
// The analysis itself runs on the agent's computer (where the `rea` command is installed); this tool tells the agent
// what is allowed, how to analyse, and how to turn the findings into the owner's own free, unlimited implementation.
import type { Def } from "./plugins";
import { REA_GUIDE, reaBlocked } from "@/lib/rea-policy";

export const REVERSE_TOOLS: Def[] = [
  {
    name: "reverse.guide", risk: "read", params: "goal?:string (what the owner wants to understand or rebuild)",
    description:
      "Reverse engineering with REA (Reverse Engineer Anything). Read it BEFORE any job like \"analyse this app / website / APK\", \"how does this tool work\" or \"build our own free version of this feature\". " +
      "Returns what is allowed, how to analyse on the computer (the `rea` command), and the clean-room steps to build the owner's own free, unlimited version. " +
      "Cracks, licence / paywall / quota bypass and copying protected code are refused here and everywhere.",
    run: async (a) => {
      const goal = String(a.goal ?? "").trim().slice(0, 1500);
      const blocked = reaBlocked(goal);
      if (blocked) return `NOT ALLOWED. ${blocked}`;
      return REA_GUIDE;
    },
  },
];
