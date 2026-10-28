import type { Def } from "./plugins";
import { getAdminDb } from "@/lib/firebase-admin";
import {
  addMemoryServer, appendProgress, deleteSkillFile, deleteSkillServer, forgetMemoryServer, getSkill, listSkills, patchSkillServer,
  readAgentFiles, recallSearch, replaceMemoryServer, rollbackSkill, saveSkillServer, writeAgentFiles, writeSkillFile,
} from "@/lib/learning";
import { sanitizeFiles } from "@/lib/learn-utils";
import { installFromInput } from "@/lib/skill-install";
import { COLLAB_TOOLS } from "./collab";

const s = (v: unknown, n = 4000) => String(v ?? "").trim().slice(0, n);
const need = <T,>(ctx: T | undefined): T => { if (!ctx) throw new Error("This tool only works from a chat."); return ctx; };
const yes = (v: unknown) => v === true || /^(true|yes|1)$/i.test(String(v ?? ""));

export const LEARNING_TOOLS: Def[] = [
  {
    name: "files.read", risk: "read", params: "",
    description: "Read your own soul.md (who you are) and memory.md (what you know and did). They are also loaded into your prompt before every task.",
    run: async (_a, _c, ctx) => {
      const c = need(ctx);
      const f = await readAgentFiles(c.uid, c.chatId);
      return `# soul.md\n${f.soul}\n\n# memory.md\n${f.memory}`;
    },
  },
  {
    name: "memory.log", risk: "read", params: "line:string (one short line: what you did and the result, with proof)",
    description: "Add one dated line to the progress log in your memory.md. Call it right after you finish meaningful work so you stay good at this owner's tasks (never passwords, keys or private data).",
    run: async (a, _c, ctx) => {
      const c = need(ctx);
      await appendProgress(c.uid, c.chatId, s(a.line, 320));
      return "Logged in memory.md.";
    },
  },
  {
    name: "memory.rewrite", risk: "write", params: "content:string (the COMPLETE new memory.md, markdown; keep the '## Progress log' section)",
    description: "Rewrite your whole memory.md to organise it (merge duplicates, fix wrong notes). The owner approves it first.",
    run: async (a, _c, ctx) => {
      const c = need(ctx);
      const content = s(a.content, 14000);
      if (content.length < 20) throw new Error("content is too short.");
      await writeAgentFiles(c.uid, c.chatId, { memory: content });
      return `memory.md rewritten (${content.length} characters).`;
    },
  },
  {
    name: "soul.update", risk: "write", params: "content:string (the COMPLETE new soul.md, markdown)",
    description: "Change your soul.md (your identity, values and working style), for example when the owner tells you how you should behave from now on. The owner approves it first.",
    run: async (a, _c, ctx) => {
      const c = need(ctx);
      const content = s(a.content, 6000);
      if (content.length < 20) throw new Error("content is too short.");
      await writeAgentFiles(c.uid, c.chatId, { soul: content });
      return `soul.md updated (${content.length} characters).`;
    },
  },
  {
    name: "recall.search", risk: "read", params: "query:string, deep?:boolean (true = get a short written answer instead of raw snippets)",
    description: "Search your own past: earlier chat messages, missions, phone-call summaries and every task you finished. Use it whenever the owner refers to something from before ('last time', 'wo client', 'pichle hafte'). deep=true answers the question from the matches.",
    run: async (a, _c, ctx) => { const c = need(ctx); return recallSearch(c.uid, c.chatId, s(a.query, 300), { deep: yes(a.deep) }); },
  },
  {
    name: "memory.save", risk: "read", params: "fact:string, kind?:fact|preference|profile",
    description: "Remember a lasting fact or preference about the owner or their business (never passwords, keys or private data). Use it right away when the owner corrects you, states a preference or tells you how they like things done.",
    run: async (a, _c, ctx) => {
      const c = need(ctx);
      const k = s(a.kind, 20);
      const saved = await addMemoryServer(c.uid, c.chatId, s(a.fact, 400), { kind: k === "preference" ? "preference" : k === "profile" ? "profile" : "fact" });
      return saved ? `Remembered: ${saved}` : "Not saved (duplicate, too short, or it looked like a secret).";
    },
  },
  {
    name: "memory.replace", risk: "read", params: "old_text:string (a few words that appear in the old memory), new_text:string",
    description: "Correct something you remembered: the ONE memory that contains old_text is rewritten as new_text. Use it when a fact changed (the owner moved, changed a price, a preference flipped) instead of keeping both versions.",
    run: async (a, _c, ctx) => { const c = need(ctx); return replaceMemoryServer(c.uid, c.chatId, s(a.old_text, 120), s(a.new_text, 400)); },
  },
  {
    name: "profile.save", risk: "read", params: "fact:string (a lasting fact about the OWNER: name, role, business, goals, tools, language, habits, preferences)",
    description: "Save something you just learned ABOUT THE OWNER into their profile (shared by all their agents). Use it whenever the owner reveals lasting information about themselves, so you know them better over time.",
    run: async (a, _c, ctx) => {
      const c = need(ctx);
      const saved = await addMemoryServer(c.uid, c.chatId, s(a.fact, 400), { kind: "profile", weight: 2 });
      return saved ? `Added to the owner's profile: ${saved}` : "Not saved (already known, too short, or it looked like a secret).";
    },
  },
  {
    name: "memory.forget", risk: "write", params: "keyword:string",
    description: "Delete remembered items (chat memories and the owner profile) that contain this keyword.",
    run: async (a, _c, ctx) => { const c = need(ctx); return `Forgot ${await forgetMemoryServer(c.uid, c.chatId, s(a.keyword, 80))} item(s).`; },
  },
  {
    name: "skill.save", risk: "write",
    params: "name:string, description:string (what it does and when to use it), instructions:string (markdown steps), files?:json object like {\"references/guide.md\":\"text\"} (optional longer reference material, scripts or templates)",
    description: "Create a reusable skill from a procedure you just worked out. Do it right after a job that took 5 or more tool calls and will repeat. Same name = a new VERSION (the old one is kept); to change only a part use skill.patch. New skills start on trial and are proven by later successful use. Put real steps in it: what to open, what to check, what failed and how to avoid it.",
    run: async (a, _c, ctx) => {
      const c = need(ctx);
      const f = a.files === undefined || a.files === "" ? undefined : sanitizeFiles(a.files);
      const k = await saveSkillServer(c.uid, c.chatId, {
        name: s(a.name, 80), description: s(a.description, 300), instructions: s(a.instructions, 20000), auto: true, trial: true,
        files: f && Object.keys(f.files).length ? f.files : undefined,
      });
      const nf = k.files ? Object.keys(k.files).length : 0;
      return `Skill "${k.name}" saved (v${k.version}, on trial${nf ? `, ${nf} file${nf > 1 ? "s" : ""}` : ""}).${f && f.errors.length ? ` Some files were skipped: ${f.errors.join(" | ")}` : ""}`;
    },
  },
  {
    name: "skill.patch", risk: "write", params: "name:string, old_text:string (copied exactly from the skill), new_text:string, file?:string (e.g. references/guide.md, default = the main instructions), replace_all?:boolean",
    description: "Fix ONE part of a skill with find-and-replace, the moment you notice it is wrong, outdated or missing a step while you use it. Much safer than rewriting the whole skill. Read it first with skill.read and copy old_text exactly.",
    run: async (a, _c, ctx) => {
      const c = need(ctx);
      const r = await patchSkillServer(c.uid, c.chatId, {
        name: s(a.name, 80), oldStr: s(a.old_text, 20000), newStr: String(a.new_text ?? "").slice(0, 20000),
        file: s(a.file, 120) || undefined, replaceAll: yes(a.replace_all), auto: true,
      });
      return `Skill "${r.skill.name}" patched (${r.count} change${r.count > 1 ? "s" : ""}, now v${r.skill.version}).`;
    },
  },
  {
    name: "skill.write_file", risk: "write", params: "name:string, path:string (references/..., scripts/..., templates/..., assets/... or examples/...), content:string",
    description: "Add or replace a supporting file of a skill (long reference text, a script, a template). Keep SKILL instructions short and put the heavy material in files; load them later with skill.file.",
    run: async (a, _c, ctx) => {
      const c = need(ctx);
      const k = await writeSkillFile(c.uid, c.chatId, { name: s(a.name, 80), path: s(a.path, 120), content: String(a.content ?? "") });
      return `File saved in "${k.name}" (${Object.keys(k.files ?? {}).length} file(s), v${k.version}).`;
    },
  },
  {
    name: "skill.file", risk: "read", params: "name:string, path:string (one of the files listed by skill.read)",
    description: "Read one supporting file of a skill (a reference, script or template listed under 'Files' by skill.read).",
    run: async (a, _c, ctx) => {
      const c = need(ctx);
      const k = await getSkill(c.uid, c.chatId, s(a.name, 80));
      if (!k) return `No skill named "${s(a.name, 80)}". Use skill.list to see the names.`;
      const path = s(a.path, 120).replace(/^\.\//, "");
      const txt = k.files?.[path];
      return txt !== undefined ? `# ${k.name} / ${path}\n${txt}` : `That skill has no file "${path}". Files: ${Object.keys(k.files ?? {}).join(", ") || "(none)"}`;
    },
  },
  {
    name: "skill.delete_file", risk: "write", params: "name:string, path:string",
    description: "Remove one supporting file from a skill.",
    run: async (a, _c, ctx) => {
      const c = need(ctx);
      return (await deleteSkillFile(c.uid, c.chatId, { name: s(a.name, 80), path: s(a.path, 120) })) ? "File removed." : "No such file in that skill.";
    },
  },
  {
    name: "skill.rollback", risk: "write", params: "name:string",
    description: "Go back to the previous version of a skill's instructions (use it when your last change to the skill made things worse).",
    run: async (a, _c, ctx) => {
      const c = need(ctx);
      const k = await rollbackSkill(c.uid, c.chatId, s(a.name, 80));
      return `Skill "${k.name}" is back to its earlier text (now v${k.version}, on trial).`;
    },
  },
  {
    name: "skill.delete", risk: "write", params: "name:string",
    description: "Delete a skill that is useless or wrong. The owner approves it first.",
    run: async (a, _c, ctx) => {
      const c = need(ctx);
      const n = await deleteSkillServer(c.uid, c.chatId, s(a.name, 80));
      return n ? `Skill "${n}" deleted.` : `No skill named "${s(a.name, 80)}".`;
    },
  },
  {
    name: "skill.install", risk: "write", params: "source:string (a SKILL.md URL, a GitHub repo link or owner/repo, an 'npx skills add owner/repo' command, or the pasted skill text)",
    description: "Install a skill while you work: when the task needs know-how you do not have, find a skill (web.search) and install it, then follow it. Also use it when the owner shares a skill link or command. GitHub skills come with their references/scripts/templates files. Installed skills start on trial. The owner approves it first.",
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
        ? list.map((k) => `- ${k.name} [${(k.tags ?? ["general"]).join(", ")}]${k.disabled ? " (paused)" : ""}${k.trial ? " (on trial)" : ""} — ${k.description} · ✓${k.wins ?? 0} ✗${k.fails ?? 0} · v${k.version ?? 1}${k.files && Object.keys(k.files).length ? ` · ${Object.keys(k.files).length} files` : ""}`).join("\n")
        : "No skills installed yet.";
    },
  },
  {
    name: "skill.read", risk: "read", params: "name:string",
    description: "Load the full instructions of one skill (and the list of its supporting files). Call it BEFORE doing a job that fits that skill, then follow the instructions closely.",
    run: async (a, _c, ctx) => {
      const c = need(ctx);
      const k = await getSkill(c.uid, c.chatId, s(a.name, 80));
      if (!k) return `No skill named "${s(a.name, 80)}". Use skill.list to see the names.`;
      const files = Object.keys(k.files ?? {});
      return `# Skill: ${k.name} (v${k.version ?? 1}${k.trial ? ", on trial" : ""})\n${k.instructions.slice(0, 12000)}${files.length ? `\n\nFiles (load one with skill.file): ${files.join(", ")}` : ""}`;
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
  ...COLLAB_TOOLS,
];
