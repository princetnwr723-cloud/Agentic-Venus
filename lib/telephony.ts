// Server-only. ONE phone layer for every company that speaks TwiML / LaML: Twilio, SignalWire and any compatible provider.
// The rest of the app never talks to a phone company directly: it uses the helpers below.
import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase-admin";
import { audit } from "@/lib/audit";
import { signChannelToken } from "@/lib/channels";
import { assertPublicHost, assertPublicUrl } from "@/lib/tools/net";
import { appBaseUrl, getResolvedVoiceSecrets, getVoiceSettings, saveVoiceSettings, signVoiceToken, type VoiceSettings } from "@/lib/voice-server";

export type Provider = "twilio" | "signalwire" | "custom";
export const PROVIDER_IDS: Provider[] = ["twilio", "signalwire", "custom"];

/** Fields stored next to the normal voice settings (account-wide: they work in EVERY chat). */
export type Extra = {
  telephony?: { provider: Provider; apiBase: string };
  /** chatId -> the phone number that belongs to that agent */
  agentNumbers?: Record<string, string>;
  /** Calls that come IN are only treated as the owner when this is on (caller ID can be faked). */
  trustCallerId?: boolean;
  /** The owner has answered the "which voice?" question once. */
  voiceChosen?: boolean;
};
export type TeleSettings = VoiceSettings & Extra;

const TWILIO_BASE = "https://api.twilio.com/2010-04-01";
const db = () => getAdminDb();
const userRef = (uid: string) => db().collection("users").doc(uid);
export const digits = (n?: string) => String(n ?? "").replace(/\D/g, "");

export const getTele = async (uid: string): Promise<TeleSettings> => (await getVoiceSettings(uid)) as TeleSettings;
export async function patchTele(uid: string, patch: Extra) {
  await userRef(uid).set({ voiceSettings: patch }, { merge: true });
}
const baseOf = (s: TeleSettings) => s.telephony?.apiBase || TWILIO_BASE;
export const providerOf = (s: TeleSettings): Provider => s.telephony?.provider ?? "twilio";

