import { NextResponse } from "next/server";
import { readBody, requestStatus } from "@/lib/request";
import { repoInfo, runClone, runPush, runStatus } from "@/lib/repo-server";

export const runtime = "nodejs";
export const maxDuration = 60;

const ID = /^[A-Za-z0-9_-]{4,160}$/;
const fail = (m: string, s = 500) => NextResponse.json({ error: m }, { status: s });

export async function POST(req: Request) {
  try {
    const b = await readBody(req, { maxBytes: 8 * 1024 });
    const uid = String(b.uid);
    const chatId = String(b.ws || b.chatId || "");
    if (!ID.test(chatId)) return fail("Valid chat id is required.", 400);
    const action = String(b.action || "");

    if (action === "info") return NextResponse.json({ repo: await repoInfo(uid, chatId) });
    if (action === "status") return NextResponse.json(await runStatus(uid, chatId));
    if (action === "clone") {
      return NextResponse.json(await runClone(uid, chatId, { repo: String(b.repo || ""), branch: b.branch ? String(b.branch) : undefined, full: b.full === true }));
    }
    if (action === "push") {
      return NextResponse.json(await runPush(uid, chatId, { branch: b.branch ? String(b.branch) : undefined, message: b.message ? String(b.message) : undefined, direct: b.direct === true }));
    }
    return fail("Unknown action.", 400);
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Repository request failed.", requestStatus(e));
  }
}
