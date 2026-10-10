import { isIP } from "node:net";

function ipv4Parts(address) {
  if (isIP(address) !== 4) return null;
  return address.split(".").map(Number);
}

export function isPrivateAddress(address) {
  const ip = String(address || "").replace(/^\[|\]$/g, "").toLowerCase();
  const version = isIP(ip);
  if (!version) return true; // Fail closed when the caller gives a non-IP address.
  if (version === 4) {
    const p = ipv4Parts(ip);
    const [a, b, c] = p;
    return a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 168 || (b === 0 && c === 0) || (b === 0 && c === 2) || (b === 88 && c === 99))) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
      (a === 203 && b === 0 && c === 113) ||
      a >= 240;
  }

  // IPv4-mapped IPv6 must inherit the IPv4 decision before broad IPv6 ranges.
  const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateAddress(mapped[1]);
  const hexMapped = ip.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hexMapped) {
    const high = parseInt(hexMapped[1], 16);
    const low = parseInt(hexMapped[2], 16);
    return isPrivateAddress(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`);
  }

  // Only global-unicast IPv6 (2000::/3) is eligible. Then reject special-use
  // and transition prefixes that can tunnel or represent non-public destinations.
  if (ip === "::" || ip === "::1" || ip.startsWith("fc") || ip.startsWith("fd") ||
      /^fe[89ab]/.test(ip) || ip.startsWith("ff") || ip.startsWith("2001:db8") ||
      ip.startsWith("2001:0:") || ip.startsWith("2001:10:") || ip.startsWith("2001:20:") ||
      ip.startsWith("2002:")) return true;
  const firstHextet = parseInt(ip.split(":")[0] || "0", 16);
  if (!Number.isFinite(firstHextet) || firstHextet < 0x2000 || firstHextet > 0x3fff) return true;
  return false;
}

export function normalizePublicHttpUrl(input) {
  const raw = String(input || "").trim();
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) && !/^https?:\/\//i.test(raw)) {
    throw new Error("Only public HTTP(S) website URLs are allowed.");
  }
  if (/^(javascript|data|file|ftp):/i.test(raw)) {
    throw new Error("Only public HTTP(S) website URLs are allowed.");
  }
  let url;
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    throw new Error("Enter a valid public website URL.");
  }
  if (!["http:", "https:"].includes(url.protocol) || !url.hostname || url.username || url.password) {
    throw new Error("Only public HTTP(S) website URLs without embedded credentials are allowed.");
  }
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") ||
      host.endsWith(".internal") || host.endsWith(".test") || host.endsWith(".invalid") ||
      host.endsWith(".example") || (isIP(host) && isPrivateAddress(host))) {
    throw new Error("Only public HTTP(S) pages can be opened.");
  }
  return url.toString();
}
