// The AgenticVenus tools that exist only for Claude (MCP): the chat picker, the chat's computer, Venus Code, the browser, the team
// roster and Venus Pro with a storyboard that Claude writes itself. Pure: every server action comes in through `deps`, so it is testable.
// Rule: Claude's own model is the brain. Nothing here calls the chat's saved model or API key.
import { planClaudeVideo } from "./video-core.ts";
import { checkCode } from "../venus-schema.ts";
import type { ToolOutcome } from "./rpc.ts";
import { clip, findMember, looksSecret, oneLine, parseReply, transcript, type GMember, type GMsg } from "../group-core.ts";

export type ChatInfo = {
  id: string; name: string; provider: string; model: string; messages: number; lastAt: number; lastText: string;
  pc: "none" | "on" | "paused"; code: boolean; repo: string; connected: string[]; team: string[];
};
export type ChatDetail = ChatInfo & { recent: { role: string; content: string }[] };
export type CodeCall = { name: string; attrs: Record<string, string>; body: string; old?: string; new?: string };

export type NativeDeps = {
  listChats: (uid: string) => Promise<ChatInfo[]>;
  chatDetail: (uid: string, chat: string) => Promise<ChatDetail | null>;
  screenshot: (uid: string, chat: string) => Promise<{ mediaType: string; data: string }>;
  pcAction: (uid: string, chat: string, action: Record<string, unknown>) => Promise<string>;
  shell: (uid: string, chat: string, command: string) => Promise<string>;
  shellOutput: (uid: string, chat: string, job: string) => Promise<string>;
  code: (uid: string, chat: string, call: CodeCall) => Promise<{ text: string; image?: { mediaType: string; data: string } }>;
  browser: (uid: string, url: string, ops: Record<string, unknown>[]) => Promise<string>;
  sceneGuide: (aspect: string, seconds: number) => string;
  roster: (uid: string, chat: string) => Promise<string>;
  groupMembers: (uid: string, chat: string) => Promise<GMember[]>;
  groupMsgs: (uid: string, chat: string, n: number) => Promise<GMsg[]>;
  groupState: (uid: string, chat: string) => Promise<{ pins: string[]; memory: Record<string, string[]>; working: Record<string, string>; running: string[] }>;
  groupPost: (uid: string, chat: string, m: { from: string; text: string; kind: GMsg["kind"]; to?: string[] }) => Promise<void>;
  groupSave: (uid: string, chat: string, member: string, notes: string[], pins: string[]) => Promise<void>;
  groupWorking: (uid: string, chat: string, member: string, text: string | null) => Promise<void>;
  startVideo: (uid: string, chat: string, plan: NonNullable<ReturnType<typeof okPlan>>) => Promise<string>;
};
const okPlan = (p: ReturnType<typeof planClaudeVideo>) => ("error" in p ? null : p);

export type NativeSpec = { name: string; description: string; inputSchema: Record<string, unknown>; write: boolean; needsChat: boolean };

const CHAT_PROP = { type: "string", description: "The AgenticVenus chat id (get it from venus__chats). One Claude chat works with one AgenticVenus chat." };
function spec(name: string, description: string, props: Record<string, unknown>, required: string[], write: boolean, needsChat = true): NativeSpec {
  return {
    name, description, write, needsChat,
    inputSchema: { type: "object", properties: needsChat ? { chat: CHAT_PROP, ...props } : props, required: needsChat ? ["chat", ...required] : required },
  };
}
const str = (d: string) => ({ type: "string", description: d });
const num = (d: string) => ({ type: "number", description: d });

