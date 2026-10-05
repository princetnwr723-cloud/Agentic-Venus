import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase-admin";
import { readBody } from "@/lib/request";
import { resolveValue } from "@/lib/vault";
import { runBrowser } from "@/lib/browser-server";

export const runtime = "nodejs";
export const maxDuration = 60;

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

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
    const creds = body.creds ?? (typeof body.credSite === "string" ? await credsFor(body.uid, body.credSite) : undefined);
    const r = await runBrowser({
      session: body.session ?? null,
      url: typeof body.url === "string" ? body.url : undefined,
      ops: Array.isArray(body.ops) ? body.ops : [],
      creds,
    });
    return NextResponse.json(r);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Browser failed." }, { status: 500 });
  }
}
