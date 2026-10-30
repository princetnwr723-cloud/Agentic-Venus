/** "mcp.canva.com" -> "canva.com". Pure, so the browser (logos in the Connectors window) and the server share it. */
export function brandDomain(host: string): string {
  const labels = host.toLowerCase().split(".").filter(Boolean);
  while (labels.length > 2 && ["mcp", "api", "www", "app", "auth", "login", "accounts", "id", "sso", "open", "docs", "mcp-server"].includes(labels[0])) labels.shift();
  if (labels.length >= 3 && labels[labels.length - 1].length === 2 && ["co", "com", "org", "net", "gov", "ac"].includes(labels[labels.length - 2])) return labels.slice(-3).join(".");
  return labels.slice(-2).join(".");
}