export const NATIVE_SPECS: NativeSpec[] = [
  spec("venus.chats", "START HERE. Lists ALL AgenticVenus chats of this account (id, name, model, computer, code workspace, connected tools, team). Show the list to the person and ask which chat to work in; then pass that chat id as `chat` to every other tool.", {}, [], false, false),
  spec("venus.chat", "Details of one chat: its computer, code workspace, repository, connected tools, team members and the last messages. Call this after the person picked a chat.", {}, [], false),
  spec("computer.status", "Is this chat's cloud computer on, paused or missing?", {}, [], false),
  spec("computer.screenshot", "See the screen of this chat's cloud computer (returns an image).", {}, [], false),
  spec("computer.act", "Do one action on the cloud computer's screen: click, double_click, right_click, type, key, scroll, wait, open_url, search, launch. Take a screenshot afterwards to check the result.", {
    type: { type: "string", enum: ["click", "double_click", "right_click", "type", "key", "scroll", "wait", "open_url", "search", "launch"] },
    x: num("pixel x"), y: num("pixel y"), text: str("text to type"), keys: str("e.g. ctrl+l or Enter"), direction: str("up or down"), amount: num("scroll steps"),
    seconds: num("wait 1-5 seconds"), url: str("for open_url"), query: str("for search"), app: str("chrome, firefox, terminal, code, files"),
  }, ["type"], true),
  spec("computer.shell", "Run a shell command on the cloud computer (it is visible in a terminal window). Long commands return a job id: read the rest with computer__shell_output.", { command: str("the command") }, ["command"], true),
  spec("computer.shell_output", "Read the output of a running shell job.", { job: str("job id") }, ["job"], false),
  spec("code.read", "Venus Code: read a file of the chat's workspace.", { path: str("file path"), offset: num("first line"), limit: num("lines") }, ["path"], false),
  spec("code.ls", "Venus Code: list a folder.", { path: str("folder, default .") }, [], false),
  spec("code.glob", "Venus Code: find files by pattern, e.g. src/**/*.ts", { pattern: str("glob pattern") }, ["pattern"], false),
  spec("code.grep", "Venus Code: search text in the workspace.", { pattern: str("regex"), path: str("folder or file"), glob: str("file filter") }, ["pattern"], false),
  spec("code.write", "Venus Code: create or overwrite a file (full content).", { path: str("file path"), content: str("the whole file") }, ["path", "content"], true),
  spec("code.edit", "Venus Code: replace exact text in a file.", { path: str("file path"), old: str("exact text to replace"), new: str("new text"), replace_all: { type: "boolean" } }, ["path", "old", "new"], true),
  spec("code.bash", "Venus Code: run a command in the workspace (install, build, test, git). Long ones return a job id: read with code__bash_output.", { command: str("the command"), timeout: num("seconds, max 40"), background: { type: "boolean" } }, ["command"], true),
  spec("code.bash_output", "Venus Code: read the output of a running job.", { job: str("job id") }, ["job"], false),
  spec("code.look", "Venus Code: open an html file on the computer's screen and return a screenshot.", { path: str("html file, default index.html") }, [], false),
  spec("browser.run", "Open a public web page in a headless browser and read it (links and buttons are numbered). Optional ops click/type/press/scroll/wait act on it before the snapshot. No logins here: use computer__* for signed-in sites.", {
    url: str("https://..."),
    ops: { type: "array", description: 'e.g. [{"op":"click_label","label":"Accept"},{"op":"type_label","label":"Search","text":"x"},{"op":"press","key":"Enter"}]', items: { type: "object" } },
  }, ["url"], false, false),
  spec("team.roster", "The AI team of this chat (names, roles, skills). YOU play the team: pick the right member for each step and work as them with the tools you have.", {}, [], false),
  spec("group.read", "GROUP CHAT of this chat's team: the latest messages (owner and members), pinned facts, each member's lasting notes, who is working right now. Read it before you answer, so you know what the owner and the members already said. " +
    "If a turn is still running on the AgenticVenus server (running list), members are already answering there: do not answer the same message twice.", { limit: num("messages, default 20, max 60") }, [], false),
  spec("group.post", "Write a message INTO the group chat. `member` = the team member who speaks (an id from team__roster or group__read, e.g. chief). You do the thinking and work as that member, then post the result here so the owner sees it in the group chat on the site. " +
    "Use member \"you\" only to put the owner's own words into the group. Optional: note (one lasting fact the member should remember), pin (a decision the whole group keeps), to (member ids addressed). Never put passwords or keys in a message.", {
    member: str("member id, or you"), text: str("the message"), kind: { type: "string", enum: ["say", "result", "ask"] },
    to: { type: "array", items: { type: "string" } }, note: str("lasting note for this member"), pin: str("fact pinned for the whole group"),
  }, ["member", "text"], true),
  spec("group.working", "Show in the group chat that a member is busy (a small status like 'finding leads') or clear it with an empty text. Clear it when the work is done.", { member: str("member id"), text: str("status, empty to clear") }, ["member"], true),
  spec("venus.scene_guide", "READ THIS BEFORE writing a video. The exact rules, the helper kit and a code example for writing your OWN animated scene (Remotion/React code). Nothing in a Venus Pro video is fixed: you design every scene's animation and motion graphics yourself.", {
    aspect: { type: "string", enum: ["16:9", "9:16", "1:1"] }, seconds: num("length of the scene, default 5"),
  }, [], false, false),
  spec("venus.scene_check", "Check the code of a custom scene BEFORE sending the video: returns OK or exactly what to fix (forbidden calls, wrong imports, missing export default, too long).", { code: str("the scene's TSX code") }, ["code"], false, false),
  spec("venus.make_video", "Make a finished video with Venus Pro. YOU are the director, motion designer and editor: write the storyboard AND the animation of every scene yourself (no model runs on the AgenticVenus server for the script or design). " +
    "BEST RESULT: make the important scenes {type:\"custom\", seconds, brief, headline?, code:\"<your Remotion TSX>\"} with your own animation, motion graphics, shapes, camera moves and timing (call venus__scene_guide first, test the code with venus__scene_check). The scene reads its text and numbers from the other fields of the scene (p). " +
    "The library types below are only quick shortcuts for simple scenes. It then renders in the background (10-30 min) and the owner gets the link in the chat. " +
    "Other scene types: title{headline,subhead?} kinetic{text,emphasis?} bullets{headline,items[]} stat{label,value,prefix?,suffix?,caption?} bar-chart{headline,data:[{label,value}]} line-chart{headline,data} quote{text,author?} " +
    "split{headline?,left:{title,points},right:{title,points}} timeline{headline,steps:[{label,text}]} ranking{headline,items:[{title,note?}]} image{headline?,imageQuery} footage{headline?,footageQuery} outro{headline,subhead?,handle?}. " +
    "Optional per scene: transition, camera, sounds. Optional storyboard-level: palette{bg1,bg2,accent,accent2,text,muted}, fonts, bg, audio{mood}. Voice-over is off unless voice:true (needs an OpenAI key in the account). A custom scene without code is shown as a plain text scene, so always send code for custom scenes.", {
    title: str("video title"), aspect: { type: "string", enum: ["16:9", "9:16", "1:1"] }, theme: { type: "string", enum: ["midnight", "sunset", "emerald", "gold", "paper", "neon"] },
    voice: { type: "boolean" }, captions: { type: "boolean" }, quality: { type: "string", enum: ["720p", "1080p"] },
    scenes: { type: "array", items: { type: "object" }, description: "the scenes (3-60)" },
    palette: { type: "object" }, fonts: { type: "object" }, bg: { type: "object" }, audio: { type: "object" },
  }, ["title", "scenes"], true),
];

