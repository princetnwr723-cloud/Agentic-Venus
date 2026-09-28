// SAVE AS: app/api/routines/run/route.ts
import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase-admin";
import { callProvider } from "@/lib/ai-providers-server";
import type { ProviderId } from "@/lib/providers";

export const maxDuration = 60;

// This route has no per-user session — it's meant to be called by your own
// scheduler (the GitHub Actions workflow or scripts/routine-runner.mjs),
// not by Vercel Cron and not by the browser. A shared secret is the only
// gate, so keep it private.
export async function POST(req: Request) {
  const authHeader = req.headers.get("authorization");
  const expected = `Bearer ${process.env.ROUTINE_RUNNER_SECRET}`;
  if (!process.env.ROUTINE_RUNNER_SECRET) {
    return NextResponse.json(
      { error: "ROUTINE_RUNNER_SECRET is not set on the server (Vercel env vars)." },
      { status: 500 }
    );
  }
  if (authHeader !== expected) {
    return NextResponse.json(
      { error: "Unauthorized — the secret sent doesn't match ROUTINE_RUNNER_SECRET on the server." },
      { status: 401 }
    );
  }

  try {
    const adminDb = getAdminDb();
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
  } catch (err) {
    // Most common causes: missing Firebase Admin env vars, or Firestore
    // needing a composite index (the message then contains a "create index"
    // link — open it, wait a minute, and it works from then on).
    const message = err instanceof Error ? err.message : "Routine runner failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}