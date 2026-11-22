// Server only. Starts the next background step from OUTSIDE Vercel, so the platform's call chain starts again at 1.
// A short curl runs inside one of the owner's own E2B computers (the hidden research browser first, then the studio / PC computer).
// The job token it carries is bound to ONE run and expires, exactly like the one the server would send itself.
import { getAdminDb } from "@/lib/firebase-admin";
import { resolveValue } from "@/lib/vault";
import { connect, exec } from "@/lib/e2b-server";
import { relayCommand, relayCandidates } from "@/lib/kick-relay-core";

type Slots = { computers?: Record<string, string>; pcSandboxId?: string | null };
export { relayCommand, relayCandidates };

/** true = the call was started from the outside. false = nothing could send it (the scheduler picks the run up later). */
export async function relayKick(uid: string, chatId: string, url: string, token: string, body: string): Promise<boolean> {
  const cmd = relayCommand(url, token, body);
  if (!cmd) return false;
  try {
    const db = getAdminDb();
    const u = db.collection("users").doc(uid);
    const [user, chat] = await Promise.all([u.get(), chatId ? u.collection("chats").doc(chatId).get() : Promise.resolve(null)]);
    const raw = String((user.data() as { e2bKey?: string } | undefined)?.e2bKey ?? "");
    if (!raw) return false;
    const key = await resolveValue(uid, raw);
    for (const id of relayCandidates(user.data() as { scoutSandboxId?: string } | undefined, chat?.data() as Slots | undefined)) {
      try {
        const sb = await connect(key, id);
        const r = await exec(sb, cmd, 15_000);
        if (r.exitCode === 0) return true;
      } catch { /* try the next computer */ }
    }
  } catch { /* fall through */ }
  return false;
}
