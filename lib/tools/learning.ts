import type { Def } from "./plugins";
import { addMemoryServer, forgetMemoryServer, recallSearch, saveSkillServer } from "@/lib/learning";

const s = (v: unknown, n = 4000) => String(v ?? "").trim().slice(0, n);
const need = <T,>(ctx: T | undefined): T => { if (!ctx) throw new Error("This tool only works from a chat."); return ctx; };

export const LEARNING_TOOLS: Def[] = [
  {
    name: "recall.search", risk: "read", params: "query:string",
    description: "Search your own past: earlier chat messages, missions and phone-call summaries. Use it whenever the owner refers to something from before.",
    run: async (a, _c, ctx) => { const c = need(ctx); return recallSearch(c.uid, c.chatId, s(a.query, 300)); },
  },
  {
    name: "memory.save", risk: "read", params: "fact:string, kind?:fact|preference",
    description: "Remember a lasting fact or preference about the owner or their business (never passwords, keys or private data).",
    run: async (a, _c, ctx) => {
      const c = need(ctx);
      const saved = await addMemoryServer(c.uid, c.chatId, s(a.fact, 300), { kind: s(a.kind, 20) === "preference" ? "preference" : "fact" });
      return saved ? `Remembered: ${saved}` : "Not saved (duplicate, too short, or it looked like a secret).";
    },
  },
  {
    name: "memory.forget", risk: "write", params: "keyword:string",
    description: "Delete remembered items that contain this keyword.",
    run: async (a, _c, ctx) => { const c = need(ctx); return `Forgot ${await forgetMemoryServer(c.uid, c.chatId, s(a.keyword, 80))} item(s).`; },
  },
  {
    name: "skill.save", risk: "write", params: "name:string, description:string (what it does and when to use it), instructions:string (markdown steps)",
    description: "Create a reusable skill from a procedure you just worked out, or IMPROVE an existing skill (same name = a new version; the old one is kept). New skills start on trial and are proven by later successful use.",
    run: async (a, _c, ctx) => {
      const c = need(ctx);
      const k = await saveSkillServer(c.uid, c.chatId, { name: s(a.name, 80), description: s(a.description, 300), instructions: s(a.instructions, 20000), auto: true, trial: true });
      return `Skill "${k.name}" saved (v${k.version}, on trial).`;
    },
  },
];