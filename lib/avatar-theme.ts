// Builds a full colour theme for a mascot from ONE base colour (any hex).

export type Rgb = [number, number, number];

export function normHex(v: string): string | null {
  const m = /^#?([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/.exec(String(v ?? "").trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  return "#" + h.toLowerCase();
}

export function hexToRgb(hex: string): Rgb {
  const n = normHex(hex) ?? "#1e88f0";
  const v = parseInt(n.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

const toHex = (r: number, g: number, b: number) =>
  "#" +
  [r, g, b]
    .map((x) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, "0"))
    .join("");

export function mix(a: string, b: string, t: number): string {
  const [r1, g1, b1] = hexToRgb(a);
  const [r2, g2, b2] = hexToRgb(b);
  return toHex(r1 + (r2 - r1) * t, g1 + (g2 - g1) * t, b1 + (b2 - b1) * t);
}

export function lum(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

export type AvatarTheme = {
  hi: string;
  body: string;
  shade: string;
  arm: string;
  pupil: string;
  line: string;
  cavity: string;
  tongue: string;
  blush: string;
  blushLight: string;
  dark: boolean;
};

export function buildTheme(hexIn: string): AvatarTheme {
  const body = normHex(hexIn) ?? "#1e88f0";
  const dark = lum(body) < 0.28;
  return {
    hi: mix(body, "#ffffff", 0.12),
    body,
    shade: mix(body, "#000000", 0.18),
    arm: mix(body, "#ffffff", 0.06),
    pupil: mix(body, "#000000", 0.94),
    line: dark ? mix(body, "#ffffff", 0.82) : mix(body, "#000000", 0.72),
    cavity: mix(body, "#000000", 0.92),
    tongue: mix(body, "#000000", 0.38),
    blush: mix(body, "#000000", 0.13),
    blushLight: mix(body, "#ffffff", 0.24),
    dark,
  };
}
