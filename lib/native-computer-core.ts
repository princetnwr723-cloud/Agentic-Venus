// Pure helpers for the "phone computer" screen. No imports on purpose: it is tested on its own (scripts/tests/mobile-computer.test.mjs).
// The phone computer is a small Linux with Chrome and a terminal that lives inside the Android app and does the website's computer jobs.

export type ComputerState =
  | "needs-setup" | "waiting-wifi" | "downloading" | "unpacking" | "installing"
  | "ready" | "starting" | "running" | "stopping" | "error" | "unsupported";

export type ComputerPlan = {
  ramRecommendedMB: number; ramMinMB: number; ramMaxMB: number;
  diskRecommendedGB: number; diskMinGB: number; diskMaxGB: number;
  ramOptionsMB: number[]; diskOptionsGB: number[];
};

export type ComputerStatus = {
  state: ComputerState;
  detail: string;
  percent: number; // 0-100, or -1 when unknown
  supported: boolean;
  reason: string;
  installed: boolean;
  running: boolean;
  enabled: boolean;
  busy: number;
  ramLimitMB: number; diskLimitGB: number;
  usedRamMB: number; peakRamMB: number; usedDiskMB: number;
  diskFull: boolean; ramWarned: boolean;
  idleMinutes: number;
  phoneRamMB: number; phoneFreeRamMB: number; freeStorageMB: number;
  metered: boolean;
  deviceId: string; model: string;
  plan: ComputerPlan;
  log: string;
  /** this app build has no phone computer inside (website, iPhone or an old APK) */
  unavailable?: boolean;
};

/** "1.5 GB" or "512 MB". */
export function sizeText(mb: number): string {
  if (!Number.isFinite(mb) || mb < 0) return "-";
  return mb >= 1024 ? `${(mb / 1024).toFixed(mb % 1024 === 0 ? 0 : 1)} GB` : `${Math.round(mb)} MB`;
}

export const SETUP_STATES: ComputerState[] = ["downloading", "unpacking", "installing"];
export const isSettingUp = (s: ComputerState) => SETUP_STATES.includes(s);

export function stateTitle(s: ComputerState): string {
  switch (s) {
    case "needs-setup": return "Not set up yet";
    case "waiting-wifi": return "Waiting for Wi-Fi";
    case "downloading": return "Downloading";
    case "unpacking": return "Unpacking";
    case "installing": return "Installing Chrome and terminal";
    case "ready": return "Ready (asleep, uses no RAM)";
    case "starting": return "Starting";
    case "running": return "Running";
    case "stopping": return "Stopping";
    case "error": return "Needs attention";
    case "unsupported": return "Not available on this phone";
    default: return "";
  }
}

export type Note = { kind: "ok" | "warn" | "bad"; text: string };

/** What to tell the person about the RAM they picked. */
export function ramNote(s: Pick<ComputerStatus, "plan" | "phoneRamMB">, pickedMB: number): Note {
  const rec = s.plan.ramRecommendedMB;
  if (pickedMB === rec) return { kind: "ok", text: `Recommended for this phone (${sizeText(s.phoneRamMB)} RAM).` };
  if (pickedMB < rec) return { kind: "warn", text: "Less than recommended: Chrome may close itself on heavy pages." };
  if (pickedMB >= s.plan.ramMaxMB && s.plan.ramMaxMB > rec) return { kind: "bad", text: "The most this phone can give. Android and your other apps (and a local model, if you run one) will have little left while a task runs." };
  return { kind: "warn", text: "More than recommended: faster for heavy sites, but less RAM stays for a local model and your other apps while a task runs." };
}

/** 0-100 for a progress bar; the part of the bar that is "used". */
export function pct(used: number, limit: number): number {
  if (!(limit > 0) || !(used >= 0)) return 0;
  return Math.max(0, Math.min(100, Math.round((used / limit) * 100)));
}

/** The phone computer can be the computer of the website only when it is installed and the person left it on. */
export function usable(s: Pick<ComputerStatus, "supported" | "installed" | "enabled">): boolean {
  return s.supported && s.installed && s.enabled;
}