/** The REST address of the account API for a provider. */
export async function resolveApiBase(provider: Provider, space?: string, apiBase?: string): Promise<string> {
  if (provider === "twilio") return TWILIO_BASE;
  if (provider === "signalwire") {
    const host = String(space || "").trim().replace(/^https?:\/\//i, "").replace(/\/.*$/, "");
    if (!/^[a-z0-9-]+(\.signalwire\.com)?$/i.test(host)) throw new Error("SignalWire ka Space name do, jaise myspace ya myspace.signalwire.com.");
    return `https://${host.includes(".") ? host : host + ".signalwire.com"}/api/laml/2010-04-01`;
  }
  const u = assertPublicUrl(String(apiBase || "").trim());
  if (u.protocol !== "https:") throw new Error("API base HTTPS honi chahiye.");
  await assertPublicHost(u.hostname);
  return u.origin + u.pathname.replace(/\/+$/, "");
}

type Creds = { sid: string; token: string };
async function creds(uid: string): Promise<Creds> {
  const s = await getResolvedVoiceSecrets(uid);
  if (!s.twilioSid || !s.twilioToken) throw new Error("Calling abhi connect nahi hai. Chat me bolo: \"calling setup karo\".");
  return { sid: s.twilioSid, token: s.twilioToken };
}

async function rest(base: string, c: Creds, path: string, o: { form?: URLSearchParams; method?: string; timeout?: number } = {}) {
  const r = await fetch(`${base}/Accounts/${encodeURIComponent(c.sid)}${path}`, {
    method: o.method ?? (o.form ? "POST" : "GET"),
    signal: AbortSignal.timeout(o.timeout ?? 12000),
    headers: { Authorization: "Basic " + Buffer.from(`${c.sid}:${c.token}`).toString("base64"), ...(o.form ? { "Content-Type": "application/x-www-form-urlencoded" } : {}) },
    body: o.form ? new URLSearchParams(o.form) : undefined,
  });
  const j = (await r.json().catch(() => ({}))) as any;
  return { ok: r.ok, status: r.status, j };
}

/** Used by voice-calls.ts: any call-control request (create a call, update it, hang up) goes through the saved provider. */
export async function telRest(uid: string, path: string, o: { form?: URLSearchParams; method?: string; timeout?: number } = {}) {
  const [s, c] = await Promise.all([getTele(uid), creds(uid)]);
  return rest(baseOf(s), c, path, o);
}

export const fromNumberFor = (s: TeleSettings, chatId?: string): string => (chatId && s.agentNumbers?.[chatId]) || s.fromNumber || "";
export function chatForNumber(s: TeleSettings, to?: string): string {
  const d = digits(to);
  if (!d) return "";
  return Object.entries(s.agentNumbers ?? {}).find(([, n]) => digits(n) === d)?.[0] ?? "";
}

export async function outboundToday(uid: string): Promise<number> {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const snap = await userRef(uid).collection("voiceCalls").where("createdAt", ">=", today.getTime()).get();
  return snap.docs.filter((d) => d.data().direction === "outbound").length;
}

export const inboundUrl = (uid: string, req?: Request) =>
  `${appBaseUrl(req)}/api/voice/twiml?token=${encodeURIComponent(signVoiceToken({ uid, purpose: "inbound", exp: 4102444800000 }))}`;

type Num = { sid: string; phone_number: string; capabilities?: { voice?: boolean } };
async function numbersOf(base: string, c: Creds): Promise<Num[]> {
  const r = await rest(base, c, "/IncomingPhoneNumbers.json?PageSize=50");
  return ((r.j?.incoming_phone_numbers ?? []) as Num[]).filter((n) => n.capabilities?.voice !== false);
}

/** Points the number at this app, so a person who phones it reaches the agent. */
async function hookNumber(uid: string, base: string, c: Creds, numberSid: string, provider: Provider, req?: Request): Promise<boolean> {
  const form = new URLSearchParams({ VoiceUrl: inboundUrl(uid, req), VoiceMethod: "POST" });
  if (provider === "twilio") {
    form.set("SmsUrl", `${appBaseUrl(req)}/api/channels/twilio?token=${encodeURIComponent(signChannelToken(uid, "twilio"))}`);
    form.set("SmsMethod", "POST");
  }
  return (await rest(base, c, `/IncomingPhoneNumbers/${encodeURIComponent(numberSid)}.json`, { form })).ok;
}

// ---------------- connect ----------------
export async function connectProvider(
  uid: string,
  p: { provider: string; sid: string; token: string; space?: string; apiBase?: string },
  req?: Request
): Promise<{ webhook: boolean; number: string | null }> {
  const provider = (PROVIDER_IDS.includes(p.provider as Provider) ? p.provider : "twilio") as Provider;
  const sid = p.sid.trim(), token = p.token.trim();
  if (!sid || !token) throw new Error("Account SID aur Auth Token dono chahiye.");
  if (provider === "twilio" && !/^AC[a-f0-9]{32}$/i.test(sid)) throw new Error("Twilio Account SID 'AC' se shuru hoti hai (34 characters).");
  const apiBase = await resolveApiBase(provider, p.space, p.apiBase);
  const c: Creds = { sid, token };
  const acct = await rest(apiBase, c, ".json");
  if (!acct.ok) throw new Error(acct.status === 401 ? "Provider ne ye SID/token reject kiya. Dubara copy karo." : String(acct.j?.message || `Provider error (HTTP ${acct.status}).`));

  await saveVoiceSettings(uid, { twilioSid: sid, twilioToken: token, inboundEnabled: true, outboundEnabled: true, approvalRequired: false });
  await patchTele(uid, { telephony: { provider, apiBase } });

  const list = await numbersOf(apiBase, c);
  const current = (await getTele(uid)).fromNumber;
  const pick = list.find((n) => n.phone_number === current) ?? list[0];
  let webhook = false;
  if (pick) {
    await saveVoiceSettings(uid, { fromNumber: pick.phone_number });
    webhook = await hookNumber(uid, apiBase, c, pick.sid, provider, req).catch(() => false);
  }
  await audit(uid, { kind: "voice_provider_connected", text: `${provider}; number ${pick?.phone_number ?? "none"}` });
  return { webhook, number: pick?.phone_number ?? null };
}

export async function disconnectProvider(uid: string) {
  const { clearVoiceSecret } = await import("@/lib/voice-server");
  await clearVoiceSecret(uid, "twilioSid");
  await clearVoiceSecret(uid, "twilioToken");
  await saveVoiceSettings(uid, { inboundEnabled: false, outboundEnabled: false });
  await audit(uid, { kind: "voice_provider_disconnected", text: "Calling disconnected" });
}

// ---------------- account details and limits ----------------
export type Account = {
  provider: Provider; name: string; type: string; status: string; balance: string; currency: string;
  numbers: Array<{ number: string; sid: string }>; verified: string[]; callsToday: number; spendToday: string;
};

export async function accountInfo(uid: string): Promise<Account> {
  const [s, c] = await Promise.all([getTele(uid), creds(uid)]);
  const base = baseOf(s);
  const [acct, bal, nums, ids, use] = await Promise.allSettled([
    rest(base, c, ".json"),
    rest(base, c, "/Balance.json"),
    numbersOf(base, c),
    rest(base, c, "/OutgoingCallerIds.json?PageSize=50"),
    rest(base, c, "/Usage/Records/Today.json?Category=calls"),
  ]);
  const ok = (r: PromiseSettledResult<{ ok: boolean; j: any }>) => (r.status === "fulfilled" && r.value.ok ? r.value.j : null);
  const a = ok(acct), b = ok(bal), i = ok(ids), u = ok(use);
  const rec = u?.usage_records?.[0];
  return {
    provider: providerOf(s), name: String(a?.friendly_name ?? ""), type: String(a?.type ?? ""), status: String(a?.status ?? ""),
    balance: b?.balance !== undefined ? String(b.balance) : "", currency: String(b?.currency ?? ""),
    numbers: (nums.status === "fulfilled" ? nums.value : []).map((n) => ({ number: n.phone_number, sid: n.sid })),
    verified: ((i?.outgoing_caller_ids ?? []) as Array<{ phone_number: string }>).map((x) => x.phone_number),
    callsToday: Number(rec?.count ?? 0),
    spendToday: rec?.price !== undefined ? `${rec.price} ${String(rec.price_unit ?? "").toUpperCase()}`.trim() : "",
  };
}

async function agentNames(uid: string, map: Record<string, string>): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const id of Object.keys(map).slice(0, 20)) {
    try { out[id] = String((await userRef(uid).collection("chats").doc(id).get()).data()?.agentName ?? "agent"); } catch { out[id] = "agent"; }
  }
  return out;
}

