"use client";
// The phone computer (Android app only): a small Linux with Chrome and a terminal that runs on this phone and does the website's computer jobs.
// On the website, on iPhone and in an old APK every function here quietly does nothing, exactly like lib/native-scheduler.ts.
import { Capacitor, registerPlugin } from "@capacitor/core";
import type { ComputerStatus } from "@/lib/native-computer-core";

export * from "@/lib/native-computer-core";

type Handle = { remove: () => Promise<void> };
type Api = {
  status(): Promise<ComputerStatus>;
  setup(o: { wifiOnly: boolean }): Promise<ComputerStatus>;
  autoSetup(): Promise<ComputerStatus>;
  cancelSetup(): Promise<ComputerStatus>;
  start(): Promise<ComputerStatus>;
  stop(): Promise<ComputerStatus>;
  reset(): Promise<ComputerStatus>;
  setLimits(o: { ramMB?: number; diskGB?: number; idleMinutes?: number }): Promise<ComputerStatus>;
  setEnabled(o: { enabled: boolean }): Promise<ComputerStatus>;
  localKey(): Promise<{ key: string }>;
  wake(): Promise<void>;
  clear(): Promise<void>;
  addListener(ev: "state", cb: (s: ComputerStatus) => void): Promise<Handle>;
};

let api: Api | null = null;
const plugin = () => (api ??= registerPlugin<Api>("VenusLocal"));
const isAndroid = () => { try { return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android"; } catch { return false; } };

const none = (): ComputerStatus => ({
  state: "unsupported", detail: "", percent: -1, supported: false, reason: "", installed: false, running: false, enabled: false, busy: 0,
  ramLimitMB: 0, diskLimitGB: 0, usedRamMB: 0, peakRamMB: 0, usedDiskMB: 0, diskFull: false, ramWarned: false, idleMinutes: 3,
  phoneRamMB: 0, phoneFreeRamMB: 0, freeStorageMB: 0, metered: false, deviceId: "", model: "",
  plan: { ramRecommendedMB: 0, ramMinMB: 0, ramMaxMB: 0, diskRecommendedGB: 0, diskMinGB: 0, diskMaxGB: 0, ramOptionsMB: [], diskOptionsGB: [] },
  log: "", unavailable: true,
});

/** An old APK has no "VenusLocal" plugin: say so instead of failing. */
async function call<T>(f: () => Promise<T>, fallback: T): Promise<T> {
  if (!isAndroid()) return fallback;
  try { return await f(); } catch { return fallback; }
}

export const computerStatus = () => call(() => plugin().status(), none());
export const computerSetup = (wifiOnly = false) => call(() => plugin().setup({ wifiOnly }), none());
export const computerCancelSetup = () => call(() => plugin().cancelSetup(), none());
export const computerStart = () => call(() => plugin().start(), none());
export const computerStop = () => call(() => plugin().stop(), none());
export const computerReset = () => call(() => plugin().reset(), none());
export const computerSetLimits = (o: { ramMB?: number; diskGB?: number; idleMinutes?: number }) => call(() => plugin().setLimits(o), none());
export const computerSetEnabled = (enabled: boolean) => call(() => plugin().setEnabled({ enabled }), none());

/** Once after sign-in: installs the computer by itself (on Wi-Fi only). */
export const autoSetupComputer = () => call(() => plugin().autoSetup(), none());
/** A task is running on the website: keep the phone online for the next minute and a half. */
export const wakeComputer = () => call(() => plugin().wake(), undefined);
/** Sign-out: end the computer and forget this phone's id. */
export const clearComputer = () => call(() => plugin().clear(), undefined);

/** "venus-local:<id>" when this phone's computer should be the website's computer, otherwise null. */
export async function phoneComputerKey(): Promise<string | null> {
  const r = await call(() => plugin().localKey(), { key: "" });
  return r.key && r.key.startsWith("venus-local:") ? r.key : null;
}

/** Tells you every time the computer changes (setup progress, started, stopped, limits). Returns a function that stops listening. */
export function subscribeComputer(cb: (s: ComputerStatus) => void): () => void {
  if (!isAndroid()) return () => {};
  let off: Handle | null = null;
  let dead = false;
  plugin().addListener("state", cb).then((h) => { if (dead) void h.remove(); else off = h; }).catch(() => undefined);
  return () => { dead = true; if (off) void off.remove(); };
}
