// Deterministic guard for the "understand first" router (intent.ts).
// Posting, uploading a finished video or researching on a connected social platform is a TOOL CALL (social.*).
// It must never open the computer (browser upload), Venus Code, or the video maker.

const PLATFORM = /\b(youtube|you tube|yt|shorts?|instagram|insta|ig|reels?|facebook|fb|tiktok|tik tok|linkedin|twitter|x\.com|threads|pinterest|reddit|social media|socials?)\b/i;
const ACTION = /\b(upload\w*|post\w*|publish\w*|share|schedule|put|daal\w*|dal\s?do|dalo|chadha\w*|lagao|laga\s?do|dobara|again|another|ek aur|aur ek|research|search|trend\w*|analy[sz]e|stats?|numbers?|performance|views?|likes?|competitors?|ideas?)\b/i;
const VIDEO_WORD = /\b(video|videos|vid|reel|reels|short|shorts|clip)\b/i;
// Making a NEW video (and then posting it) is a multi-step job for the video maker / team, not a single tool call.
const MAKE_NEW = /\b(make|create|generate|render|produce|banao|bana\w*|nayi|naya|new)\b[\s\S]{0,40}\b(video|reel|short|clip)\b|\b(video|reel|short|clip)\b[\s\S]{0,25}\b(banao|bana\w*|make|create|generate|render)\b/i;
// Real scraping / lead collection is computer work even when a platform is named.
const HEAVY = /\b(scrape|scraping|crawl|leads?|prospects?|emails? list)\b/i;

/**
 * @param text    the latest user message
 * @param tools   names of the tools available in this chat
 * @param recent  the last few messages (so "upload another one" still counts when the platform was named earlier)
 */
export function socialToolIntent(text: string, tools: string[] = [], recent = ""): boolean {
  if (!tools.some((n) => n.startsWith("social."))) return false;
  const t = String(text ?? "").slice(0, 1500);
  if (!t.trim() || t.startsWith("/")) return false;
  if (MAKE_NEW.test(t) || HEAVY.test(t)) return false;
  if (!ACTION.test(t)) return false;
  if (PLATFORM.test(t)) return true;
  // No platform in this message ("ek aur video upload kar do"): look at the recent conversation.
  return VIDEO_WORD.test(t) && PLATFORM.test(String(recent ?? "").slice(-2500));
}