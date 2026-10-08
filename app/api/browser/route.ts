import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase-admin";
import { readBody } from "@/lib/request";
import { resolveValue, vaultGet, vaultPut } from "@/lib/vault";
import { runBrowser } from "@/lib/browser-server";

export const runtime = "nodejs";
export const maxDuration = 60;

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const profileName = (uid: string, chatId: string, url?: string) => {
  let host = "default";
  try { host = new URL(String(url || "https://default.local")).hostname.toLowerCase().replace(/[^a-z0-9.-]/g, "-").slice(0, 70) || "default"; } catch { /* default */ }
  return `browser-profile:${uid.slice(0, 28)}:${chatId.slice(0, 28)}:${host}`.slice(0, 90);
};

/** The saved login for a site, decrypted on the server only. The password never reaches the browser or the model. */
async function credsFor(uid: string, site: string): Promise<{ email: string; password: string } | undefined> {
  const n = norm(site);
  if (n.length < 2) return undefined;
  const snap = await getAdminDb().collection("users").doc(uid).get();
  const all = ((snap.data() as { pcCredentials?: Record<string, { email: string; password: string }> } | undefined)?.pcCredentials ?? {});
  for (const [k, v] of Object.entries(all)) {
    if (k === n || (k.length >= 3 && n.includes(k)) || (n.length >= 3 && k.includes(n))) {
      return { email: await resolveValue(uid, v.email), password: await resolveValue(uid, v.password) };
    }
  }
  return undefined;
}

export async function POST(req: Request) {
  try {
    const body = await readBody(req, { allowJob: true });
    const uid = String(body.uid || "");
    const chatId = String(body.chatId || "");
    const persistProfile = body.persistProfile !== false && Boolean(uid && chatId);
    let session = body.session ?? null;

    // Persist the complete Playwright storage state server-side. This keeps cookies,
    // localStorage and other browser state across separate browser invocations while
    // never exposing the profile to the model or client storage.
    if (persistProfile) {
      const name = profileName(uid, chatId, body.url || (session as { url?: string } | null)?.url);
      const saved = await vaultGet(uid, name).catch(() => null);
      if (saved) {
        try {
          const parsed = JSON.parse(saved) as { url?: string; cookies?: any[]; storageState?: unknown };
          session = { ...(session || {}), ...parsed, ...(session || {}) };
        } catch { /* ignore corrupt profile; current session wins */ }
      }
    }

    const creds = body.creds ?? (typeof body.credSite === "string" ? await credsFor(uid, body.credSite) : undefined);
    const r = await runBrowser({
      session,
      url: typeof body.url === "string" ? body.url : undefined,
      ops: Array.isArray(body.ops) ? body.ops : [],
      creds,
    });

    if (persistProfile) {
      const name = profileName(uid, chatId, r.session.url);
      const safe = JSON.stringify({
        url: r.session.url,
        cookies: r.session.cookies.slice(0, 250),
        storageState: r.session.storageState,
        savedAt: Date.now(),
      });
      if (safe.length <= 700_000) await vaultPut(uid, name, safe);
    }
    return NextResponse.json(r);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Browser failed." }, { status: 500 });
  }
}
