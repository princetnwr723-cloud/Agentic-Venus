// Account export and deletion rules. PURE (no imports), tested with node --test. The route (app/api/account/route.ts) does the database work.

/** Collections under users/{uid} that go into "download my data". Secrets are NOT among them: the vault holds only encrypted values and is never exported. */
export const EXPORT_COLLECTIONS = [
  "chats", "teams", "routines", "recipes", "codeProjects", "venusProjects", "agents", "brain", "skills", "runs",
  "vpass", "vplog", "vpay", "missions", "meetings", "decks", "pcJobs", "audit", "goals",
] as const;

/** The only thing the owner has to type to delete the account. */
export const DELETE_PHRASE = "DELETE MY ACCOUNT";
export const confirmOk = (text: unknown): boolean => String(text ?? "").trim() === DELETE_PHRASE;

export type Doc = { id: string; data: unknown };
export type ExportFile = {
  format: "agenticvenus-export-v1";
  exportedAt: string;
  uid: string;
  note: string;
  truncated: Record<string, { kept: number; total: number }>;
  data: Record<string, Doc[]>;
};

const NOTE = "Your data as stored by AgenticVenus. Passwords, card numbers, API keys and OAuth tokens are stored encrypted and are never exported. Card and login entries list only their label, site and hint.";
const bytes = (v: unknown): number => { try { return JSON.stringify(v).length; } catch { return 0; } };

/**
 * Builds the download. A serverless response can not be huge (about 4 MB on Vercel), so when the data is bigger the NEWEST documents
 * of each collection are kept first and the file says exactly how many were left out. Nothing is dropped silently.
 */
export function shapeExport(uid: string, collections: Record<string, Doc[]>, maxBytes = 3_500_000, now = Date.now()): ExportFile {
  const names = Object.keys(collections);
  const total = names.reduce((n, k) => n + collections[k].length, 0);
  const sizes = names.map((k) => collections[k].reduce((n, d) => n + bytes(d), 0));
  const sum = sizes.reduce((a, b) => a + b, 0);
  const out: ExportFile = { format: "agenticvenus-export-v1", exportedAt: new Date(now).toISOString(), uid, note: NOTE, truncated: {}, data: {} };
  if (sum <= maxBytes || total === 0) { for (const k of names) out.data[k] = collections[k]; return out; }
  // share the room between the collections in proportion to their size, so one huge collection can not push the small ones out
  names.forEach((k, i) => {
    const room = Math.floor(maxBytes * (sizes[i] / sum));
    const kept: Doc[] = [];
    let used = 0;
    for (const d of collections[k]) { // callers pass newest first
      const b = bytes(d);
      if (used + b > room && kept.length > 0) break;
      kept.push(d); used += b;
    }
    out.data[k] = kept;
    if (kept.length < collections[k].length) out.truncated[k] = { kept: kept.length, total: collections[k].length };
  });
  return out;
}

export type PlanLike = { plan?: string; status?: string; cancelled?: boolean; accessUntil?: number } | null | undefined;

/** A paid plan that is still running and not cancelled must be cancelled first, or the person would keep being billed for an account that is gone. */
export function deleteBlockedByPlan(p: PlanLike, now = Date.now()): string {
  if (!p || !p.plan || p.plan === "free") return "";
  const live = p.status === "active" && Number(p.accessUntil || 0) > now;
  if (live && !p.cancelled) return "You still have a paid plan that renews. Cancel the subscription first (Settings → Plans, or from your Gumroad receipt email), then delete the account.";
  return "";
}

/** Top-level collections that hold a document per user, keyed by the user id. */
export const TOP_LEVEL_BY_ID = ["fount_consent", "meetingUsers", "meetingAuto", "calendarUsers"] as const;
/** Top-level collections whose documents carry a `uid` field. */
export const TOP_LEVEL_BY_FIELD = ["billingIndex", "localDevices", "mcpTokens", "mcpCodes", "nativeAuth", "bizJobs", "teamRuns", "pushTokens"] as const;