/** The "account card": details, balance, limits and numbers, in the words the agent shows in chat. */
export async function describeAccount(uid: string): Promise<string> {
  const s = await getTele(uid);
  const a = await accountInfo(uid);
  const limit = s.dailyLimit ?? 50;
  const used = await outboundToday(uid);
  const names = await agentNames(uid, s.agentNumbers ?? {});
  const owns = a.numbers.map((n) => {
    const hit = Object.entries(s.agentNumbers ?? {}).find(([, v]) => digits(v) === digits(n.number));
    return `${n.number}${hit ? ` → ${names[hit[0]] ?? "agent"}` : digits(n.number) === digits(s.fromNumber) ? " (default)" : ""}`;
  });
  const lines = [
    `📞 Provider: ${a.provider}${a.name ? ` · ${a.name}` : ""}`,
    `Account: ${a.type || "?"}${a.status ? ` · ${a.status}` : ""}`,
    a.balance ? `Balance: ${a.balance} ${a.currency}`.trim() : "Balance: provider se nahi mila (provider ke dashboard me dekho)",
    `Provider ke hisab se aaj ki calls: ${a.callsToday}${a.spendToday ? ` · kharcha ${a.spendToday}` : ""}`,
    `Venus daily outbound limit: ${used}/${limit} (aaj)`,
    `Numbers: ${owns.length ? owns.join(", ") : "koi nahi (chat me bolo: ek number kharido)"}`,
  ];
  if (a.type.toLowerCase() === "trial") {
    lines.push(`⚠️ Trial account: sirf verified numbers pe call jaati hai${a.verified.length ? ` (${a.verified.join(", ")})` : ""}, aur call ke shuru me trial message bajta hai. Upgrade karne par ye limits hat jaati hain.`);
  }
  return lines.join("\n");
}

