"use client";
// The phone's own alarm clock. Android: exact alarms that wake the phone and start your routines on time, even when the app is closed.
// iPhone: iOS does not allow that for any app; the cloud scheduler runs the routine at the exact time and the phone gets a notification.
import { Capacitor, registerPlugin } from "@capacitor/core";
import { auth } from "@/lib/firebase";

export type SchedulerLog = { t: number; name: string; status: string; lateMs: number };
export type SchedulerStatus = {
  platform: "android" | "ios" | "web";
  configured: boolean;
  authLost?: boolean;
  exactAlarm: boolean;
  batteryUnrestricted: boolean;
  notifications: boolean;
  needsAutostart: boolean;
  manufacturer?: string;
  model?: string;
  sdk?: number;
  armed: number;
  nextAt: number;
  lastSync: number;
  log: SchedulerLog[];
};

type Api = {
  configure(o: { appUrl: string; apiKey: string; refreshToken: string }): Promise<{ armed: number }>;
  sync(): Promise<{ armed: number }>;
  status(): Promise<Omit<SchedulerStatus, "log"> & { log?: SchedulerLog[] }>;
  test(o: { seconds: number }): Promise<void>;
  clear(): Promise<void>;
  requestExactAlarm(): Promise<void>;
  requestBatteryUnrestricted(): Promise<void>;
  openAutostart(): Promise<{ opened: boolean }>;
  openAppSettings(): Promise<void>;
};

let api: Api | null = null;
const plugin = () => (api ??= registerPlugin<Api>("VenusScheduler"));
const isAndroid = () => { try { return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android"; } catch { return false; } };

/** Gives the native side the login (so it can work without the WebView) and arms the alarms. Safe to call again and again. */
export async function setupScheduler(): Promise<number> {
  if (!isAndroid()) return 0;
  const user = auth.currentUser;
  const apiKey = auth.app.options.apiKey;
  if (!user || !apiKey) return 0;
  const r = await plugin().configure({ appUrl: location.origin, apiKey, refreshToken: user.refreshToken });
  return r.armed;
}

/** Asks the server for the newest schedule times and re-arms the alarms (after a routine was created, changed, paused or deleted). */
export async function resyncScheduler(): Promise<number> {
  if (!isAndroid()) return 0;
  try { return (await plugin().sync()).armed; } catch { return 0; }
}

export async function schedulerStatus(): Promise<SchedulerStatus> {
  if (!isAndroid()) {
    const ios = (() => { try { return Capacitor.getPlatform() === "ios"; } catch { return false; } })();
    return { platform: ios ? "ios" : "web", configured: false, exactAlarm: true, batteryUnrestricted: true, notifications: true, needsAutostart: false, armed: 0, nextAt: 0, lastSync: 0, log: [] };
  }
  const s = await plugin().status();
  return { ...s, log: s.log ?? [] };
}

export const testAlarm = (seconds = 15) => (isAndroid() ? plugin().test({ seconds }) : Promise.resolve());
export const askExactAlarm = () => (isAndroid() ? plugin().requestExactAlarm() : Promise.resolve());
export const askBatteryUnrestricted = () => (isAndroid() ? plugin().requestBatteryUnrestricted() : Promise.resolve());
export const openAutostart = () => (isAndroid() ? plugin().openAutostart() : Promise.resolve({ opened: false }));
export const openAppSettings = () => (isAndroid() ? plugin().openAppSettings() : Promise.resolve());
export const clearScheduler = () => (isAndroid() ? plugin().clear().catch(() => undefined) : Promise.resolve());

/** 0-100 and the things still to switch on. */
export function reliability(s: SchedulerStatus): { score: number; todo: Array<"exact" | "battery" | "autostart" | "notifications" | "login"> } {
  if (s.platform !== "android") return { score: 100, todo: [] };
  const todo: Array<"exact" | "battery" | "autostart" | "notifications" | "login"> = [];
  if (!s.configured || s.authLost) todo.push("login");
  if (!s.exactAlarm) todo.push("exact");
  if (!s.batteryUnrestricted) todo.push("battery");
  if (!s.notifications) todo.push("notifications");
  if (s.needsAutostart) todo.push("autostart"); // cannot be detected, so it always stays as a hint on those phones
  const weights = { login: 40, exact: 30, battery: 20, notifications: 5, autostart: 5 } as const;
  return { score: Math.max(0, 100 - todo.reduce((a, k) => a + weights[k], 0)), todo };
}
