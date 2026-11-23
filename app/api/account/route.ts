import { NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin";
import { readBody, requestStatus, RequestError } from "@/lib/request";
import { captureError } from "@/lib/monitor";
import { userKey } from "@/lib/fount/store";
import { confirmOk, deleteBlockedByPlan, EXPORT_COLLECTIONS, shapeExport, TOP_LEVEL_BY_FIELD, TOP_LEVEL_BY_ID, type Doc, type PlanLike } from "@/lib/account-core";

export const runtime = "nodejs";
export const maxDuration = 60;

const db = () => getAdminDb();
const userDoc = (uid: string) => getAdminDb().collection("users").doc(uid);
const PER_COLLECTION = 400; // newest first; shapeExport trims further to fit one response

/** "Download my data": your chats, projects, routines, memories and activity as one JSON file. Secrets are never included. */
async function exportAll(uid: string) {
  const collections: Record<string, Doc[]> = {};
  for (const name of EXPORT_COLLECTIONS) {
    try {
      const col = userDoc(uid).collection(name);
      // newest first when the documents have a timestamp; a collection without one is read as it comes
      let snap;
      try { snap = await col.orderBy("updatedAt", "desc").limit(PER_COLLECTION).get(); } catch { snap = await col.limit(PER_COLLECTION).get(); }
      collections[name] = snap.docs.map((d) => ({ id: d.id, data: d.data() }));
    } catch { collections[name] = []; }
  }
  const plan = (await userDoc(uid).collection("billing").doc("plan").get().catch(() => null))?.data() as Record<string, unknown> | undefined;
  if (plan) collections.billing = [{ id: "plan", data: { plan: plan.plan, status: plan.status, cancelled: plan.cancelled, renewsAt: plan.renewsAt } }];
  const profile = (await userDoc(uid).get().catch(() => null))?.data();
  if (profile) collections.profile = [{ id: "profile", data: profile }];
  return shapeExport(uid, collections);
}

/** Removes the user's data everywhere we know it is kept, then the login itself. Reports what it removed. */
async function deleteAll(uid: string) {
  const db = getAdminDb();
  const removed: Record<string, number> = {};
  for (const name of TOP_LEVEL_BY_ID) {
    try { const ref = db.collection(name).doc(uid); if ((await ref.get()).exists) { await ref.delete(); removed[name] = 1; } } catch { /* collection not used in this deployment */ }
  }
  for (const name of TOP_LEVEL_BY_FIELD) {
    try {
      const snap = await db.collection(name).where("uid", "==", uid).limit(500).get();
      if (!snap.empty) { await Promise.all(snap.docs.map((d) => d.ref.delete())); removed[name] = snap.size; }
    } catch { /* a collection without that field or index is skipped, not an error */ }
  }
  // FOUNT (opt-in learning): scrubbed episodes are tied to a one-way key, never to the uid
  for (const name of ["fount_episodes", "fount_personal"]) {
    try {
      const snap = await db.collection(name).where("uk", "==", userKey(uid)).limit(500).get();
      if (!snap.empty) { await Promise.all(snap.docs.map((d) => d.ref.delete())); removed[name] = snap.size; }
    } catch { /* not used in this deployment */ }
  }
  // everything under users/{uid}: chats, vault (encrypted values), vPassword entries, runs, billing usage ...
  await db.recursiveDelete(userDoc(uid));
  removed["users"] = 1;
  await getAdminAuth().deleteUser(uid).catch((e: unknown) => {
    // the data is gone; a missing login is fine, anything else is reported
    if (!/user-not-found/i.test(String((e as { code?: string })?.code ?? e))) throw e;
  });
  return removed;
}

export async function POST(req: Request) {
  try {
    const body = await readBody(req, { maxBytes: 4 * 1024 });
    const uid = String(body.uid);
    const action = String(body.action || "");

    if (action === "export") {
      const file = await exportAll(uid);
      return new NextResponse(JSON.stringify(file, null, 2), {
        status: 200,
        headers: { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": 'attachment; filename="agenticvenus-export.json"', "Cache-Control": "no-store" },
      });
    }

    if (action === "delete") {
      if (!confirmOk(body.confirm)) throw new RequestError("Type DELETE MY ACCOUNT exactly to confirm.", 400);
      const plan = (await userDoc(uid).collection("billing").doc("plan").get()).data() as PlanLike;
      const blocked = deleteBlockedByPlan(plan);
      if (blocked) throw new RequestError(blocked, 409);
      const removed = await deleteAll(uid);
      // one line kept for accounting and abuse handling: no name, no e-mail, no content (see the Privacy Policy)
      await db().collection("billingEvents").add({ at: Date.now(), kind: "account_deleted", uid }).catch(() => undefined);
      return NextResponse.json({ ok: true, removed });
    }

    throw new RequestError("Unknown action.", 400);
  } catch (e) {
    if (!(e instanceof RequestError)) await captureError(e, { where: "api/account", level: "error" });
    return NextResponse.json({ error: e instanceof Error ? e.message : "Something went wrong." }, { status: requestStatus(e) });
  }
}

