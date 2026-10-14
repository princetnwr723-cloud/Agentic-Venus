// Tools that let an agent use the work of the owner's other agents (chats).
import type { Def } from "./plugins";
import type { ToolCtx } from "./types";
import { accessOf, briefAgent, findAgent, listAgents, readAgentFile } from "@/lib/collab";

const s = (v: unknown, n = 500) => String(v ?? "").trim().slice(0, n);
const need = (ctx: ToolCtx | undefined): ToolCtx => { if (!ctx) throw new Error("This tool only works from a chat."); return ctx; };

const OFF =
  "Agent cooperation is OFF for this chat. Tell the owner: open this agent's profile and switch on \"Agent cooperation\", " +
  "or mention the other agent with @ in the message (for example @UI_Agent).";

async function target(c: ToolCtx, ref: unknown) {
  const t = await findAgent(c.uid, c.chatId, s(ref, 120));
  if (!t) throw new Error(`No other agent matches "${s(ref, 60)}". Use collab.agents to see the names.`);
  const a = await accessOf(c.uid, c.chatId);
  if (!a.all && !a.ids.includes(t.id)) throw new Error(OFF);
  return t;
}

export const COLLAB_TOOLS: Def[] = [
  {
    name: "collab.agents", risk: "read", params: "",
    description: "List the owner's OTHER agents (chats): name, role, what each did last, and whether it has a code workspace. Use it to find out who already did work you can reuse.",
    run: async (_a, _c, ctx) => {
      const c = need(ctx);
      const a = await accessOf(c.uid, c.chatId);
      if (!a.all && !a.ids.length) throw new Error(OFF);
      const list = (await listAgents(c.uid, c.chatId)).filter((x) => a.all || a.ids.includes(x.id));
      return list.length
        ? list.map((x) => `- ${x.name}${x.role ? ` (${x.role})` : ""}${x.code ? " [has code workspace]" : ""}${x.last ? ` — last: ${x.last}` : ""}`).join("\n")
        : "There are no other agents yet.";
    },
  },
  {
    name: "collab.ask", risk: "read", params: "agent:string (name), query?:string (what you need from it, e.g. 'navbar and button components')",
    description:
      "Read another agent's work for this task: its role, what it knows about the owner, its skills, relevant earlier work and, if it built software, its workspace files with the content of the most relevant ones. " +
      "Use it BEFORE you start work that overlaps that agent's area, then reuse its results and style and say which agent they came from.",
    run: async (a, _c, ctx) => {
      const c = need(ctx);
      const t = await target(c, a.agent);
      const b = await briefAgent(c.uid, t.id, s(a.query, 300) || "recent work", { budget: 7000, code: true });
      return b ? `=== ${b.name} ===\n${b.text}` : "That agent could not be read.";
    },
  },
  {
    name: "collab.read_file", risk: "read", params: "agent:string (name), path:string (file in that agent's code workspace, e.g. src/components/Navbar.tsx)",
    description: "Read ONE file from another agent's code workspace (up to 14 KB). Copy what you need into your own work; never change the other agent's files.",
    run: async (a, _c, ctx) => {
      const c = need(ctx);
      const t = await target(c, a.agent);
      const text = await readAgentFile(c.uid, t.id, s(a.path, 300));
      return `${t.name}: ${s(a.path, 300)}\n\`\`\`\n${text}\n\`\`\``;
    },
  },
];