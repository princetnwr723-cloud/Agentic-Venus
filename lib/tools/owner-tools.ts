// Server-only. Tools the agent uses for: Decks (presentations), the owner's About details + Night/Light mode, and this chat's Dashboard.
// They are "free" tools (always available in every chat). They only touch the owner's own data inside AgenticVenus.
import type { Def } from "./plugins";
import type { ToolCtx } from "./types";
import { cleanDeck, DECK_THEMES, themeOf } from "@/lib/decks";
import { DECK_GUIDE, deleteDeck, getDeck, listDecks, saveDeck } from "@/lib/decks-server";
import { getProfile, saveProfile, PROFILE_TEXT } from "@/lib/profile-server";
import { collectStats, enableDashboard, logDashboard } from "@/lib/dashboard-server";

const need = (ctx: ToolCtx | undefined): ToolCtx => { if (!ctx) throw new Error("This tool only works from a chat."); return ctx; };
const s = (v: unknown, n = 300) => String(v ?? "").trim().slice(0, n);
const asJson = (v: unknown): unknown => { if (typeof v !== "string") return v; try { return JSON.parse(v); } catch { return v; } };

const SLIDE_PARAMS = "slides:array of {layout:title|section|bullets|two-column|comparison|stats|timeline|quote|closing, kicker?, title?, subtitle?, body?, bullets?:string[], left?:{title,bullets}, right?:{title,bullets}, stats?:[{value,label}], steps?:[{title,text}], quote?, by?, notes?}";

