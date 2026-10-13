// Server-only. Once a day (per chat) the agent may send ONE useful message by itself.
import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase-admin";
import { callProvider } from "@/lib/ai-providers-server";
import { loadAgent } from "@/lib/voice-calls";
import { readMem } from "@/lib/learning";
import { notifyOwner } from "@/lib/channels";
import { splitSuggestions, withNext } from "@/lib/suggest";

const DAY = 86_400_000;
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) + "…" : s);
type Msg = { role: string; content: string; at: number };

export async function runProactive(budgetMs = 45_000) {
  const t0 = Date.now();
  const db = getAdminDb();
  const users = await db.collection("users").select().limit(150).get();
  const out: Array<{ chat: string; status: string }> = [];

  for (const u of users.docs) {
    if (Date.now() - t0 > budgetMs) break;
    const chats = await u.ref.collection("chats").get();
    for (const c of chats.docs) {
      if (Date.now() - t0 > budgetMs) break;
      const d = c.data() as { proactive?: boolean; proactiveAt?: number; messages?: Msg[] };
      const msgs = Array.isArray(d.messages) ? d.messages : [];
      if (!msgs.length || d.proactive === false) continue;
      const last = msgs[msgs.length - 1];
      if (Date.now() - (Number(last.at) || 0) > 14 * DAY) continue; // inactive chat
      if (Date.now() - (d.proactiveAt ?? 0) < 20 * 3600_000) continue; // at most one per day
      // do not pile up: an earlier proactive message is still unanswered
      if (last.role === "assistant" && last.content.startsWith("💡") && Date.now() - (Number(last.at) || 0) < 3 * DAY) continue;

      // claim the slot (two overlapping ticks must not both send)
      const claimed = await db.runTransaction(async (tx) => {
        const s = await tx.get(c.ref);
        if (Date.now() - ((s.data() as { proactiveAt?: number } | undefined)?.proactiveAt ?? 0) < 20 * 3600_000) return false;
        tx.update(c.ref, { proactiveAt: Date.now() });
        return true;
      }).catch(() => false);
      if (!claimed) continue;

      try {
        const agent = await loadAgent(u.id, c.id);
        const mem = await readMem(u.id, c.id);
        const role = mem.find((m) => m.kind === "role")?.text ?? "";
        const profile = mem.filter((m) => m.kind !== "role" && m.kind !== "lesson").slice(-30).map((m) => `- ${m.text}`).join("\n");
        const recent = msgs.slice(-12).map((m) => `${m.role === "user" ? "OWNER" : "YOU"}: ${clip(splitSuggestions(m.content).body.replace(/\s+/g, " "), 300)}`).join("\n");
        const raw = (await callProvider({
          provider: agent.provider, apiKey: agent.apiKey, model: agent.model, maxTokens: 500,
          messages: [{ role: "user", content:
`You are ${agent.name}, the owner's proactive AI teammate.${role ? ` Your role: ${role}.` : ""} Now (UTC): ${new Date().toISOString()}.
Decide whether to send ONE short proactive message to the owner, in the owner's own language and style.
Good: a concrete next step on something already in progress, a useful reminder drawn from the recent messages, an idea tied to their goals, or ONE friendly question that helps you learn about them (only if you know little).
Bad: generic greetings, repeating earlier messages, anything not grounded in the profile or recent messages.
If nothing is worth sending, reply exactly: SKIP
Otherwise reply with JSON only: {"message":"max 4 short lines","next":["short command 1","short command 2"]} (next = two commands, max 8 words each, that the owner can tap).

WHAT YOU KNOW ABOUT THE OWNER:
${profile || "(very little)"}

RECENT CONVERSATION:
${recent}` }],
        })).trim();
        if (/^SKIP\b/i.test(raw)) { out.push({ chat: c.id, status: "skipped" }); continue; }
        const a = raw.indexOf("{"), z = raw.lastIndexOf("}");
        const j = a >= 0 && z > a ? (JSON.parse(raw.slice(a, z + 1)) as { message?: string; next?: string[] }) : null;
        const message = String(j?.message ?? "").trim();
        if (!message) { out.push({ chat: c.id, status: "empty" }); continue; }
        const text = withNext(`💡 ${message}`, (j?.next ?? []).map(String));
        await c.ref.update({ messages: FieldValue.arrayUnion({ role: "assistant", content: text, at: Date.now() }) });
        await notifyOwner(u.id, c.id, `💡 ${message}`).catch(() => {});
        out.push({ chat: c.id, status: "sent" });
      } catch (e) {
        out.push({ chat: c.id, status: "error: " + (e instanceof Error ? e.message.slice(0, 80) : "failed") });
      }
    }
  }
  return out;
}