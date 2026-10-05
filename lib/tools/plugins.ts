import { webRead, webSearch } from "@/lib/web-tools-server";
import { assertPublicUrl, http } from "./net";
import type { Risk, ToolCtx } from "./types";

type Run = (args: Record<string, unknown>, cred: string[], ctx?: ToolCtx) => Promise<string>;
export type Def = { name: string; description: string; params: string; risk: Risk; run: Run };

const s = (v: unknown) => String(v ?? "").trim();
type Res = { status: number; json: any; text: string };
const must = (r: Res, what: string) => {
  if (r.status >= 400) throw new Error(`${what}: HTTP ${r.status} ${s(r.json?.message ?? r.json?.description ?? r.text).slice(0, 160)}`);
  return r;
};
const strip = (x: string) => x.replace(/<!\[CDATA\[|\]\]>/g, "").replace(/<[^>]*>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

// ---------------- free pack (no key) ----------------
export const FREE_TOOLS: Def[] = [
  {
    name: "web.search", description: "Search the web (titles, links, snippets).", params: "query:string", risk: "read",
    run: async (a) => webSearch(s(a.query)),
  },
  {
    name: "web.read", description: "Read a public web page as plain text.", params: "url:string", risk: "read",
    run: async (a) => webRead(s(a.url), 4500),
  },
  {
    name: "weather.now", description: "Current weather + 3-day outlook for a city.", params: "city:string", risk: "read",
    run: async (a) => {
      const g = await http(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(s(a.city))}&count=1`);
      const p = g.json?.results?.[0];
      if (!p) throw new Error(`City not found: ${s(a.city)}`);
      const w = await http(`https://api.open-meteo.com/v1/forecast?latitude=${p.latitude}&longitude=${p.longitude}&current=temperature_2m,relative_humidity_2m,wind_speed_10m&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&forecast_days=3`);
      const c = w.json?.current, d = w.json?.daily;
      if (!c || !d) throw new Error("Weather service gave no data.");
      const days = (d.time as string[]).map((t, i) => `${t}: ${d.temperature_2m_max[i]}/${d.temperature_2m_min[i]}°C, rain ${d.precipitation_probability_max[i]}%`).join("; ");
      return `${p.name}, ${p.country}: ${c.temperature_2m}°C, humidity ${c.relative_humidity_2m}%, wind ${c.wind_speed_10m} km/h.\nNext days (max/min, rain): ${days}`;
    },
  },
  {
    name: "wiki.summary", description: "Short Wikipedia summary of a topic.", params: "title:string", risk: "read",
    run: async (a) => {
      const r = await http(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(s(a.title).replace(/ /g, "_"))}`);
      if (r.status === 404) throw new Error("No Wikipedia page with that title.");
      must(r, "Wikipedia");
      return `${r.json?.title}: ${r.json?.extract}\n${r.json?.content_urls?.desktop?.page ?? ""}`;
    },
  },
  {
    name: "currency.convert", description: "Convert an amount between currencies (ECB rates).", params: "amount:number, from:string, to:string", risk: "read",
    run: async (a) => {
      const amount = Number(a.amount) || 1, from = s(a.from).toUpperCase(), to = s(a.to).toUpperCase();
      const r = must(await http(`https://api.frankfurter.app/latest?amount=${amount}&from=${from}&to=${to}`), "Currency");
      const v = r.json?.rates?.[to];
      if (v === undefined) throw new Error("Unknown currency code.");
      return `${amount} ${from} = ${v} ${to} (rates of ${r.json?.date})`;
    },
  },
  {
    name: "rss.read", description: "Latest items of an RSS/Atom feed.", params: "url:string", risk: "read",
    run: async (a) => {
      const u = assertPublicUrl(s(a.url));
      const r = must(await http(u.toString(), { headers: { "User-Agent": "agenticvenus" } }), "Feed");
      const items = Array.from(r.text.matchAll(/<(item|entry)[\s>][\s\S]*?<\/\1>/g)).slice(0, 10).map((m, i) => {
        const t = /<title[^>]*>([\s\S]*?)<\/title>/.exec(m[0]);
        const l = /<link[^>]*href="([^"]+)"/.exec(m[0]) ?? /<link[^>]*>([^<]+)<\/link>/.exec(m[0]);
        return `${i + 1}. ${t ? strip(t[1]) : "(no title)"}\n   ${l ? l[1].trim() : ""}`;
      });
      if (!items.length) throw new Error("No items found in that feed.");
      return items.join("\n");
    },
  },
];

// ---------------- keyed plugins ----------------
const REPO = /^[\w.-]+\/[\w.-]+$/;
const gh = (t: string) => ({ Authorization: `Bearer ${t}`, "User-Agent": "agenticvenus", Accept: "application/vnd.github+json" });
const repoOf = (v: unknown) => { const r = s(v); if (!REPO.test(r)) throw new Error('repo must look like "owner/name".'); return r; };

const nHeaders = (t: string) => ({ Authorization: `Bearer ${t}`, "Notion-Version": "2022-06-28", "Content-Type": "application/json" });
const titleOf = (r: any): string => {
  if (Array.isArray(r.title)) return r.title.map((x: any) => x.plain_text).join("");
  const p = Object.values(r.properties ?? {}).find((x: any) => x?.type === "title") as any;
  return (p?.title ?? []).map((x: any) => x.plain_text).join("") || "(untitled)";
};

