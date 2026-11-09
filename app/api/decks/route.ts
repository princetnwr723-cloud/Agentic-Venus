import { NextResponse } from "next/server";
import { verifyUser } from "@/lib/server-auth";
import { deleteDeck, generateDeck, getDeck, listDecks, saveDeck } from "@/lib/decks-server";

export const runtime = "nodejs";
export const maxDuration = 120;

const fail = (m: string, s = 500) => NextResponse.json({ error: m }, { status: s });

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const { uid } = await verifyUser(req, body.uid);
    const action = String(body.action || "list");
    if (action === "list") return NextResponse.json({ decks: await listDecks(uid, body.chatId ? String(body.chatId) : undefined) });
    if (action === "get") {
      const d = await getDeck(uid, String(body.id || ""));
      return d ? NextResponse.json({ deck: d }) : fail("Deck not found.", 404);
    }
    if (action === "save") return NextResponse.json({ deck: await saveDeck(uid, { ...(body.deck ?? {}), id: body.deck?.id, by: "owner" }) });
    if (action === "delete") { await deleteDeck(uid, String(body.id || "")); return NextResponse.json({ ok: true }); }
    if (action === "generate") return NextResponse.json({ deck: await generateDeck(uid, { chatId: String(body.chatId || ""), topic: String(body.topic || ""), slides: Number(body.slides), theme: body.theme ? String(body.theme) : undefined, language: body.language ? String(body.language) : undefined }) });
    return fail("Unknown action.", 400);
  } catch (e) {
    const m = e instanceof Error ? e.message : "Decks failed.";
    const status = (e as { status?: number })?.status;
    return fail(m, status ?? (/sign in|Session missing|token/i.test(m) ? 401 : 400));
  }
}