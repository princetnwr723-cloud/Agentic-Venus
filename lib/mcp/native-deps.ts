// Server only. The real actions behind lib/mcp/native.ts: the chat's cloud computer (E2B), Venus Code, the headless browser, the team
// and Venus Pro. Everything is looked up per chat of the signed-in account (users/{uid}/chats/{chat}); no other account is reachable.
import { getAdminDb } from "@/lib/firebase-admin";
import { resolveValue } from "@/lib/vault";
import { connect, performAction, shellCheck, shellStart, takeScreenshot, type PcAction } from "@/lib/e2b-server";
import { ASSETS, ROOT, checkpoint, codeState, ensureWorkspace, runTool, startCodeSetup } from "@/lib/code-server";
import { runBrowser, type BrowserOp } from "@/lib/browser-server";
import { consumeFeature } from "@/lib/billing-server";
import { byId, TOOL_LABEL } from "@/lib/team-catalog";
import { sceneCodePrompt } from "@/lib/venus-prompts";
import { readGroupState, saveNotes, savePins, setWorking } from "@/lib/group-memory";
import type { GMsg } from "@/lib/group-core";
import type { ChatDetail, ChatInfo, NativeDeps } from "./native.ts";

void ASSETS; void ROOT;
type Raw = { agentName?: string; provider?: string; model?: string; messages?: { role?: string; content?: string; at?: number }[]; pcSandboxId?: string | null; pcPaused?: boolean;
  codeWs?: string | null; repo?: { owner?: string; name?: string } | null; connectors?: Record<string, unknown> };

const userRef = (uid: string) => getAdminDb().collection("users").doc(uid);
const chatRef = (uid: string, chat: string) => userRef(uid).collection("chats").doc(chat);

function info(id: string, c: Raw, team: string[]): ChatInfo {
  const msgs = Array.isArray(c.messages) ? c.messages : [];
  const last = msgs[msgs.length - 1];
  return {
    id, name: String(c.agentName || "Chat"), provider: String(c.provider || "?"), model: String(c.model || "?"), messages: msgs.length,
    lastAt: Number(last?.at ?? 0), lastText: String(last?.content ?? "").slice(0, 120),
    pc: c.pcSandboxId ? (c.pcPaused ? "paused" : "on") : "none", code: Boolean(c.codeWs || c.repo),
    repo: c.repo?.owner && c.repo?.name ? `${c.repo.owner}/${c.repo.name}` : "",
    connected: Object.keys(c.connectors ?? {}).map((k) => k.replace(/^(oauth|mcp|api):/, "")).slice(0, 12), team,
  };
}

async function teamsOf(uid: string): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  const snap = await userRef(uid).collection("teams").get().catch(() => null);
  for (const d of snap?.docs ?? []) {
    const m = (d.data() as { members?: unknown }).members;
    out.set(d.id, Array.isArray(m) ? m.filter((x): x is string => typeof x === "string") : []);
  }
  return out;
}

async function load(uid: string, chat: string): Promise<Raw> {
  const d = await chatRef(uid, chat).get();
  if (!d.exists) throw new Error("No such chat in this account. Call venus__chats again.");
  return d.data() as Raw;
}

async function box(uid: string, chat: string) {
  const c = await load(uid, chat);
  if (!c.pcSandboxId) throw new Error("This chat has no computer yet. Ask the person to turn it on in AgenticVenus (Computer button), then try again.");
  const raw = ((await userRef(uid).get()).data() as { e2bKey?: string } | undefined)?.e2bKey;
  if (!raw) throw new Error("E2B key is not saved (Settings in AgenticVenus).");
  const key = await resolveValue(uid, raw);
  return { key, id: c.pcSandboxId, c };
}

const fmtShell = (r: { jobId: string; done: boolean; exitCode?: number; output: string }) =>
  r.done ? `exit code ${r.exitCode ?? "?"}\n${r.output}` : `STILL RUNNING (job ${r.jobId}). Read more with computer__shell_output.\n${r.output}`;

