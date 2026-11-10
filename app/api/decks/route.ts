import { NextResponse } from "next/server";
import { verifyUser } from "@/lib/server-auth";
import { deleteDeck, generateDeck, getDeck, listDecks, saveDeck } from "@/lib/decks-server";
import { postToChat } from "@/lib/dashboard-server";

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
    // messages written by the server show up live in the open chat (a message the browser writes itself is ignored by the chat screen)
    if (action === "post") {
      const msgs = (Array.isArray(body.messages) ? body.messages : []).slice(0, 3)
        .map((m: { role?: unknown; content?: unknown }) => ({ role: m?.role === "user" ? ("user" as const) : ("assistant" as const), content: String(m?.content ?? "").slice(0, 4000) }))
        .filter((m: { content: string }) => m.content.trim());
      if (!body.chatId || !msgs.length) return fail("Nothing to post.", 400);
      await postToChat(uid, String(body.chatId), msgs);
      return NextResponse.json({ ok: true });
    }
    if (action === "generate") {
      const chatId = String(body.chatId || "");
      const announce = body.announce === true && Boolean(chatId); // the chat command: the result is written into the chat by the server
      try {
        const deck = await generateDeck(uid, { chatId, topic: String(body.topic || ""), slides: Number(body.slides), style: body.style ? String(body.style) : undefined, language: body.language ? String(body.language) : undefined });
        if (announce) await postToChat(uid, chatId, [{ role: "assistant", content: `✅ Your presentation **${deck.title}** is ready (${deck.slides.length} slides). Open the **Decks** button (presentation icon) to preview it, present it, edit it and download PowerPoint / HTML / PDF.` }]).catch(() => undefined);
        return NextResponse.json({ deck });
      } catch (e) {
        if (announce) await postToChat(uid, chatId, [{ role: "assistant", content: `⚠️ I could not make the presentation: ${e instanceof Error ? e.message : "something went wrong"}\n\nTry again, use fewer slides, or pick a stronger model for this chat.` }]).catch(() => undefined);
        throw e;
      }
    }
    return fail("Unknown action.", 400);
  } catch (e) {
    const m = e instanceof Error ? e.message : "Decks failed.";
    const status = (e as { status?: number })?.status;
    return fail(m, status ?? (/sign in|Session missing|token/i.test(m) ? 401 : 400));
  }
}