export const OWNER_TOOLS: Def[] = [
  // ---------------- Decks ----------------
  {
    name: "deck.create", risk: "read", params: `title:string, theme?:${DECK_THEMES.map((t) => t.id).join("|")}, subtitle?:string, ${SLIDE_PARAMS}`,
    description: `Make a presentation (deck) for the owner. YOU write every slide yourself (research first with the web tools if the topic needs facts), then call this once with all slides. It is saved in the owner's Decks (the presentation icon button in the left sidebar), where the owner can preview, present, edit it and download PowerPoint / HTML / PDF. Never build a presentation as a website in Venus Code. ${DECK_GUIDE} After it succeeds, tell the owner to open the Decks button in the left sidebar.`,
    run: async (a, _c, ctx) => {
      const c = need(ctx);
      const clean = cleanDeck({ ...a, slides: asJson(a.slides) });
      const d = await saveDeck(c.uid, { ...clean, chatId: c.chatId, by: "agent" });
      return `Deck created: "${d.title}" (${d.slides.length} slides, theme ${themeOf(d.theme).name}), id ${d.id}.\nTell the owner: tap the Decks icon (presentation screen) in the left sidebar to preview, present, edit and download it (PowerPoint / HTML / PDF).`;
    },
  },
  {
    name: "deck.list", risk: "read", params: "all?:boolean (true = decks of every chat, default only this chat)",
    description: "List the owner's decks (id, title, number of slides).",
    run: async (a, _c, ctx) => {
      const c = need(ctx);
      const l = await listDecks(c.uid, a.all === true ? undefined : c.chatId);
      return l.length ? l.slice(0, 40).map((d) => `${d.id} · ${d.title} · ${d.slideCount} slides · ${new Date(d.updatedAt).toISOString().slice(0, 10)}`).join("\n") : "No decks yet.";
    },
  },
  {
    name: "deck.get", risk: "read", params: "id:string",
    description: "Read one deck (all slides as JSON) so you can change it with deck.update.",
    run: async (a) => { throw new Error("unused " + s(a.id)); },
  },
  {
    name: "deck.update", risk: "read", params: `id:string, title?:string, theme?:string, subtitle?:string, ${SLIDE_PARAMS} (the COMPLETE new list of slides; it replaces the old one)`,
    description: "Change a deck: read it with deck.get, then send the full updated slides list.",
    run: async (a, _c, ctx) => {
      const c = need(ctx);
      const cur = await getDeck(c.uid, s(a.id, 80));
      if (!cur) throw new Error("Deck not found. Use deck.list for the ids.");
      const d = await saveDeck(c.uid, { id: cur.id, title: a.title ?? cur.title, subtitle: a.subtitle ?? cur.subtitle, theme: a.theme ?? cur.theme, slides: a.slides !== undefined ? asJson(a.slides) : cur.slides });
      return `Deck updated: "${d.title}" (${d.slides.length} slides). It is in the Decks button (left sidebar).`;
    },
  },
  {
    name: "deck.delete", risk: "write", params: "id:string",
    description: "Delete a deck (asks the owner first).",
    run: async (a, _c, ctx) => { const c = need(ctx); await deleteDeck(c.uid, s(a.id, 80)); return "Deck deleted."; },
  },

  // ---------------- About the owner + Night / Light mode ----------------
  {
    name: "profile.get", risk: "read", params: "",
    description: "Read the owner's About details (name, mobile number, company, role, location, website, bio) and their theme (dark = Night mode, light = Light mode).",
    run: async (_a, _c, ctx) => {
      const p = await getProfile(need(ctx).uid);
      return PROFILE_TEXT.map((f) => `${f}: ${p[f] || "—"}`).join("\n") + `\ntheme: ${p.theme === "light" ? "light (Light mode)" : "dark (Night mode)"}`;
    },
  },
  {
    name: "profile.set", risk: "write", params: "name?:string, phone?:string, company?:string, role?:string, location?:string, website?:string, bio?:string, theme?:'dark'|'light' (dark = Night mode, light = Light mode). Only the fields the owner asked to change; '' clears a field.",
    description: "Change the owner's About details or switch Night / Light mode, when the owner asks (\"my number is …\", \"change my name\", \"night mode on\"). The owner approves it first. The screen updates by itself within seconds.",
    run: async (a, _c, ctx) => {
      const c = need(ctx);
      const patch: Record<string, unknown> = {};
      for (const k of [...PROFILE_TEXT, "theme"] as const) if (a[k] !== undefined) patch[k] = a[k];
      const p = await saveProfile(c.uid, patch);
      return `Saved. Now: name ${p.name || "—"}, phone ${p.phone || "—"}, company ${p.company || "—"}, role ${p.role || "—"}, location ${p.location || "—"}, website ${p.website || "—"}, theme ${p.theme ?? "dark"}.`;
    },
  },

  // ---------------- This chat's Dashboard ----------------
  {
    name: "dashboard.create", risk: "read", params: "",
    description: "Create this chat's dashboard (one per chat) if the owner asks for it and typing [dashboard did not already do it. It shows in Profile → under Agent cooperation.",
    run: async (_a, _c, ctx) => {
      const r = await enableDashboard(need(ctx).uid, need(ctx).chatId);
      return r.created ? "Dashboard created. Tell the owner: tap the agent's name → Profile → Open full dashboard (below Agent cooperation)." : "This chat already has its dashboard (one per chat).";
    },
  },
  {
    name: "dashboard.stats", risk: "read", params: "",
    description: "Your own numbers from this chat's dashboard: tasks done, calls made, code lines/files, clients booked, emails, decks. Use it to answer \"what did you do / how many calls\".",
    run: async (_a, _c, ctx) => {
      const c = need(ctx);
      const st = await collectStats(c.uid, c.chatId);
      if (!st.enabled || !st.kpis || !st.extra) return "This chat has no dashboard yet (the owner types [dashboard to create it, or call dashboard.create).";
      const { kpis: k, extra: x } = st;
      return `Tasks done ${k.tasks.value} · Calls ${k.calls.value} (answered ${x.answeredCalls}, ${x.callMinutes} min) · Code ${k.code.value} lines added, ${x.files} files, ${x.projects} projects · Clients booked ${k.bookings.value} · Emails sent ${x.emails} · Decks ${x.decks} · Videos ${x.videos}.`;
    },
  },
  {
    name: "dashboard.log", risk: "read", params: "kind:'booking'|'client'|'note', who?:string (client name), note?:string",
    description: "Write down a result for the dashboard: ALWAYS call it with kind 'booking' right after you really booked a client / appointment / meeting (and only then), 'client' for a new client won, 'note' for another result worth showing. Never log something that did not happen.",
    run: async (a, _c, ctx) => {
      const c = need(ctx);
      const kind = ["booking", "client", "note"].includes(s(a.kind, 10)) ? (s(a.kind, 10) as "booking" | "client" | "note") : "note";
      if (kind !== "note" && !s(a.who) && !s(a.note)) throw new Error("Give who (the client's name) or a note.");
      await enableDashboard(c.uid, c.chatId).catch(() => undefined);
      await logDashboard(c.uid, c.chatId, { kind, who: s(a.who, 120), note: s(a.note, 300) });
      return "Logged on the dashboard.";
    },
  },
];
OWNER_TOOLS.find((t) => t.name === "deck.get")!.run = async (a, _c, ctx) => {
  const d = await getDeck(need(ctx).uid, s(a.id, 80));
  if (!d) throw new Error("Deck not found. Use deck.list for the ids.");
  return JSON.stringify({ id: d.id, title: d.title, subtitle: d.subtitle, theme: d.theme, slides: d.slides });
};