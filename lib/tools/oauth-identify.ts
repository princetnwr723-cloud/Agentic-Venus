import { http } from "./net";

/** Which account did the user actually sign in with? Shown in Connectors and checked against the account they asked for. */
export async function identifyAccount(providerId: string, access: string): Promise<string> {
  const h = { Authorization: `Bearer ${access}`, Accept: "application/json", "User-Agent": "AgenticVenus" };
  try {
    if (providerId === "google") {
      const r = await http("https://openidconnect.googleapis.com/v1/userinfo", { headers: h }, 10_000);
      return String(r.json?.email ?? "");
    }
    if (providerId === "microsoft") {
      const r = await http("https://graph.microsoft.com/v1.0/me", { headers: h }, 10_000);
      return String(r.json?.mail ?? r.json?.userPrincipalName ?? "");
    }
    if (providerId === "github_oauth") {
      const r = await http("https://api.github.com/user", { headers: h }, 10_000);
      return String(r.json?.login ?? "");
    }
    if (providerId === "slack") {
      const r = await http("https://slack.com/api/auth.test", { method: "POST", headers: h }, 10_000);
      return r.json?.ok ? `${r.json.user ?? "user"} @ ${r.json.team ?? "workspace"}` : "";
    }
  } catch { /* the account name is a nicety, never a blocker */ }
  return "";
}