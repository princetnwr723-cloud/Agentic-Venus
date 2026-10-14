import { NextResponse } from "next/server";
import { readBody, requestStatus } from "@/lib/request";
import { briefAgent, grant, listAgents, validId } from "@/lib/collab";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const b = await readBody(req, { maxBytes: 16 * 1024 });
    const uid = String(b.uid);
    const chatId = String(b.chatId || "");
    if (!validId(chatId)) return NextResponse.json({ error: "Valid chatId is required." }, { status: 400 });
    const action = String(b.action || "");

    if (action === "agents") {
      return NextResponse.json({ agents: await listAgents(uid, chatId) });
    }

    if (action === "brief") {
      const rawTargets = Array.isArray(b.targets) ? b.targets : [];
      const mappedTargets = rawTargets.map((t: unknown) => String(t));
      const validTargets = mappedTargets.filter((x: string): x is string => validId(x));
      const uniqueTargets = Array.from(new Set(validTargets));
      const ids: string[] = uniqueTargets.filter((x: string) => x !== chatId).slice(0, 4);

      if (!ids.length) return NextResponse.json({ briefs: [] });
      const query = String(b.query || "").slice(0, 400);
      const per = Math.floor(6500 / ids.length);
      const got = await Promise.all(ids.map(async (id: string) => {
        const r = await briefAgent(uid, id, query, { budget: per, code: true }).catch(() => null);
        return r ? { id, name: r.name, text: r.text } : null;
      }));
      const briefs = got.filter(Boolean);
      if (briefs.length) await grant(uid, chatId, briefs.map((x) => (x as { id: string }).id)); // the agent may now read their files too
      return NextResponse.json({ briefs });
    }

    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Collaboration request failed." }, { status: requestStatus(e) });
  }
}
