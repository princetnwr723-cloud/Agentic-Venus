// Venus Pro as agent tools: the server agent (and every routine) can make a video that keeps rendering with every tab closed.
// The video runs through the same background runner as the dashboard's "make a video" (lib/venus-run-server.ts).
import type { Def } from "./plugins";
import { SCOUT_TOOLS } from "./scout";

const s = (v: unknown, n = 4000) => String(v ?? "").trim().slice(0, n);
const need = <T,>(ctx: T | undefined): T => { if (!ctx) throw new Error("Videos can only be made from a chat."); return ctx; };

const VIDEO_TOOLS: Def[] = [
  {
    name: "venus.make_video", risk: "write",
    params: 'brief:string (what the video is about, the story, the tone), seconds?:number (length, default 45), aspect?:string ("16:9" | "9:16" | "1:1", default "16:9"), voice?:boolean (narration, default true), captions?:boolean (default true), quality?:string ("720p" | "1080p")',
    description: "Make a finished video with Venus Pro (script, motion-graphics scenes, voice-over, captions, render). It runs IN THE BACKGROUND on the server and takes 10-30 minutes: the owner can close the browser. When it is ready the owner gets a message in this chat with the video link. Start it ONCE, tell the owner it is running, and do not wait for it. Use venus.video_status only when asked how it is going.",
    run: async (a, _c, ctx) => {
      const c = need(ctx);
      if (!c.model) throw new Error("No model is selected for this chat.");
      const brief = s(a.brief, 12_000);
      if (!brief) throw new Error("brief is required.");
      const { startVenusRun } = await import("@/lib/venus-run-server");
      const now = Date.now();
      const aspect = ["16:9", "9:16", "1:1"].includes(s(a.aspect, 8)) ? (s(a.aspect, 8) as "16:9" | "9:16" | "1:1") : "16:9";
      const seconds = Math.min(600, Math.max(10, Number(a.seconds) || 45));
      const id = await startVenusRun(c.uid, {
        id: "v" + now.toString(36) + Math.random().toString(36).slice(2, 5), title: brief.replace(/\s+/g, " ").slice(0, 48), brief, seconds, aspect, theme: "midnight",
        voice: a.voice !== false, voiceName: "nova", captions: a.captions !== false, quality: s(a.quality, 6) === "1080p" ? "1080p" : "720p", review: true, design: "ai", music: true,
        origin: "chat", chatId: c.chatId, provider: c.model.provider as never, model: c.model.model, stage: "studio", status: "idle", createdAt: now, updatedAt: now, mode: "make",
      } as never, { origin: c.origin ?? c.baseUrl ?? "", source: "agent" });
      return `Video started in the background (id ${id}). It takes about 10-30 minutes. The owner gets a message here with the link when it is ready, even if every tab is closed. Do not wait for it; tell the owner it is running.`;
    },
  },
  {
    name: "venus.video_status", risk: "read", params: "id?:string (the video id; default: the latest video of this chat)",
    description: "How far a background video is (step, percent, finished or failed).",
    run: async (a, _c, ctx) => {
      const c = need(ctx);
      const { venusStore } = await import("@/lib/venus-run-server");
      const runs = (await venusStore().listRuns(c.uid, 20)).filter((r) => r.chatId === c.chatId && (!a.id || r.id === s(a.id, 40)));
      const r = runs[0];
      if (!r) return "No video has been started in this chat yet.";
      const pct = r.value != null ? ` ${Math.round(r.value * 100)}%` : "";
      return r.status === "done" ? `The video "${r.title}" is finished. The owner already has the link in the chat.`
        : r.status === "error" ? `The video "${r.title}" failed: ${r.error ?? "unknown error"}.`
        : r.status === "stopped" ? `The video "${r.title}" was stopped.`
        : `The video "${r.title}" is being made: step "${r.stage}"${pct}. ${r.label ?? ""}`.trim();
    },
  },
  {
    name: "venus.stop_video", risk: "write", params: "id?:string",
    description: "Stop a background video that is still being made.",
    run: async (a, _c, ctx) => {
      const c = need(ctx);
      const { venusStore, stopVenusRun } = await import("@/lib/venus-run-server");
      const r = (await venusStore().listRuns(c.uid, 20)).find((x) => x.chatId === c.chatId && (x.status === "queued" || x.status === "running") && (!a.id || x.id === s(a.id, 40)));
      if (!r) return "No video is running in this chat.";
      await stopVenusRun(c.uid, r.id);
      return `Stopping "${r.title}".`;
    },
  },
];

/** Venus Pro video tools, and the fast research browser (it lives here so the tool list needs no other change). */
export const VENUS_TOOLS: Def[] = [...VIDEO_TOOLS, ...SCOUT_TOOLS];
