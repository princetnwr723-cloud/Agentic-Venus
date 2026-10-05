import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { authFromRequest } from "@/lib/job-token";
import { getAdminDb } from "@/lib/firebase-admin";
import { audit } from "@/lib/audit";
import { isPlaceholder, vaultDelete, vaultPut } from "@/lib/vault";

export const runtime = "nodejs";
export const maxDuration = 60;

const fail = (m: string, s = 500) => NextResponse.json({ error: m }, { status: s });
const PROVIDER = /^[a-z0-9]{2,20}$/;
const SITE = /^[a-z0-9]{2,40}$/;
const CONN = /^conn\.[a-z0-9]{6,40}\.[a-z0-9_:]{1,40}$/;
const safeKind = (k: string) => k.toLowerCase().replace(/[^a-z0-9:]+/g, "_").slice(0, 40);

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const auth = await authFromRequest(req, body.uid);
    if (auth.job) return fail("Background jobs cannot touch the vault.", 403);
    const uid = auth.uid;
    const userRef = getAdminDb().collection("users").doc(uid);
    const name = String(body.name || "");

    switch (String(body.action || "")) {
      case "set": {
        const value = String(body.value ?? "").trim();
        if (!value || isPlaceholder(value)) return fail("Nothing to save.", 400);
        let ph: string;
        const prov = /^provider\.([a-z0-9]+)$/.exec(name);
        if (prov && PROVIDER.test(prov[1])) {
          ph = await vaultPut(uid, name, value, true);
          await userRef.set({ apiKeys: { [prov[1]]: ph } }, { merge: true });
        } else if (name === "e2b") {
          ph = await vaultPut(uid, name, value, true);
          await userRef.set({ e2bKey: ph }, { merge: true });
        } else if (CONN.test(name)) {
          ph = await vaultPut(uid, name, value, false); // the client stores this placeholder in the chat's connectors
        } else return fail("That secret name is not allowed.", 400);
        await audit(uid, { kind: "vault_set", text: name });
        return NextResponse.json({ placeholder: ph });
      }

      case "saveCredential": {
        const site = String(body.site || "");
        const email = String(body.email || "");
        const password = String(body.password || "");
        if (!SITE.test(site) || !email || !password) return fail("Bad login details.", 400);
        const e = await vaultPut(uid, `cred.${site}.e`, email);
        const p = await vaultPut(uid, `cred.${site}.p`, password);
        await userRef.set({ pcCredentials: { [site]: { email: e, password: p } } }, { merge: true });
        await audit(uid, { kind: "vault_login_saved", text: site });
        return NextResponse.json({ email: e, password: p });
      }

      case "delete": {
        const prov = /^provider\.([a-z0-9]+)$/.exec(name);
        if (prov && PROVIDER.test(prov[1])) await userRef.update({ [`apiKeys.${prov[1]}`]: FieldValue.delete() }).catch(() => {});
        else if (name === "e2b") await userRef.update({ e2bKey: FieldValue.delete() }).catch(() => {});
        else if (!CONN.test(name)) return fail("That secret name is not allowed.", 400);
        await vaultDelete(uid, name);
        await audit(uid, { kind: "vault_delete", text: name });
        return NextResponse.json({ ok: true });
      }

      // Idempotent: encrypts every plaintext secret that still sits in your documents.
      case "migrate": {
        let n = 0;
        const data = ((await userRef.get()).data() ?? {}) as {
          apiKeys?: Record<string, string>; e2bKey?: string; pcCredentials?: Record<string, { email: string; password: string }>;
        };
        const set: Record<string, unknown> = {};
        for (const [p, v] of Object.entries(data.apiKeys ?? {})) {
          if (typeof v === "string" && v.trim() && !isPlaceholder(v) && PROVIDER.test(p)) {
            set.apiKeys = { ...(set.apiKeys as object), [p]: await vaultPut(uid, `provider.${p}`, v.trim(), true) }; n++;
          }
        }
        if (typeof data.e2bKey === "string" && data.e2bKey.trim() && !isPlaceholder(data.e2bKey)) { set.e2bKey = await vaultPut(uid, "e2b", data.e2bKey.trim(), true); n++; }
        for (const [site, c] of Object.entries(data.pcCredentials ?? {})) {
          if (c && typeof c.email === "string" && typeof c.password === "string" && !(isPlaceholder(c.email) && isPlaceholder(c.password)) && SITE.test(site)) {
            const e = isPlaceholder(c.email) ? c.email : await vaultPut(uid, `cred.${site}.e`, c.email);
            const p = isPlaceholder(c.password) ? c.password : await vaultPut(uid, `cred.${site}.p`, c.password);
            set.pcCredentials = { ...(set.pcCredentials as object), [site]: { email: e, password: p } }; n++;
          }
        }
        if (Object.keys(set).length) await userRef.set(set, { merge: true });

        const chats = await userRef.collection("chats").get();
        for (const ch of chats.docs) {
          const conn = ((ch.data() as { connectors?: Record<string, string> }).connectors ?? {});
          const next: Record<string, string> = { ...conn };
          let changed = false;
          for (const [k, v] of Object.entries(conn)) {
            if (k.startsWith("auto:") || typeof v !== "string" || !v || isPlaceholder(v)) continue;
            next[k] = await vaultPut(uid, `conn.${ch.id.toLowerCase()}.${safeKind(k)}`, v, false);
            changed = true; n++;
          }
          if (changed) await ch.ref.update({ connectors: next });
        }
        await audit(uid, { kind: "vault_migrate", text: `${n} secrets encrypted` });
        return NextResponse.json({ migrated: n });
      }
      default:
        return fail("Unknown action.", 400);
    }
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Vault request failed.");
  }
}