export function makeNativeDeps(site: { origin?: string; baseUrl?: string }): NativeDeps {
  return {
    async listChats(uid) {
      const [snap, teams] = await Promise.all([userRef(uid).collection("chats").limit(200).get(), teamsOf(uid)]);
      return snap.docs.filter((d) => d.id !== "mcp").map((d) => info(d.id, d.data() as Raw, teams.get(d.id) ?? ["chief"]))
        .sort((a, b) => b.lastAt - a.lastAt).slice(0, 100);
    },
    async chatDetail(uid, chat) {
      const d = await chatRef(uid, chat).get();
      if (!d.exists || chat === "mcp") return null;
      const c = d.data() as Raw;
      const team = (await teamsOf(uid)).get(chat) ?? ["chief"];
      const recent = (c.messages ?? []).slice(-6).map((m) => ({ role: String(m.role ?? ""), content: String(m.content ?? "") }));
      return { ...info(chat, c, team), recent } as ChatDetail;
    },
    async screenshot(uid, chat) {
      const b = await box(uid, chat);
      const s = await takeScreenshot(b.key, b.id);
      return { mediaType: s.mediaType, data: s.data };
    },
    async pcAction(uid, chat, action) {
      const b = await box(uid, chat);
      return performAction(b.key, b.id, action as unknown as PcAction);
    },
    async shell(uid, chat, command) {
      const b = await box(uid, chat);
      return fmtShell(await shellStart(b.key, b.id, command));
    },
    async shellOutput(uid, chat, job) {
      const b = await box(uid, chat);
      return fmtShell(await shellCheck(b.key, b.id, job));
    },
    async code(uid, chat, call) {
      const b = await box(uid, chat);
      const ws = String(b.c.codeWs || chat);
      const sb = await connect(b.key, b.id);
      const write = call.name === "write" || call.name === "edit" || call.name === "bash";
      if (call.name === "write" || call.name === "edit") await consumeFeature(uid, "site", ws); // the plan's website limit applies here too
      if (write || call.name === "look") await ensureWorkspace(sb, ws);
      if (call.name === "bash") {
        const st = await codeState(sb);
        if (st.state === "none") { await startCodeSetup(sb); return { text: "Venus Code tools are being installed on the computer (1-3 minutes). Try this command again in a minute." }; }
        if (st.state === "installing") return { text: "Venus Code tools are still installing. Try again in a minute." };
      }
      const r = await runTool(sb, ws, call, 40_000);
      if (r.mutated && call.name !== "bash_output") await checkpoint(sb, ws, `Claude: ${call.name}${call.attrs.path ? " " + call.attrs.path : ""}`).catch(() => null);
      return { text: r.text, ...(r.image ? { image: r.image } : {}) };
    },
    async browser(uid, url, ops) {
      // the fast hidden browser first (no Cloud PC, no cold start once it is set up); the built-in server browser when it is not available
      try {
        const { scoutBrowse, scoutClose } = await import("@/lib/scout");
        const out = await scoutBrowse(uid, { url, session: "mcp", ops });
        await scoutClose(uid, "mcp");
        return out;
      } catch { /* fall back */ }
      const r = await runBrowser({ url, ops: ops as unknown as BrowserOp[] });
      return r.snapshot;
    },
    sceneGuide(aspect, seconds) {
      const g = sceneCodePrompt({ scene: { type: "custom", seconds, headline: "(text for the scene)", brief: "(describe the picture and the motion you want)" }, aspect, frames: Math.round(seconds * 30), concept: "" });
      return "HOW TO USE: send the scene to venus__make_video as {type:\"custom\", seconds, brief, headline, ...any fields your code reads from p, code:\"<the TSX below you write>\"}. Only the TSX goes in `code`. Ignore the line about replying with a ```tsx block: put the code in the `code` field.\n\n" + g;
    },
    async roster(uid, chat) {
      await load(uid, chat);
      const ids = (await teamsOf(uid)).get(chat) ?? ["chief"];
      const rows = ids.map((id) => byId(id)).filter((m): m is NonNullable<ReturnType<typeof byId>> => Boolean(m))
        .map((m) => `${m.id}: ${m.name}, ${m.title}. ${m.skill} (works with: ${TOOL_LABEL[m.tool]})`);
      return `Team of this chat (${rows.length}). Work as the right member for each step:\n${rows.join("\n") || "chief: Chief, team lead."}`;
    },
    async groupMembers(uid, chat) {
      await load(uid, chat);
      const { loadMembers } = await import("@/lib/group-server");
      return loadMembers(uid, chat);
    },
    async groupMsgs(uid, chat, n) {
      await load(uid, chat);
      const snap = await userRef(uid).collection("teams").doc(chat).collection("groupMsgs").orderBy("at", "desc").limit(n).get().catch(() => null);
      return snap ? snap.docs.map((d) => d.data() as GMsg).reverse() : [];
    },
    async groupState(uid, chat) { return readGroupState(uid, chat); },
    async groupPost(uid, chat, m) {
      const { postGroupMsg } = await import("@/lib/group-server");
      await postGroupMsg(uid, chat, m);
    },
    async groupSave(uid, chat, member, notes, pins) { await saveNotes(uid, chat, member, notes); await savePins(uid, chat, pins); },
    async groupWorking(uid, chat, member, text) { await setWorking(uid, chat, member, text); },
    async startVideo(uid, chat, plan) {
      const c = await load(uid, chat);
      const { startVenusRun } = await import("@/lib/venus-run-server");
      const now = Date.now();
      return startVenusRun(uid, {
        id: "v" + now.toString(36) + Math.random().toString(36).slice(2, 5), title: plan.title, brief: plan.title, seconds: plan.seconds, aspect: plan.aspect, theme: plan.theme,
        voice: plan.voice, voiceName: "nova", captions: plan.captions, quality: plan.quality, review: false, design: "ai", music: true, origin: "chat", chatId: chat,
        provider: (c.provider || "anthropic") as never, model: String(c.model || "claude"), stage: "design", status: "idle", createdAt: now, updatedAt: now, mode: "make",
        storyboardJson: plan.storyboardJson,
      } as never, { origin: site.origin ?? site.baseUrl ?? "", source: "agent", claudeDriven: true });
    },
  };
}
