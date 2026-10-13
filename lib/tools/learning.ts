import type { Def } from "./plugins";
import { getAdminDb } from "@/lib/firebase-admin";
import { addMemoryServer, forgetMemoryServer, listSkills, recallSearch, saveSkillServer } from "@/lib/learning";
import { installFromInput } from "@/lib/skill-install";

const s = (v: unknown, n = 4000) => String(v ?? "").trim().slice(0, n);
const need = <T,>(ctx: T | undefined): T => { if (!ctx) throw new Error("This tool only works from a chat."); return ctx; };

export const LEARNING_TOOLS: Def[] = [
  {
    name: "recall.search", risk: "read", params: "query:string",
    description: "Search your own past: earlier chat messages, missions and phone-call summaries. Use it whenever the owner refers to something from before.",
    run: async (a, _c, ctx) => { const c = need(ctx); return recallSearch(c.uid, c.chatId, s(a.query, 300)); },
  },
  {
    name: "memory.save", risk: "read", params: "fact:string, kind?:fact|preference|profile",
    description: "Remember a lasting fact or preference about the owner or their business (never passwords, keys or private data).",
    run: async (a, _c, ctx) => {
      const c = need(ctx);
      const k = s(a.kind, 20);
      const saved = await addMemoryServer(c.uid, c.chatId, s(a.fact, 300), { kind: k === "preference" ? "preference" : k === "profile" ? "profile" : "fact" });
      return saved ? `Remembered: ${saved}` : "Not saved (duplicate, too short, or it looked like a secret).";
    },
  },
  {
    name: "profile.save", risk: "read", params: "fact:string (a lasting fact about the OWNER: name, role, business, goals, tools, language, habits, preferences)",
    description: "Save something you just learned ABOUT THE OWNER into their profile. Use it whenever the owner reveals lasting information about themselves, so you know them better over time.",
    run: async (a, _c, ctx) => {
      const c = need(ctx);
      const saved = await addMemoryServer(c.uid, c.chatId, s(a.fact, 300), { kind: "profile", weight: 2 });
      return saved ? `Added to the owner's profile: ${saved}` : "Not saved (already known, too short, or it looked like a secret).";
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
  {
    name: "skill.install", risk: "write", params: "source:string (a SKILL.md URL, a GitHub repo link or owner/repo, an 'npx skills add owner/repo' command, or the pasted skill text)",
    description: "Install a skill while you work: when the task needs know-how you do not have, find a skill (web.search) and install it, then follow it. Also use it when the owner shares a skill link or command. Installed skills start on trial. The owner approves it first.",
    run: async (a, _c, ctx) => {
      const c = need(ctx);
      const r = await installFromInput(c.uid, c.chatId, s(a.source, 120_000), { trial: true });
      if (!r.names.length) throw new Error(r.errors.join(" | ") || "Nothing was installed.");
      return `Installed: ${r.names.join(", ")}. Read it now with skill.read and follow it.${r.errors.length ? `\nProblems: ${r.errors.join(" | ")}` : ""}`;
    },
  },
  {
    name: "skill.list", risk: "read", params: "",
    description: "List the skills you have learned or installed (name, type, what it is for, track record).",
    run: async (_a, _c, ctx) => {
      const c = need(ctx);
      const list = await listSkills(c.uid, c.chatId);
      return list.length
        ? list.map((k) => `- ${k.name} [${(k.tags ?? ["general"]).join(", ")}]${k.disabled ? " (paused)" : ""}${k.trial ? " (on trial)" : ""} — ${k.description} · ✓${k.wins ?? 0} ✗${k.fails ?? 0}`).join("\n")
        : "No skills installed yet.";
    },
  },
  {
    name: "skill.read", risk: "read", params: "name:string",
    description: "Load the full instructions of one skill. Call it BEFORE doing a job that fits that skill, then follow the instructions closely.",
    run: async (a, _c, ctx) => {
      const c = need(ctx);
      const want = s(a.name, 80).toLowerCase();
      const k = (await listSkills(c.uid, c.chatId)).find((x) => x.name.toLowerCase() === want) ?? (await listSkills(c.uid, c.chatId)).find((x) => x.name.toLowerCase().includes(want));
      return k ? `# Skill: ${k.name}\n${k.instructions.slice(0, 12000)}` : `No skill named "${s(a.name, 80)}". Use skill.list to see the names.`;
    },
  },
  {
    name: "proactive.set", risk: "read", params: "enabled:boolean",
    description: "Turn the daily proactive message (a useful nudge or idea from you) on or off for this chat. Use it when the owner asks you to be more or less proactive.",
    run: async (a, _c, ctx) => {
      const c = need(ctx);
      const on = a.enabled !== false && String(a.enabled).toLowerCase() !== "false";
      await getAdminDb().collection("users").doc(c.uid).collection("chats").doc(c.chatId).update({ proactive: on });
      return on ? "Proactive messages are ON (at most one a day)." : "Proactive messages are OFF.";
    },
  },
];