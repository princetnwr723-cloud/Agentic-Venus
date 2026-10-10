import { NextResponse } from "next/server";
import { readBody, requestStatus } from "@/lib/request";
import { assertPublicUrl, http } from "@/lib/tools/net";
import { mcpList } from "@/lib/tools/mcp-client";
import { unpack } from "@/lib/tools/catalog";

export const runtime = "nodejs";
export const maxDuration = 30;

const bad = (error: string, status = 400) => NextResponse.json({ ok: false, error }, { status });
const ok = (label?: string) => NextResponse.json({ ok: true, label });

export async function POST(req: Request) {
  try {
    const { kind, token } = await readBody(req);
    const t = String(token || "").trim();
    const k = String(kind || "");
    if (!t) return bad("Token is empty.");

    if (k === "github") {
      const r = await http("https://api.github.com/user", { headers: { Authorization: `Bearer ${t}`, "User-Agent": "agenticvenus", Accept: "application/vnd.github+json" } });
      return r.status < 400 ? ok(r.json?.login) : bad(r.json?.message || "GitHub rejected this token.");
    }
    if (k === "vercel") {
      const r = await http("https://api.vercel.com/v2/user", { headers: { Authorization: `Bearer ${t}` } });
      return r.status < 400 ? ok(r.json?.user?.username || r.json?.user?.email) : bad(r.json?.error?.message || "Vercel rejected this token.");
    }
    if (k === "notion") {
      const r = await http("https://api.notion.com/v1/users/me", { headers: { Authorization: `Bearer ${t}`, "Notion-Version": "2022-06-28" } });
      return r.status < 400 ? ok(r.json?.name || "Notion integration") : bad(r.json?.message || "Notion rejected this token.");
    }
    if (k === "telegram") {
      const [bot, chat] = unpack(t);
      if (!bot || !chat) return bad("Enter both the bot token and your chat id.");
      const r = await http(`https://api.telegram.org/bot${bot}/getMe`);
      return r.json?.ok ? ok("@" + r.json.result?.username) : bad(r.json?.description || "Telegram rejected this bot token.");
    }
    if (k === "webhook") {
      const u = assertPublicUrl(unpack(t)[0]);
      const good = u.hostname === "hooks.slack.com" || u.hostname.endsWith("discord.com") || u.hostname.endsWith("discordapp.com");
      return good ? ok("webhook URL looks right (nothing was sent)") : bad("Use a Slack or Discord webhook URL.");
    }
    if (k === "identity") return ok("temporary inbox is created on first use");
    if (k.startsWith("mcp:")) {
      let cfg: { url?: string; auth?: string } = {};
      try { cfg = JSON.parse(t); } catch { return bad("Bad MCP settings."); }
      if (!cfg.url) return bad("MCP URL is missing.");
      const tools = await mcpList(cfg.url, cfg.auth);
      return ok(`${tools.length} tool${tools.length === 1 ? "" : "s"} found`);
    }
    if (k.startsWith("api:")) {
      let cfg: { baseUrl?: string; header?: string; value?: string } = {};
      try { cfg = JSON.parse(t); } catch { return bad("Bad API settings."); }
      const u = assertPublicUrl(cfg.baseUrl ?? "");
      const r = await http(u.toString(), { headers: cfg.header && cfg.value ? { [cfg.header]: cfg.value } : {} });
      return r.status < 500 ? ok(`reachable (HTTP ${r.status})`) : bad(`The server answered HTTP ${r.status}.`);
    }
    return bad("Unknown connector.");
  } catch (err) {
    return bad(err instanceof Error ? err.message : "Test failed.", requestStatus(err));
  }
}
