// Proxy presets for the vPassword "Proxy" form: one click fills the provider's gateway and the country's time zone and language.
// PURE (no imports). The provider gateways are the ones the providers publish for their residential networks at the time of writing;
// providers change them, so the form says "check your provider's dashboard" and you can always edit the fields. Your username and
// password always come from YOUR provider account: nothing here can reach a proxy without them.

export type ProxyPreset = { id: string; name: string; scheme: "http" | "https"; host: string; port: string; userHint: string };
export const PROXY_PRESETS: ProxyPreset[] = [
  { id: "brightdata", name: "Bright Data", scheme: "http", host: "brd.superproxy.io", port: "33335", userHint: "brd-customer-<id>-zone-<zone>-country-<cc>" },
  { id: "oxylabs", name: "Oxylabs", scheme: "http", host: "pr.oxylabs.io", port: "7777", userHint: "customer-<user>-cc-<CC>" },
  { id: "decodo", name: "Decodo (Smartproxy)", scheme: "http", host: "gate.decodo.com", port: "7000", userHint: "user-<user>-country-<cc>" },
  { id: "iproyal", name: "IPRoyal", scheme: "http", host: "geo.iproyal.com", port: "12321", userHint: "<user> (add _country-<cc> to the password)" },
  { id: "webshare", name: "Webshare", scheme: "http", host: "p.webshare.io", port: "80", userHint: "<user>-rotate" },
];

export type Country = { code: string; name: string; tz: string; lang: string };
export const COUNTRIES: Country[] = [
  { code: "IN", name: "India", tz: "Asia/Kolkata", lang: "en-IN" },
  { code: "US", name: "United States", tz: "America/New_York", lang: "en-US" },
  { code: "GB", name: "United Kingdom", tz: "Europe/London", lang: "en-GB" },
  { code: "AE", name: "United Arab Emirates", tz: "Asia/Dubai", lang: "en-AE" },
  { code: "SG", name: "Singapore", tz: "Asia/Singapore", lang: "en-SG" },
  { code: "DE", name: "Germany", tz: "Europe/Berlin", lang: "de-DE" },
  { code: "AU", name: "Australia", tz: "Australia/Sydney", lang: "en-AU" },
  { code: "CA", name: "Canada", tz: "America/Toronto", lang: "en-CA" },
];

export const presetById = (id: string) => PROXY_PRESETS.find((p) => p.id === id);
export const countryByCode = (code: string) => COUNTRIES.find((c) => c.code === code.toUpperCase());

/** What the form fields become when a preset and/or a country is chosen. Fields not touched stay as they are. */
export function applyProxyChoice(cur: { scheme: string; host: string; port: string; tz: string; lang: string }, presetId?: string, countryCode?: string) {
  const out = { ...cur };
  const p = presetId ? presetById(presetId) : undefined;
  if (p) { out.scheme = p.scheme; out.host = p.host; out.port = p.port; }
  const c = countryCode ? countryByCode(countryCode) : undefined;
  if (c) { out.tz = c.tz; out.lang = c.lang; }
  return out;
}