const NAMES = new Set(NATIVE_SPECS.map((s) => s.name));
export const isNative = (name: string) => NAMES.has(name);
export const CHAT_RE = /^[A-Za-z0-9_-]{1,64}$/;
const fail = (text: string): ToolOutcome => ({ text, isError: true });
const s = (v: unknown, n = 4000) => (typeof v === "string" ? v : v == null ? "" : String(v)).slice(0, n);
const when = (t: number) => (t ? new Date(t).toISOString().slice(0, 16).replace("T", " ") : "-");

function line(c: ChatInfo, i: number): string {
  return `${i + 1}. ${c.name} [id: ${c.id}] - model ${c.provider}/${c.model}, computer ${c.pc}, code ${c.code ? "yes" + (c.repo ? " (" + c.repo + ")" : "") : "no"}, ` +
    `tools: ${c.connected.join(", ") || "none"}, team: ${c.team.length || 1}, ${c.messages} messages, last ${when(c.lastAt)}${c.lastText ? ' - "' + c.lastText.replace(/\s+/g, " ").slice(0, 80) + '"' : ""}`;
}

export const WRITE_OFF =
  "Not done: this action changes something and write access is OFF for this connection. Tell the person: open the AgenticVenus \"Connect to Claude\" page (their site address + /mcp), find this app under \"Connected apps\" and press \"Actions ON karo\". No need to disconnect.";

