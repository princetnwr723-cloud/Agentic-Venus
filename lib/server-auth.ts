// Server-only. Confirms who is calling. No more "trust the uid the browser sent".
// Local development without Firebase Admin env vars: set ALLOW_INSECURE_DEV=1 (never in production).

export async function verifyUser(req: Request, fallbackUid?: unknown): Promise<{ uid: string; verified: boolean }> {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n");

  if (projectId && clientEmail && privateKey) {
    const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    if (!token) throw new Error("Session missing — please sign in again.");
    const { cert, getApps, initializeApp } = await import("firebase-admin/app");
    const { getAuth } = await import("firebase-admin/auth");
    const app = getApps().length ? getApps()[0] : initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
    const decoded = await getAuth(app).verifyIdToken(token);
    return { uid: decoded.uid, verified: true };
  }

  if (process.env.ALLOW_INSECURE_DEV === "1") {
    const uid = String(fallbackUid ?? "").replace(/[^A-Za-z0-9_-]/g, "");
    if (!uid) throw new Error("User id missing.");
    return { uid, verified: false };
  }
  throw new Error("Server auth is not configured: set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY in Vercel.");
}