// ---------------- one number per agent ----------------
export async function listNumbers(uid: string): Promise<Array<{ number: string; agent: string }>> {
  const [s, c] = await Promise.all([getTele(uid), creds(uid)]);
  const list = await numbersOf(baseOf(s), c);
  const names = await agentNames(uid, s.agentNumbers ?? {});
  return list.map((n) => {
    const hit = Object.entries(s.agentNumbers ?? {}).find(([, v]) => digits(v) === digits(n.phone_number));
    return { number: n.phone_number, agent: hit ? names[hit[0]] ?? "agent" : digits(n.phone_number) === digits(s.fromNumber) ? "(default)" : "" };
  });
}

/** Gives a number you already own to ONE agent (a chat). "default" takes the agent's own number away again. */
export async function assignNumber(uid: string, chatId: string, number: string, req?: Request): Promise<string | null> {
  if (!/^[A-Za-z0-9_-]{1,160}$/.test(chatId)) throw new Error("Chat nahi mili.");
  if (!number || number.toLowerCase() === "default") {
    await userRef(uid).update({ [`voiceSettings.agentNumbers.${chatId}`]: FieldValue.delete() });
    return null;
  }
  const [s, c] = await Promise.all([getTele(uid), creds(uid)]);
  const base = baseOf(s);
  const hit = (await numbersOf(base, c)).find((n) => digits(n.phone_number) === digits(number));
  if (!hit) throw new Error("Ye number tumhare provider account me nahi hai. Pehle \"mere numbers dikhao\" bolo.");
  const taken = Object.entries(s.agentNumbers ?? {}).find(([id, n]) => id !== chatId && digits(n) === digits(hit.phone_number));
  if (taken) throw new Error("Ye number kisi aur agent ko diya hua hai. Ek number ek hi agent ka ho sakta hai.");
  await hookNumber(uid, base, c, hit.sid, providerOf(s), req).catch(() => false);
  await patchTele(uid, { agentNumbers: { [chatId]: hit.phone_number } });
  return hit.phone_number;
}

/** Buys a new number from the provider (this spends money from the provider balance). */
export async function buyNumber(uid: string, o: { country: string; areaCode?: string }, req?: Request): Promise<string> {
  const [s, c] = await Promise.all([getTele(uid), creds(uid)]);
  const base = baseOf(s);
  const country = o.country.trim().toUpperCase().slice(0, 2);
  if (!/^[A-Z]{2}$/.test(country)) throw new Error("Country ka 2 letter code do, jaise IN, US, GB.");
  for (const kind of ["Local", "Mobile"]) {
    const qs = new URLSearchParams({ VoiceEnabled: "true", PageSize: "1" });
    if (o.areaCode) qs.set("AreaCode", o.areaCode.replace(/\D/g, "").slice(0, 6));
    const found = await rest(base, c, `/AvailablePhoneNumbers/${country}/${kind}.json?${qs}`);
    const cand = found.j?.available_phone_numbers?.[0]?.phone_number as string | undefined;
    if (!cand) continue;
    const form = new URLSearchParams({ PhoneNumber: cand, VoiceUrl: inboundUrl(uid, req), VoiceMethod: "POST" });
    const bought = await rest(base, c, "/IncomingPhoneNumbers.json", { form });
    if (!bought.ok) throw new Error(String(bought.j?.message || `Number kharidna fail hua (HTTP ${bought.status}). Kuch deshon me regulatory documents chahiye.`));
    await audit(uid, { kind: "voice_number_bought", text: `${bought.j.phone_number}` });
    return String(bought.j.phone_number);
  }
  throw new Error("Is desh/area me abhi koi number available nahi mila.");
}