export async function runNative(name: string, args: Record<string, unknown>, ctx: { uid: string; write: boolean; deps: NativeDeps }): Promise<ToolOutcome | null> {
  const sp = NATIVE_SPECS.find((x) => x.name === name);
  if (!sp) return null;
  const { uid, deps } = ctx;
  if (sp.write && !ctx.write) return fail(WRITE_OFF);
  try {
    if (name === "venus.chats") {
      const list = await deps.listChats(uid);
      if (!list.length) return { text: "This account has no chats yet. Ask the person to create a chat in AgenticVenus first.", isError: false };
      return { text: `${list.length} chats. Ask the person which one to use, then pass its id as "chat":\n` + list.map(line).join("\n"), isError: false };
    }
    if (name === "venus.scene_guide") {
      const asp = s(args.aspect, 8);
      return { text: deps.sceneGuide(/^(16:9|9:16|1:1)$/.test(asp) ? asp : "16:9", Math.min(60, Math.max(2, Number(args.seconds) || 5))), isError: false };
    }
    if (name === "venus.scene_check") {
      const code = s(args.code, 60_000);
      const bad = checkCode(code);
      return { text: bad ? `NOT OK: ${bad}` : "OK: the code passes the safety and format check. It is rendered for real when the video runs; if a scene fails to render it is shown as a plain text scene.", isError: false };
    }
    if (name === "browser.run") {
      const url = s(args.url, 2000);
      if (!url) return fail("url is required.");
      const ops = (Array.isArray(args.ops) ? args.ops : []).slice(0, 12).filter((o): o is Record<string, unknown> => !!o && typeof o === "object" && /^(click|type|click_label|type_label|press|scroll|wait)$/.test(s((o as Record<string, unknown>).op, 20)));
      return { text: await deps.browser(uid, url, ops), isError: false };
    }

    const chat = s(args.chat, 80);
    if (!CHAT_RE.test(chat) || chat === "mcp") return fail('"chat" is missing or wrong. Call venus__chats, let the person pick a chat, and pass its id.');

    switch (name) {
      case "venus.chat": {
        const d = await deps.chatDetail(uid, chat);
        if (!d) return fail("No such chat in this account. Call venus__chats again.");
        const recent = d.recent.map((m) => `${m.role}: ${m.content.replace(/\s+/g, " ").slice(0, 240)}`).join("\n");
        return { text: `Selected chat:\n${line(d, 0)}\n\nLast messages:\n${recent || "(none)"}\n\nYou can now use computer__*, code__*, team__roster, venus__make_video and every other tool with chat="${d.id}". venus__tools searches connected apps and the 1000+ built-in tools.`, isError: false };
      }
      case "computer.status": {
        const pc = (await deps.chatDetail(uid, chat))?.pc;
        return { text: pc === "on" ? "The computer is ON." : pc === "paused" ? "The computer is paused; computer__screenshot or computer__act wakes it." : "This chat has no computer yet. Ask the person to turn it on in AgenticVenus (Computer button).", isError: false };
      }
      case "computer.screenshot": { const img = await deps.screenshot(uid, chat); return { text: "Screenshot of the computer.", isError: false, image: img }; }
      case "computer.act": {
        const t = s(args.type, 20);
        if (!/^(click|double_click|right_click|type|key|scroll|wait|open_url|search|launch)$/.test(t)) return fail("type must be click, double_click, right_click, type, key, scroll, wait, open_url, search or launch.");
        const a: Record<string, unknown> = { type: t };
        for (const k of ["text", "keys", "direction", "url", "query", "app"]) if (args[k] !== undefined) a[k] = s(args[k], 4000);
        for (const k of ["x", "y", "amount", "seconds"]) if (args[k] !== undefined && Number.isFinite(Number(args[k]))) a[k] = Number(args[k]);
        return { text: await deps.pcAction(uid, chat, a), isError: false };
      }
      case "computer.shell": { const c = s(args.command, 8000).trim(); if (!c) return fail("command is required."); return { text: await deps.shell(uid, chat, c), isError: false }; }
      case "computer.shell_output": { const j = s(args.job, 60).replace(/[^A-Za-z0-9_-]/g, ""); if (!j) return fail("job is required."); return { text: await deps.shellOutput(uid, chat, j), isError: false }; }
      case "team.roster": return { text: await deps.roster(uid, chat), isError: false };
      case "group.read": {
        const n = Math.min(60, Math.max(1, Math.round(Number(args.limit)) || 20));
        const [members, msgs, st] = await Promise.all([deps.groupMembers(uid, chat), deps.groupMsgs(uid, chat, n), deps.groupState(uid, chat)]);
        const roster = members.map((m) => `${m.id}: ${m.name}${m.title ? ", " + m.title : ""}${st.working[m.id] ? " [working: " + st.working[m.id] + "]" : ""}`).join("\n");
        const notes = members.filter((m) => (st.memory[m.id] ?? []).length).map((m) => `${m.name}: ${st.memory[m.id].join(" | ")}`).join("\n");
        return { text: `MEMBERS\n${roster}\n\n${st.pins.length ? "PINNED FOR THE GROUP\n" + st.pins.map((p) => "- " + p).join("\n") + "\n\n" : ""}${notes ? "MEMBER NOTES\n" + notes + "\n\n" : ""}${st.running.length ? "A TURN IS RUNNING ON THE SERVER (" + st.running.length + "): members are answering there.\n\n" : ""}CHAT (oldest first)\n${transcript(msgs, members, n, 900) || "(no messages yet)"}`, isError: false };
      }
      case "group.post": {
        const members = await deps.groupMembers(uid, chat);
        const from = s(args.member, 40).trim();
        const text = s(args.text, 6000).trim();
        if (!text) return fail("text is required.");
        if (from === "you") {
          await deps.groupPost(uid, chat, { from: "you", text: clip(text, 4000), kind: "say" });
          return { text: "Posted as the owner.", isError: false };
        }
        const m = findMember(from, members);
        if (!m) return fail(`"${from}" is not a member of this group. Members: ${members.map((x) => x.id).join(", ")}.`);
        const p = parseReply(text, members, m.id); // control lines (HANDOFF / NOTE / PIN) are taken out of the visible text
        const note = [s(args.note, 400), ...p.notes].filter((x) => x && !looksSecret(x)).map((x) => oneLine(x, 200)).slice(0, 3);
        const pin = [s(args.pin, 400), ...p.pins].filter((x) => x && !looksSecret(x)).map((x) => oneLine(x, 200)).slice(0, 2);
        if (looksSecret(p.text)) return fail("The message looks like it contains a password or key. Remove it and post again.");
        const to = (Array.isArray(args.to) ? args.to : []).map((x) => findMember(s(x, 30), members)?.id).filter((x): x is string => Boolean(x)).slice(0, 8);
        const kind = args.kind === "result" || args.kind === "ask" ? args.kind : "say";
        await deps.groupPost(uid, chat, { from: m.id, text: p.text || "👍", kind, ...(to.length ? { to } : {}) });
        if (note.length || pin.length) await deps.groupSave(uid, chat, m.id, note, pin);
        return { text: `Posted as ${m.name}.${p.handoffs.length ? " Hand-offs written as HANDOFF lines are not queued from Claude: do that teammate's part yourself and post it as them." : ""}`, isError: false };
      }
      case "group.working": {
        const members = await deps.groupMembers(uid, chat);
        const m = findMember(s(args.member, 40), members);
        if (!m) return fail("Unknown member. Call group__read for the member ids.");
        const t = s(args.text, 140).trim();
        await deps.groupWorking(uid, chat, m.id, t ? t : null);
        return { text: t ? "Status shown." : "Status cleared.", isError: false };
      }
      case "venus.make_video": {
        const plan = planClaudeVideo(args);
        if ("error" in plan) return fail(plan.error);
        const id = await deps.startVideo(uid, chat, plan);
        return { text: `Video started in the background (id ${id}, ${plan.scenes} scenes, about ${plan.seconds}s, ${plan.aspect}). The scenes are rendered exactly as you wrote them. It takes about 10-30 minutes; the owner gets the link in the chat. Check with venus__video_status.` + (plan.notes.length ? "\nNotes:\n" + plan.notes.join("\n") : ""), isError: false };
      }
    }

    if (name.startsWith("code.")) {
      const k = name.slice(5);
      const call: CodeCall = { name: k, attrs: {}, body: "" };
      const at = (key: string, max = 2000) => { if (args[key] !== undefined && args[key] !== null) call.attrs[key] = s(args[key], max); };
      if (k === "read") { if (!s(args.path)) return fail("path is required."); at("path"); at("offset", 12); at("limit", 12); }
      else if (k === "ls") at("path");
      else if (k === "glob") { if (!s(args.pattern)) return fail("pattern is required."); at("pattern"); }
      else if (k === "grep") { if (!s(args.pattern)) return fail("pattern is required."); at("pattern"); at("path"); at("glob"); }
      else if (k === "write") { if (!s(args.path)) return fail("path is required."); at("path"); call.body = s(args.content, 800_000); }
      else if (k === "edit") { if (!s(args.path) || !s(args.old, 200_000)) return fail("path and old are required."); at("path"); call.old = s(args.old, 200_000); call.new = s(args.new, 200_000); if (args.replace_all === true) call.attrs.replace_all = "true"; }
      else if (k === "bash") { const c = s(args.command, 8000).trim(); if (!c) return fail("command is required."); call.body = c; at("timeout", 6); if (args.background === true) call.attrs.background = "true"; }
      else if (k === "bash_output") { if (!s(args.job)) return fail("job is required."); at("job", 60); }
      else if (k === "look") at("path");
      const r = await deps.code(uid, chat, call);
      return { text: r.text, isError: /^ERROR:/.test(r.text), ...(r.image ? { image: r.image } : {}) };
    }
  } catch (e) {
    return fail(e instanceof Error ? e.message.slice(0, 400) : "Tool failed.");
  }
  return null;
}
