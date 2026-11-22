// Pure part of the kick relay (no server imports, so it is unit-tested).
const URL_OK = /^https?:\/\/[A-Za-z0-9.-]+(:\d{2,5})?\/api\/(venus\/run|agent)\/step$/;
const TOKEN_OK = /^[A-Za-z0-9._:~=-]{20,2000}$/;
const BODY_OK = /^\{"(pid|runId)":"[A-Za-z0-9_-]{1,64}"\}$/;

/** The shell line (pure, so it can be tested). Returns null when anything looks odd: nothing is ever built from unchecked text. */
export function relayCommand(url: string, token: string, body: string): string | null {
  if (!URL_OK.test(url) || !TOKEN_OK.test(token) || !BODY_OK.test(body)) return null;
  return `nohup curl -sS -m 90 -X POST -H 'Authorization: Bearer ${token}' -H 'Content-Type: application/json' -d '${body}' '${url}' >/dev/null 2>&1 &`;
}

type Slots = { computers?: Record<string, string>; pcSandboxId?: string | null };

/** The owner's computers that can send the call, best first. */
export function relayCandidates(user: { scoutSandboxId?: string } | undefined, chat: Slots | undefined): string[] {
  const ids = [user?.scoutSandboxId, chat?.computers?.studio, chat?.pcSandboxId, chat?.computers?.code];
  return Array.from(new Set(ids.filter((x): x is string => typeof x === "string" && x.length > 0)));
}
