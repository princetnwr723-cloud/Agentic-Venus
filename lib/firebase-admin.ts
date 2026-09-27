// Server-only. Uses a Firebase service account (not the public client
// config) so the routine runner can read/write across every user's
// routines — the client SDK, scoped by firestore.rules, can't do that
// and shouldn't.
//
// Initialization is lazy on purpose: this file does nothing at import
// time. If it ran eagerly at module scope, Next.js would try to execute
// it while analyzing the /api/routines/run route during `next build` —
// and if the 3 env vars below aren't set yet, that would fail the
// *entire* deployment, not just this one route. Calling getAdminDb()
// only happens inside the route handler itself, at request time.

import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

let cachedDb: Firestore | null = null;

export function getAdminDb(): Firestore {
  if (cachedDb) return cachedDb;

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n");

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error(
      "Routines aren't set up yet — add FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY in Vercel (README → Routines)."
    );
  }

  const app: App = getApps().length
    ? getApps()[0]
    : initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });

  cachedDb = getFirestore(app);
  return cachedDb;
}