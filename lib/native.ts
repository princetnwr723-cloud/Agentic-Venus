"use client";
// Runs only inside the Android app (Capacitor). On the website every function here quietly does nothing.
import { Capacitor, registerPlugin } from "@capacitor/core";
import { signInWithCustomToken } from "firebase/auth";
import { auth } from "@/lib/firebase";

export const APP_SCHEME = "agenticvenus";
const FCM_KEY = "venus_fcm_token";
const PKCE_KEY = "venus_pkce_verifier";
const RUNNER_ID = 4101;
const RUNNER_MAX_MS = 5 * 3600_000; // Android 15 stops "data sync" services after about 6 hours

type Handle = { remove: () => Promise<void> };
type PushPlugin = {
  checkPermissions(): Promise<{ receive: string }>;
  requestPermissions(): Promise<{ receive: string }>;
  register(): Promise<void>;
  createChannel(c: { id: string; name: string; description?: string; importance: number; visibility?: number; vibration?: boolean }): Promise<void>;
  addListener(ev: "registration", cb: (t: { value: string }) => void): Promise<Handle>;
  addListener(ev: "registrationError", cb: (e: { error: string }) => void): Promise<Handle>;
  addListener(ev: "pushNotificationActionPerformed", cb: (a: { notification: { data?: Record<string, unknown> } }) => void): Promise<Handle>;
};
type BrowserPlugin = { open(o: { url: string }): Promise<void> };
type AppPlugin = {
  addListener(ev: "appUrlOpen", cb: (e: { url: string }) => void): Promise<Handle>;
  getLaunchUrl(): Promise<{ url: string } | undefined>;
};
type FgOptions = { id: number; title: string; body: string; smallIcon: string; notificationChannelId?: string };
type FgPlugin = {
  checkPermissions(): Promise<{ display: string }>;
  requestPermissions(): Promise<{ display: string }>;
  createNotificationChannel(c: { id: string; name: string; description?: string; importance: number }): Promise<void>;
  startForegroundService(o: FgOptions): Promise<void>;
  updateForegroundService(o: FgOptions): Promise<void>;
  stopForegroundService(): Promise<void>;
};

let cache: { push: PushPlugin; browser: BrowserPlugin; app: AppPlugin; fg: FgPlugin } | null = null;
function P() {
  if (!cache) {
    cache = {
      push: registerPlugin<PushPlugin>("PushNotifications"),
      browser: registerPlugin<BrowserPlugin>("Browser"),
      app: registerPlugin<AppPlugin>("App"),
      fg: registerPlugin<FgPlugin>("ForegroundService"),
    };
  }
  return cache;
}

export function isNativeApp(): boolean {
  return typeof window !== "undefined" && Capacitor.isNativePlatform();
}

// ---------------- Google login (Chrome Custom Tab + PKCE) ----------------
function b64url(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Opens the login page in Chrome. It comes back to the app through agenticvenus://auth?code=... */
export async function nativeGoogleLogin(): Promise<void> {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
  localStorage.setItem(PKCE_KEY, verifier);
  await P().browser.open({ url: `${window.location.origin}/native-login?challenge=${challenge}` });
}

async function handleUrl(url: string) {
  if (!url.startsWith(`${APP_SCHEME}://auth`)) return;
  const code = new URL(url).searchParams.get("code");
  const verifier = localStorage.getItem(PKCE_KEY);
  if (!code || !verifier) return;
  const r = await fetch("/api/native-auth/redeem", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code, verifier }),
  });
  const j = (await r.json().catch(() => ({}))) as { token?: string; error?: string };
  if (!r.ok || !j.token) { window.alert(j.error || "Login nahi ho paya, dobara try karo."); return; }
  localStorage.removeItem(PKCE_KEY);
  await signInWithCustomToken(auth, j.token);
}

/** Listens for the login link (also when the app was closed and the link started it). */
export async function initNativeLinks(): Promise<() => void> {
  if (!isNativeApp()) return () => {};
  const seen = new Set<string>();
  const run = (url: string) => {
    if (seen.has(url)) return;
    seen.add(url);
    void handleUrl(url).catch(() => {});
  };
  const h = await P().app.addListener("appUrlOpen", (e) => run(e.url));
  const launch = await P().app.getLaunchUrl().catch(() => undefined);
  if (launch?.url) run(launch.url);
  return () => { void h.remove(); };
}

