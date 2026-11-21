// Server-only. Reads the owner's Google Calendar straight from Google with the login saved for the chat.
// (The generic oauth_google.request tool cuts every answer at 6000 characters, which loses events on a busy calendar.)
import { OAUTH_PROVIDERS } from "@/lib/tools/oauth-catalog";
import { oauthAccess } from "@/lib/tools/oauth-token";
import { makeCtx } from "@/lib/tools/connectors";
import type { loadAgent } from "@/lib/voice-calls";

type Agent = Awaited<ReturnType<typeof loadAgent>>;
export type GoogleEvents = { connected: boolean; ok: boolean; json: { timeZone?: string; items: unknown[] } | null; error?: string };

const FIELDS = "timeZone,nextPageToken,items(id,status,summary,description,location,start,end,hangoutLink,recurringEventId,organizer(displayName,email,self),attendees(displayName,email,self,responseStatus,resource),conferenceData/entryPoints(entryPointType,uri))";

/** All events of the primary calendar between two instants (recurring ones expanded), up to three pages of 250. */
export async function googleEvents(uid: string, agent: Agent, fromMs: number, toMs: number): Promise<GoogleEvents> {
  const provider = OAUTH_PROVIDERS.find((p) => p.id === "google");
  const raw = (agent.connectors as Record<string, string | undefined>)["oauth:google"];
  if (!provider || !raw) return { connected: false, ok: false, json: null };
  let access: string;
  try { access = await oauthAccess(provider, raw, makeCtx(uid, agent.chatId)); }
  catch (e) { return { connected: true, ok: false, json: null, error: e instanceof Error ? e.message.slice(0, 200) : "The Google login could not be used. Reconnect Google in Connectors." }; }
  const items: unknown[] = [];
  let timeZone: string | undefined, page = "";
  for (let i = 0; i < 3; i++) {
    const url = "https://www.googleapis.com/calendar/v3/calendars/primary/events?singleEvents=true&orderBy=startTime&showDeleted=false&maxResults=250"
      + `&timeMin=${encodeURIComponent(new Date(fromMs).toISOString())}&timeMax=${encodeURIComponent(new Date(toMs).toISOString())}&fields=${encodeURIComponent(FIELDS)}${page ? `&pageToken=${encodeURIComponent(page)}` : ""}`;
    let res: Response;
    try { res = await fetch(url, { headers: { Authorization: `Bearer ${access}`, Accept: "application/json" }, signal: AbortSignal.timeout(15_000) }); }
    catch { return { connected: true, ok: false, json: null, error: "Google Calendar could not be reached. Try again in a minute." }; }
    const j = (await res.json().catch(() => ({}))) as { timeZone?: string; nextPageToken?: string; items?: unknown[]; error?: { message?: string } };
    if (!res.ok) {
      const why = String(j.error?.message ?? "").slice(0, 160);
      return { connected: true, ok: false, json: null, error: res.status === 401 ? "Google refused the login. Reconnect Google in Connectors." : `Google Calendar said no (HTTP ${res.status}${why ? ": " + why : ""}). Check that the Google Calendar API is enabled for your Google Cloud project.` };
    }
    timeZone = j.timeZone ?? timeZone;
    items.push(...(j.items ?? []));
    if (!j.nextPageToken) break;
    page = j.nextPageToken;
  }
  return { connected: true, ok: true, json: { timeZone, items } };
}
