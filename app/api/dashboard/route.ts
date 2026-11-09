import { NextResponse } from "next/server";
import { verifyUser } from "@/lib/server-auth";
import { collectStats, enableDashboard, isDashboardOn, postToChat } from "@/lib/dashboard-server";
import { DASHBOARD_CREATED, DASHBOARD_EXISTS, isDashboardCommand } from "@/lib/dashboard-intent";

export const runtime = "nodejs";
export const maxDuration = 60;

const fail = (m: string, s = 500) => NextResponse.json({ error: m }, { status: s });
const cache = new Map<string, { at: number; data: unknown }>();

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const { uid } = await verifyUser(req, body.uid);
    const chatId = String(body.chatId || "").replace(/[^A-Za-z0-9_-]/g, "");
    if (!chatId) return fail("chatId is missing.", 400);
    const action = String(body.action || "stats");

    if (action === "stats") {
      const tz = Math.max(-840, Math.min(840, Math.round(Number(body.tz) || 0)));
      const key = `${uid}:${chatId}:${tz}`;
      const hit = cache.get(key);
      if (hit && Date.now() - hit.at < 4000 && body.fresh !== true) return NextResponse.json(hit.data);
      const data = await collectStats(uid, chatId, tz);
      cache.set(key, { at: Date.now(), data });
      if (cache.size > 200) cache.delete(cache.keys().next().value as string);
      return NextResponse.json(data);
    }

    if (action === "command") {
      const text = String(body.text || "");
      if (!isDashboardCommand(text)) return fail("That is not the dashboard command.", 400);
      const st = await isDashboardOn(uid, chatId);
      if (!st.exists) return fail("Chat not found.", 404);
      const r = await enableDashboard(uid, chatId);
      await postToChat(uid, chatId, [{ role: "user", content: text.trim() }, { role: "assistant", content: r.created ? DASHBOARD_CREATED : DASHBOARD_EXISTS }]);
      cache.delete(`${uid}:${chatId}:`);
      return NextResponse.json({ created: r.created });
    }

    return fail("Unknown action.", 400);
  } catch (e) {
    const m = e instanceof Error ? e.message : "Dashboard failed.";
    return fail(m, /sign in|Session missing|token/i.test(m) ? 401 : 500);
  }
}