// ---------------- push ----------------
let pushOn = false;

async function saveToken(token: string) {
  localStorage.setItem(FCM_KEY, token);
  const m = /Android [^;)]+;\s*([^;)]+)/.exec(navigator.userAgent);
  await fetch("/api/devices", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, name: m?.[1]?.trim() || "Android phone", appVersion: "1" }),
  }).catch(() => {});
}

/** Asks for the notification permission, creates the alert channel and saves this phone's token on the server. */
export async function enablePush(): Promise<boolean> {
  if (!isNativeApp()) return false;
  const { push } = P();
  try {
    if (pushOn) {
      // same app session, maybe another account signed in: attach this phone to the account again
      const t = localStorage.getItem(FCM_KEY);
      if (t) await saveToken(t); else await push.register();
      return true;
    }
    await push.createChannel({ id: "venus_alerts", name: "Agent alerts", description: "Task finished, approvals and questions", importance: 5, visibility: 1, vibration: true });
    let perm = await push.checkPermissions();
    if (perm.receive === "prompt" || perm.receive === "prompt-with-rationale") perm = await push.requestPermissions();
    if (perm.receive !== "granted") return false;
    await push.addListener("registration", (t) => { void saveToken(t.value); });
    await push.addListener("registrationError", () => {});
    await push.addListener("pushNotificationActionPerformed", (a) => {
      const url = a.notification.data?.url;
      if (typeof url === "string" && url.startsWith("/")) window.location.assign(url);
    });
    await push.register();
    pushOn = true;
    return true;
  } catch {
    return false;
  }
}

/** Called right before sign-out: this phone stops getting this account's alerts. */
export async function disableThisDevice(): Promise<void> {
  const token = localStorage.getItem(FCM_KEY);
  if (!token) return;
  await fetch("/api/devices", {
    method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }),
  }).catch(() => {});
}

// ---------------- background runner (foreground service) ----------------
type Status = { jobs: Array<{ task: string; startedAt: number }>; needsYou: number };

/** While a computer task runs, a steady "Venus kaam kar raha hai" notification keeps Android from killing the app and shows the state. */
export function startRunnerLoop(): () => void {
  if (!isNativeApp()) return () => {};
  const { fg } = P();
  let stopped = false, on = false, paused = false, denied = false, ready = false, startedAt = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  async function allowed(): Promise<boolean> {
    if (ready) return true;
    if (denied) return false;
    try {
      let p = await fg.checkPermissions();
      if (p.display !== "granted") p = await fg.requestPermissions();
      if (p.display !== "granted") { denied = true; return false; }
      await fg.createNotificationChannel({ id: "venus_runner", name: "Venus runner", description: "Shows while a task runs in the background", importance: 2 });
      ready = true;
      return true;
    } catch {
      denied = true;
      return false;
    }
  }

  async function show(title: string, body: string) {
    const o: FgOptions = { id: RUNNER_ID, title, body, smallIcon: "ic_stat_venus", notificationChannelId: "venus_runner" };
    if (!on) { await fg.startForegroundService(o); on = true; startedAt = Date.now(); }
    else await fg.updateForegroundService(o);
  }
  async function hide() {
    if (!on) return;
    on = false;
    await fg.stopForegroundService().catch(() => {});
  }

  async function tick() {
    let next = 45_000;
    try {
      if (!paused && (document.visibilityState === "visible" || on)) {
        const r = await fetch("/api/device/status", { cache: "no-store" });
        if (r.ok) {
          const s = (await r.json()) as Status;
          if (s.jobs.length) {
            if (on && Date.now() - startedAt > RUNNER_MAX_MS) { await hide(); paused = true; }
            else if (await allowed()) {
              const what = s.jobs.length > 1 ? `${s.jobs.length} kaam chal rahe hain` : s.jobs[0].task;
              await show("Venus kaam kar raha hai", what + (s.needsYou ? ` • ⏸️ ${s.needsYou} approval baaki` : ""));
              next = 20_000;
            }
          } else {
            await hide();
          }
        }
      }
    } catch { /* network blip: try again soon */ }
    if (!stopped) timer = setTimeout(() => { void tick(); }, next);
  }

  const onVisible = () => { if (document.visibilityState === "visible") paused = false; };
  document.addEventListener("visibilitychange", onVisible);
  void tick();

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    document.removeEventListener("visibilitychange", onVisible);
    void hide();
  };
}