export const PLUGIN_TOOLS: Record<string, Def[]> = {
  github: [
    {
      name: "github.search_issues", description: "Search issues/PRs (GitHub search syntax, e.g. 'repo:o/r is:open bug').", params: "q:string", risk: "read",
      run: async (a, [t]) => {
        const r = must(await http(`https://api.github.com/search/issues?q=${encodeURIComponent(s(a.q))}&per_page=8`, { headers: gh(t) }), "GitHub");
        const it = (r.json?.items ?? []) as any[];
        return it.length ? it.map((i) => `#${i.number} ${i.title} (${i.state}) ${i.html_url}`).join("\n") : "No results.";
      },
    },
    {
      name: "github.list_repos", description: "Your most recently updated repos.", params: "", risk: "read",
      run: async (_a, [t]) => {
        const r = must(await http("https://api.github.com/user/repos?per_page=15&sort=updated", { headers: gh(t) }), "GitHub");
        return ((r.json ?? []) as any[]).map((x) => `${x.full_name} — ${x.description ?? ""}`).join("\n") || "No repos.";
      },
    },
    {
      name: "github.get_file", description: "Read a file (or list a folder) from a repo.", params: "repo:owner/name, path:string", risk: "read",
      run: async (a, [t]) => {
        const path = s(a.path).replace(/^\/+/, "");
        if (path.includes("..")) throw new Error("Bad path.");
        const r = must(await http(`https://api.github.com/repos/${repoOf(a.repo)}/contents/${path}`, { headers: gh(t) }), "GitHub");
        if (Array.isArray(r.json)) return r.json.map((f: any) => `${f.type === "dir" ? "📁" : "📄"} ${f.path}`).join("\n");
        return Buffer.from(String(r.json?.content ?? ""), "base64").toString("utf8");
      },
    },
    {
      name: "github.create_issue", description: "Open a new issue.", params: "repo:owner/name, title:string, body?:string", risk: "write",
      run: async (a, [t]) => {
        const r = must(await http(`https://api.github.com/repos/${repoOf(a.repo)}/issues`, {
          method: "POST", headers: { ...gh(t), "Content-Type": "application/json" },
          body: JSON.stringify({ title: s(a.title), body: s(a.body) }),
        }), "GitHub");
        return `Created issue #${r.json?.number}: ${r.json?.html_url}`;
      },
    },
  ],
  notion: [
    {
      name: "notion.search", description: "Search pages/databases the integration can see.", params: "query:string", risk: "read",
      run: async (a, [t]) => {
        const r = must(await http("https://api.notion.com/v1/search", { method: "POST", headers: nHeaders(t), body: JSON.stringify({ query: s(a.query), page_size: 8 }) }), "Notion");
        const res = (r.json?.results ?? []) as any[];
        return res.length ? res.map((x) => `${x.object}: ${titleOf(x)} · id=${x.id} · ${x.url}`).join("\n") : "No results (did you share the page with the integration?).";
      },
    },
    {
      name: "notion.create_page", description: "Create a page under an existing page.", params: "parent_page_id:string, title:string, content?:string", risk: "write",
      run: async (a, [t]) => {
        const children = s(a.content).split("\n").filter(Boolean).slice(0, 40).map((line) => ({
          object: "block", type: "paragraph", paragraph: { rich_text: [{ type: "text", text: { content: line.slice(0, 1900) } }] },
        }));
        const r = must(await http("https://api.notion.com/v1/pages", {
          method: "POST", headers: nHeaders(t),
          body: JSON.stringify({ parent: { page_id: s(a.parent_page_id) }, properties: { title: { title: [{ type: "text", text: { content: s(a.title).slice(0, 200) } }] } }, children }),
        }), "Notion");
        return `Created page: ${r.json?.url}`;
      },
    },
  ],
  telegram: [
    {
      name: "telegram.send", description: "Send a Telegram message to the user.", params: "text:string", risk: "write",
      run: async (a, [token, chat]) => {
        if (!token || !chat) throw new Error("Telegram needs a bot token and a chat id.");
        const r = must(await http(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: chat, text: s(a.text).slice(0, 3900) }),
        }), "Telegram");
        return r.json?.ok ? "Message sent." : "Telegram refused the message.";
      },
    },
  ],
  webhook: [
    {
      name: "webhook.send", description: "Post a message to the connected Slack/Discord channel.", params: "text:string", risk: "write",
      run: async (a, [url]) => {
        const u = assertPublicUrl(url);
        const discord = u.hostname.endsWith("discord.com") || u.hostname.endsWith("discordapp.com");
        if (!discord && u.hostname !== "hooks.slack.com") throw new Error("Only Slack or Discord webhooks are allowed.");
        const body = discord ? { content: s(a.text).slice(0, 1900) } : { text: s(a.text).slice(0, 3000) };
        must(await http(u.toString(), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }), "Webhook");
        return "Message posted.";
      },
    },
  ],
};
