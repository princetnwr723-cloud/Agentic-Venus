// CSV export for lead lists. No imports, so the browser card and the node tests use the same code.
export type LeadRow = {
  name: string; lat: number; lon: number; distM?: number; address?: string; phone?: string; website?: string; email?: string; about?: string;
};

const COLUMNS: Array<[string, (r: LeadRow) => string | number | undefined]> = [
  ["Name", (r) => r.name],
  ["Phone", (r) => r.phone],
  ["Email", (r) => r.email],
  ["Website", (r) => r.website],
  ["About", (r) => r.about],
  ["Address", (r) => r.address],
  ["Distance (m)", (r) => r.distM],
  ["Latitude", (r) => r.lat],
  ["Longitude", (r) => r.lon],
  ["Map link", (r) => `https://www.openstreetmap.org/?mlat=${r.lat}&mlon=${r.lon}#map=17/${r.lat}/${r.lon}`],
];

/** One cell: quoted, and made harmless if a spreadsheet would read it as a formula (text from the web is untrusted). */
export function csvCell(v: unknown): string {
  let t = String(v ?? "").replace(/\r?\n|\r/g, " ").trim();
  // a plain phone number may start with +; anything else starting with = + - @ gets a leading apostrophe
  if (/^[=+\-@\t]/.test(t) && !/^\+[\d\s()-]{5,}$/.test(t)) t = `'${t}`;
  return `"${t.replace(/"/g, '""')}"`;
}

/** UTF-8 with a byte-order mark, so Excel shows Hindi and other scripts correctly. */
export function toCsv(rows: LeadRow[]): string {
  const lines = [COLUMNS.map(([h]) => csvCell(h)).join(",")];
  for (const r of rows) lines.push(COLUMNS.map(([, f]) => csvCell(f(r))).join(","));
  return "\uFEFF" + lines.join("\r\n") + "\r\n";
}
