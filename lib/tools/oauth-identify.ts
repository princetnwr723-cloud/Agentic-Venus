import { http } from "./net";

/** Which account did the user actually sign in with? Shown in Connectors and checked against the account they asked for. */
export async function identifyAccount(providerId: string, access: string): Promise<string> {
  const h = { Authorization: `Bearer ${access}`, Accept: "application/json", "User-Agent": "AgenticVenus/1.0" };
  try {
    if (providerId === "google" || providerId === "youtube") {
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
    // ---- social media ----
    if (providerId === "x") {
      const r = await http("https://api.x.com/2/users/me", { headers: h }, 10_000);
      return r.json?.data?.username ? `@${r.json.data.username}` : "";
    }
    if (providerId === "linkedin") {
      const r = await http("https://api.linkedin.com/v2/userinfo", { headers: h }, 10_000);
      return String(r.json?.email ?? r.json?.name ?? "");
    }
    if (providerId === "meta") {
      const r = await http("https://graph.facebook.com/v26.0/me?fields=name", { headers: h }, 10_000);
      return String(r.json?.name ?? "");
    }
    if (providerId === "threads") {
      const r = await http("https://graph.threads.com/v1.0/me?fields=username", { headers: h }, 10_000);
      return r.json?.username ? `@${r.json.username}` : "";
    }
    if (providerId === "tiktok") {
      const r = await http("https://open.tiktokapis.com/v2/user/info/?fields=display_name", { headers: h }, 10_000);
      return String(r.json?.data?.user?.display_name ?? "");
    }
    if (providerId === "pinterest") {
      const r = await http("https://api.pinterest.com/v5/user_account", { headers: h }, 10_000);
      return String(r.json?.username ?? "");
    }
    if (providerId === "reddit") {
      const r = await http("https://oauth.reddit.com/api/v1/me", { headers: h }, 10_000);
      return r.json?.name ? `u/${r.json.name}` : "";
    }
  } catch { /* the account name is a nicety, never a blocker */ }
  return "";
}