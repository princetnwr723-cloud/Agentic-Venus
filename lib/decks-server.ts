// Server-only. Decks are stored at users/{uid}/decks/{id}. The browser reaches them through /api/decks, the agent through the deck.* tools.
import { getAdminDb } from "@/lib/firebase-admin";
import { callProvider } from "@/lib/ai-providers-server";
import { loadAgent } from "@/lib/voice-calls";
import { parseJsonLoose } from "@/lib/learn-utils";
import { audit } from "@/lib/audit";
import { cleanDeck, parseDeckText, type Deck, type DeckSummary, type Slide } from "@/lib/decks";

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
  if (!c.slides.length) throw new Error("The deck has no usable slides. Each slide needs an html design (a 1280x720 HTML fragment) or, for the old layouts, a layout and a title.");
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

const FORMAT = `<deck-title>short deck title</deck-title>
<deck-subtitle>one line</deck-subtitle>
<slide>
<notes>2-3 sentences of what the speaker says on this slide</notes>
<div style="width:1280px;height:720px;position:relative;overflow:hidden;background:...">... your own design of this slide ...</div>
</slide>
<slide> ... next slide ... </slide>`;

export const DECK_GUIDE = `THERE IS NO FIXED TEMPLATE. YOU are the designer: design every slide from scratch so this deck looks different from every other deck and fits its topic and audience (a startup pitch, a school lesson, a luxury brand, a technical talk all look different). Each slide is ONE HTML fragment for a 1280x720 canvas: a root <div style='width:1280px;height:720px;position:relative;overflow:hidden;...'> that has its own background, colours, type, spacing and composition. Use inline CSS or one <style> block, flexbox / grid, gradients, big type, cards, and inline <svg> for shapes, icons, charts, diagrams and illustrations. System font stacks only. NO <script>, NO external CSS / JS / fonts / images (they do not load): draw everything with CSS and inline SVG. Rules for a good result: ONE palette and ONE type pairing for the whole deck; vary the composition from slide to slide (big statement, split screen, number wall, diagram, timeline, comparison, full-bleed colour, quote); headings 48px or bigger, body text 24px or bigger, nothing outside the canvas, nothing overlapping by accident; one idea per slide, few words, strong hierarchy; the first slide is a real cover and the last slide a real closing. Real facts only: if you do not know a number, do not invent it. In the html use single quotes for attributes. Add speaker notes (2-3 sentences) to every slide.`;

/** The owner pressed "Make presentation" in the Decks window: this chat's own model designs and writes the deck. */
export async function generateDeck(uid: string, p: { chatId: string; topic: string; slides?: number; style?: string; language?: string }): Promise<Deck> {
  const topic = String(p.topic || "").trim().slice(0, 1500);
  if (topic.length < 3) throw new Error("Tell me what the deck is about.");
  const n = Math.max(3, Math.min(24, Math.floor(Number(p.slides) || 10)));
  const style = String(p.style || "").replace(/\s+/g, " ").trim().slice(0, 200);
  const agent = await loadAgent(uid, p.chatId);
  const sys = `You are a world-class presentation designer and storyteller. Design a complete presentation. Reply in EXACTLY this format and nothing else (no prose before or after, no code fences):\n${FORMAT}\n\n${DECK_GUIDE}\nWrite in the language of the topic${p.language ? ` (${p.language})` : ""}. Exactly ${n} slides.${style ? ` The owner wants this look and feel: ${style}.` : " Choose the look that suits the topic best."}`;
  let tokens = Math.min(16000, 1300 * n + 1500);
  let deck: ReturnType<typeof cleanDeck> | null = null;
  let lastErr = "";
  for (let i = 0; i < 3 && !deck; i++) {
    let raw = "";
    try {
      raw = await callProvider({ provider: agent.provider, apiKey: agent.apiKey, model: agent.model, maxTokens: tokens, messages: [{ role: "system", content: sys }, { role: "user", content: `TOPIC / BRIEF:\n${topic}${i ? "\n\nIMPORTANT: use the exact <deck-title> and <slide> format." : ""}` }] });
    } catch (e) {
      lastErr = e instanceof Error ? e.message : "The model failed.";
      if (/max_tokens|maximum|token/i.test(lastErr) && tokens > 6000) { tokens = 6000; continue; } // this model allows less output: ask for less
      throw e;
    }
    const parsed = parseDeckText(raw);
    if (parsed) {
      // a reply that was cut off in the middle of its last slide: that slide is not usable
      const closed = (raw.match(/<\/slide>/gi) ?? []).length;
      if (closed < parsed.slides.length && parsed.slides.length >= 3) parsed.slides.pop();
      const c = cleanDeck(parsed);
      if (c.slides.length >= 2) deck = c;
      continue;
    }
    const c = cleanDeck(parseJsonLoose(raw)); // a model that answered with JSON (html field or old layouts) still works
    if (c.slides.length >= 2) deck = c;
  }
  if (!deck) throw new Error(lastErr || "The model did not return a usable presentation. Try again, or pick a stronger model for this chat (a bigger model designs better slides).");
  return saveDeck(uid, { ...deck, chatId: p.chatId, by: "owner" });
}
