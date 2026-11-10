// Server-only. Decks are stored at users/{uid}/decks/{id}. The browser reaches them through /api/decks, the agent through the deck.* tools.
import { getAdminDb } from "@/lib/firebase-admin";
import { callProvider } from "@/lib/ai-providers-server";
import { loadAgent } from "@/lib/voice-calls";
import { parseJsonLoose } from "@/lib/learn-utils";
import { audit } from "@/lib/audit";
import { cleanDeck, DECK_THEMES, type Deck, type DeckSummary, type Slide } from "@/lib/decks";

const col = (uid: string) => getAdminDb().collection("users").doc(uid).collection("decks");
const MAX_DECKS = 300;
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

const toDeck = (id: string, d: Record<string, unknown>): Deck => ({
  id, chatId: String(d.chatId ?? ""), title: String(d.title ?? "Untitled deck"), subtitle: d.subtitle ? String(d.subtitle) : undefined,
  theme: String(d.theme ?? "venus"), slides: Array.isArray(d.slides) ? (d.slides as Slide[]) : [], createdAt: num(d.createdAt), updatedAt: num(d.updatedAt), by: d.by === "owner" ? "owner" : "agent",
});

/** A deck in the list, with its first slide so the list can show a small preview. */
export type DeckListItem = DeckSummary & { cover?: Slide };

export async function listDecks(uid: string, chatId?: string): Promise<DeckListItem[]> {
  const snap = await col(uid).orderBy("updatedAt", "desc").limit(200).get();
  return snap.docs.map((x) => { const d = x.data(); return { id: x.id, chatId: String(d.chatId ?? ""), title: String(d.title ?? ""), theme: String(d.theme ?? "venus"), slideCount: Array.isArray(d.slides) ? d.slides.length : 0, cover: Array.isArray(d.slides) ? (d.slides[0] as Slide | undefined) : undefined, createdAt: num(d.createdAt), updatedAt: num(d.updatedAt), by: d.by }; })
    .filter((d) => !chatId || d.chatId === chatId);
}

export async function getDeck(uid: string, id: string): Promise<Deck | null> {
  const s = await col(uid).doc(String(id).replace(/[^A-Za-z0-9_-]/g, "")).get();
  return s.exists ? toDeck(s.id, s.data() as Record<string, unknown>) : null;
}

/** Creates a deck (no id) or replaces the content of one. Everything is cleaned first. */
export async function saveDeck(uid: string, input: { id?: string; chatId?: string; by?: "agent" | "owner"; [k: string]: unknown }): Promise<Deck> {
  const c = cleanDeck(input);
  if (!c.slides.length) throw new Error("The deck has no usable slides. Each slide needs a layout and a title (or bullets / quote / stats / steps).");
  const now = Date.now();
  if (input.id) {
    const cur = await getDeck(uid, input.id);
    if (!cur) throw new Error("Deck not found.");
    await col(uid).doc(cur.id).set({ ...c, chatId: cur.chatId, createdAt: cur.createdAt, updatedAt: now, by: cur.by ?? "agent" });
    return { ...cur, ...c, updatedAt: now };
  }
  if ((await col(uid).count().get()).data().count >= MAX_DECKS) throw new Error(`You already have ${MAX_DECKS} decks. Delete some in Decks first.`);
  const ref = col(uid).doc();
  const doc = { ...c, chatId: String(input.chatId ?? ""), createdAt: now, updatedAt: now, by: input.by === "owner" ? "owner" : "agent" };
  await ref.set(doc);
  await audit(uid, { kind: "deck_created", chatId: doc.chatId, text: `${ref.id}: ${c.title} (${c.slides.length} slides)` });
  return toDeck(ref.id, doc);
}

export async function deleteDeck(uid: string, id: string) {
  await col(uid).doc(String(id).replace(/[^A-Za-z0-9_-]/g, "")).delete();
}

const SCHEMA = `{"title":"...","subtitle":"...","theme":"venus|paper|ocean|sunset|forest|mono","slides":[{"layout":"title|section|bullets|two-column|comparison|stats|timeline|quote|closing","kicker":"small label","title":"...","subtitle":"...","body":"one lead sentence","bullets":["..."],"left":{"title":"...","bullets":["..."]},"right":{"title":"...","bullets":["..."]},"stats":[{"value":"4x","label":"..."}],"steps":[{"title":"...","text":"..."}],"quote":"...","by":"...","notes":"what the speaker says"}]}`;

export const DECK_GUIDE = `Slide layouts (use a MIX, never 8 bullet slides in a row): title (first slide: title, subtitle, body=presenter/date), section (kicker="01", title), bullets (title, 3-5 short bullets, max 12 words each), two-column (title, left{title,bullets}, right{title,bullets}), comparison (same as two-column, for A vs B), stats (title, 2-4 stats {value,label}), timeline (title, 3-5 steps {title,text}), quote (quote, by), closing (title, subtitle, bullets=contact lines). One idea per slide. Real facts only: if you do not know a number, do not invent it. Add speaker notes (2-3 sentences) to every slide. Themes: ${DECK_THEMES.map((t) => t.id).join(", ")}.`;

/** The owner pressed "Make presentation" in the Decks window: this chat's own model writes the deck. */
export async function generateDeck(uid: string, p: { chatId: string; topic: string; slides?: number; theme?: string; language?: string }): Promise<Deck> {
  const topic = String(p.topic || "").trim().slice(0, 1500);
  if (topic.length < 3) throw new Error("Tell me what the deck is about.");
  const n = Math.max(3, Math.min(24, Math.floor(Number(p.slides) || 10)));
  const agent = await loadAgent(uid, p.chatId);
  const sys = `You are a presentation designer. Reply with ONE valid JSON object only (no prose, no code fences) in this shape:\n${SCHEMA}\n\n${DECK_GUIDE}\nWrite in the language of the topic${p.language ? ` (${p.language})` : ""}. Exactly ${n} slides: first "title", last "closing".`;
  let deck: ReturnType<typeof cleanDeck> | null = null;
  for (let i = 0; i < 2 && !deck; i++) {
    const raw = await callProvider({ provider: agent.provider, apiKey: agent.apiKey, model: agent.model, maxTokens: 7000, messages: [{ role: "system", content: sys }, { role: "user", content: `TOPIC / BRIEF:\n${topic}${i ? "\n\nIMPORTANT: reply with the JSON object only." : ""}` }] });
    const c = cleanDeck(parseJsonLoose(raw));
    if (c.slides.length >= 2) deck = c;
  }
  if (!deck) throw new Error("The model did not return a usable deck. Try again, or pick a stronger model for this chat.");
  if (p.theme && DECK_THEMES.some((t) => t.id === p.theme)) deck.theme = p.theme;
  return saveDeck(uid, { ...deck, chatId: p.chatId, by: "owner" });
}