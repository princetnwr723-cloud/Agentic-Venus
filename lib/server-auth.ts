// Server-only. Confirms who is calling when the Firebase Admin env vars exist
// (the same ones the Routines feature uses). Without them it falls back to the
// uid sent by the browser — fine for a personal beta, not for a public launch.

export async function verifyUser(
  req: Request,
  fallbackUid?: unknown
): Promise<{ uid: string; verified: boolean }> {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n");

  if (projectId && clientEmail && privateKey) {
    const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    if (!token) throw new Error("Session missing — dobara sign in karo.");
    const { cert, getApps, initializeApp } = await import("firebase-admin/app");
    const { getAuth } = await import("firebase-admin/auth");
    const app = getApps().length
      ? getApps()[0]
      : initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
    const decoded = await getAuth(app).verifyIdToken(token);
    return { uid: decoded.uid, verified: true };
  }

  const uid = String(fallbackUid ?? "").replace(/[^A-Za-z0-9_-]/g, "");
  if (!uid) throw new Error("User id missing.");
  return { uid, verified: false };
}