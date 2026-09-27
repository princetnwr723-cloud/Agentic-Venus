import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase-admin";
import { callProvider } from "@/lib/ai-providers-server";
import type { ProviderId } from "@/lib/providers";

// This route has no per-user session — it's meant to be called by your own
// standalone runner (scripts/routine-runner.mjs), not by Vercel Cron and
// not by the browser. A shared secret is the only gate, so keep it private.
export async function POST(req: Request) {
  const authHeader = req.headers.get("authorization");
  const expected = `Bearer ${process.env.ROUTINE_RUNNER_SECRET}`;
  if (!process.env.ROUTINE_RUNNER_SECRET || authHeader !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let adminDb;
  try {
    adminDb = getAdminDb();
  } catch (err) {
    const message = err instanceof Error ? err.message : "Routines aren't configured yet.";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  const now = Date.now();
  const due = await adminDb
    .collectionGroup("routines")
    .where("enabled", "==", true)
    .where("nextRunAt", "<=", now)
    .get();

  const results: Array<{ id: string; ok: boolean; error?: string }> = [];

  for (const routineDoc of due.docs) {
    const routine = routineDoc.data() as {
      chatId: string;
      name: string;
      instructions: string;
      everyMinutes: number;
    };
    const userRef = routineDoc.ref.parent.parent;
    if (!userRef) continue;

    try {
      const [userSnap, chatSnap] = await Promise.all([
        userRef.get(),
        userRef.collection("chats").doc(routine.chatId).get(),
      ]);

      const userData = userSnap.data() as
        | { apiKeys?: Partial<Record<ProviderId, string>> }
        | undefined;
      const chat = chatSnap.data() as
        | { provider: ProviderId; model: string; messages?: unknown[] }
        | undefined;

      if (!chat) throw new Error("Chat this routine belongs to was deleted.");

      const apiKey = userData?.apiKeys?.[chat.provider];
      if (!apiKey) throw new Error(`No saved key for ${chat.provider}.`);

      const reply = await callProvider({
        provider: chat.provider,
        apiKey,
        model: chat.model,
        messages: [{ role: "user", content: routine.instructions }],
      });

      const priorMessages = Array.isArray(chat.messages) ? chat.messages : [];
      const newMessages = [
        ...priorMessages,
        { role: "user", content: `🔁 Routine: ${routine.name}`, at: Date.now() },
        { role: "assistant", content: reply, at: Date.now() },
      ];

      await chatSnap.ref.update({ messages: newMessages });
      await routineDoc.ref.update({
        lastRunAt: Date.now(),
        lastResult: reply.slice(0, 200),
        nextRunAt: now + routine.everyMinutes * 60_000,
      });

      results.push({ id: routineDoc.id, ok: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Routine run failed.";
      await routineDoc.ref.update({
        lastRunAt: Date.now(),
        lastResult: `⚠️ ${message}`,
        nextRunAt: now + routine.everyMinutes * 60_000,
      });
      results.push({ id: routineDoc.id, ok: false, error: message });
    }
  }

  return NextResponse.json({ checked: due.size, results });
}