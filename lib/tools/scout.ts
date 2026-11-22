// Venus Scout as agent tools: fast web research and leads from a hidden E2B browser, no Cloud PC needed (lib/scout.ts).
import type { Def } from "./plugins";

const need = <T,>(ctx: T | undefined): T => { if (!ctx) throw new Error("The research browser needs a signed-in chat."); return ctx; };

export const SCOUT_TOOLS: Def[] = [
  {
    name: "scout.read", risk: "read", params: "urls:string (one public web address, or up to 8 separated by spaces, commas or new lines)",
    description: "FAST web research WITHOUT turning on the Cloud PC. Opens up to 8 public pages at the same time in a hidden browser and returns for each: title, readable text, the e-mail addresses and phone numbers on the page, and its links. " +
      "Use it for leads (company sites, contact and about pages, directories), prices, competitors and news. Prefer it over the Cloud PC for anything public that needs no sign-in. " +
      "To find pages first use web.search, then read the best results here; open /contact or /about pages of a company to find its e-mail.",
    run: async (a, _c, ctx) => { const { scoutRead } = await import("@/lib/scout"); return scoutRead(need(ctx).uid, a.urls); },
  },
  {
    name: "scout.browse", risk: "write", params: "url?:string (opens this page; leave empty to go on with the page that is already open), session?:string (name of the tab, default main), ops?:string (steps as a JSON list, for example [{\"op\":\"click_label\",\"label\":\"Accept\"},{\"op\":\"type_label\",\"label\":\"Search\",\"text\":\"dentists pune\"},{\"op\":\"press\",\"key\":\"Enter\"},{\"op\":\"scroll\"},{\"op\":\"back\"}])",
    description: "ONE page you can use like a person, in the same hidden fast browser (no Cloud PC): it returns the page text and a NUMBERED list of buttons, links and inputs; act on them with ops (click, click_label, type, type_label, press, scroll, wait, back). " +
      "The page stays open between calls (same session). No sign-ins and no passwords here: for signed-in sites use the Cloud PC. Because it can click and submit forms, it needs approval.",
    run: async (a, _c, ctx) => { const { scoutBrowse } = await import("@/lib/scout"); return scoutBrowse(need(ctx).uid, { url: a.url, session: a.session, ops: a.ops }); },
  },
  {
    name: "scout.close", risk: "read", params: "session?:string (default main)",
    description: "Close a tab opened with scout.browse when the work is done.",
    run: async (a, _c, ctx) => { const { scoutClose } = await import("@/lib/scout"); return scoutClose(need(ctx).uid, a.session); },
  },
];
