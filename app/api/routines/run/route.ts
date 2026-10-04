import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase-admin";
import { runWebAgent } from "@/lib/agent-server";
import type { Fallback } from "@/lib/ai-providers-server";
import type { ProviderId } from "@/lib/providers";

export const maxDuration = 60;

const FALLBACK_MODEL: Partial<Record<ProviderId, string>> = {
  anthropic: "claude-haiku-4-5-20251001", openai: "gpt-4o-mini", gemini: "gemini-2.0-flash",
  grok: "grok-4-fast", deepseek: "deepseek-chat", mistral: "mistral-small-latest", groq: "llama-3.3-70b-versatile",
};

export async function POST(req: Request) {
  const t0 = Date.now();
  if (!process.env.ROUTINE_RUNNER_SECRET) {
    return NextResponse.json({ error: "ROUTINE_RUNNER_SECRET is not set on the server (Vercel env vars)." }, { status: 500 });
  }
  if (req.headers.get("authorization") !== `Bearer ${process.env.ROUTINE_RUNNER_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized — the secret sent doesn't match ROUTINE_RUNNER_SECRET on the server." }, { status: 401 });
  }

  try {
    const adminDb = getAdminDb();
    const now = Date.now();
    const due = await adminDb.collectionGroup("routines").where("enabled", "==", true).where("nextRunAt", "<=", now).get();
    const results: Array<{ id: string; ok: boolean; error?: string; deferred?: boolean }> = [];

    for (const routineDoc of due.docs) {
      // Time budget: anything we can't finish stays "due" and is picked up by the next tick.
      if (Date.now() - t0 > 40_000) { results.push({ id: routineDoc.id, ok: true, deferred: true }); continue; }

      const routine = routineDoc.data() as { chatId: string; name: string; instructions: string; everyMinutes: number };
      const userRef = routineDoc.ref.parent.parent;
      if (!userRef) continue;
      const next = () => Date.now() + routine.everyMinutes * 60_000;

      try {
        const [userSnap, chatSnap, memSnap] = await Promise.all([
          userRef.get(),
          userRef.collection("chats").doc(routine.chatId).get(),
          userRef.collection("brain").doc("memories").get(),
        ]);
        const userData = userSnap.data() as { apiKeys?: Partial<Record<ProviderId, string>> } | undefined;
        const chat = chatSnap.data() as { provider: ProviderId; model: string; messages?: unknown[] } | undefined;
        if (!chat) throw new Error("Chat this routine belongs to was deleted.");
        const keys = userData?.apiKeys ?? {};
        const apiKey = keys[chat.provider];
        if (!apiKey) throw new Error(`No saved key for ${chat.provider}.`);

        const fallbacks: Fallback[] = (Object.keys(keys) as ProviderId[])
          .filter((p) => p !== chat.provider && keys[p] && FALLBACK_MODEL[p])
          .slice(0, 2)
          .map((p) => ({ provider: p, apiKey: keys[p] as string, model: FALLBACK_MODEL[p] as string }));

        const mems = ((memSnap.data() as { items?: Array<{ text: string }> } | undefined)?.items ?? []).slice(-15).map((m) => `- ${m.text}`).join("\n");

        const { text, steps } = await runWebAgent({
          provider: chat.provider, apiKey, model: chat.model, fallbacks,
          instructions: routine.instructions, memory: mems,
          deadline: Math.min(Date.now() + 30_000, t0 + 50_000),
        });

        const reply = steps.length ? `${text}\n\n_Tools used: ${steps.join(" · ")}_` : text;
        const prior = Array.isArray(chat.messages) ? chat.messages : [];
        await chatSnap.ref.update({
          messages: [...prior, { role: "user", content: `🔁 Routine: ${routine.name}`, at: Date.now() }, { role: "assistant", content: reply, at: Date.now() }],
        });
        await routineDoc.ref.update({ lastRunAt: Date.now(), lastResult: text.slice(0, 200), nextRunAt: next() });
        results.push({ id: routineDoc.id, ok: true });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Routine run failed.";
        await routineDoc.ref.update({ lastRunAt: Date.now(), lastResult: `⚠️ ${message}`, nextRunAt: next() });
        // Failure alert inside the chat, so the user actually notices.
        try {
          const cs = await userRef.collection("chats").doc(routine.chatId).get();
          if (cs.exists) {
            const prior = Array.isArray((cs.data() as { messages?: unknown[] }).messages) ? (cs.data() as { messages: unknown[] }).messages : [];
            await cs.ref.update({ messages: [...prior, { role: "assistant", content: `🔔 Routine **${routine.name}** failed: ${message}`, at: Date.now() }] });
          }
        } catch { /* alert is best-effort */ }
        results.push({ id: routineDoc.id, ok: false, error: message });
      }
    }
    return NextResponse.json({ checked: due.size, results });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Routine runner failed." }, { status: 500 });
  }
}