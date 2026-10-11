/** OAuth providers supported by the shared authorization-code flow.
 * Each provider still needs its own client credentials in Vercel. `hosts` = the only API hosts the agent may call.
 * Only providers that work with a plain redirect + fixed API host are listed.
 */
export type OAuthProvider = {
  id: string; label: string; authorizeUrl: string; tokenUrl: string; clientIdEnv: string; clientSecretEnv: string;
  scopes: string[]; apiBase: string; apiHost: string; hosts: string[]; note: string;
};

const googleScopes = [
  "openid", "email", "profile",
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/drive.readonly",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/calendar.events",
];

export const OAUTH_PROVIDERS: OAuthProvider[] = [
  { id: "google", label: "Google Workspace", authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth", tokenUrl: "https://oauth2.googleapis.com/token", clientIdEnv: "GOOGLE_CLIENT_ID", clientSecretEnv: "GOOGLE_CLIENT_SECRET", scopes: googleScopes, apiBase: "https://www.googleapis.com", apiHost: "www.googleapis.com", hosts: ["www.googleapis.com", "sheets.googleapis.com", "gmail.googleapis.com", "docs.googleapis.com"], note: "Gmail (read+send), Sheets (read+write), Drive (read), Calendar. Enable these APIs in Google Cloud." },
  { id: "microsoft", label: "Microsoft 365", authorizeUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize", tokenUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/token", clientIdEnv: "MICROSOFT_CLIENT_ID", clientSecretEnv: "MICROSOFT_CLIENT_SECRET", scopes: ["openid", "profile", "email", "offline_access", "User.Read", "Mail.Read", "Mail.Send", "Files.ReadWrite", "Calendars.ReadWrite"], apiBase: "https://graph.microsoft.com/v1.0", apiHost: "graph.microsoft.com", hosts: ["graph.microsoft.com"], note: "Outlook, OneDrive/Excel, Calendar through Microsoft Graph." },
  { id: "slack", label: "Slack (workspace)", authorizeUrl: "https://slack.com/oauth/v2/authorize", tokenUrl: "https://slack.com/api/oauth.v2.access", clientIdEnv: "SLACK_CLIENT_ID", clientSecretEnv: "SLACK_CLIENT_SECRET", scopes: ["channels:read", "chat:write", "users:read", "search:read"], apiBase: "https://slack.com/api", apiHost: "slack.com", hosts: ["slack.com"], note: "Read channels, post messages. Scopes are limited by what the Slack admin approves." },
  { id: "github_oauth", label: "GitHub", authorizeUrl: "https://github.com/login/oauth/authorize", tokenUrl: "https://github.com/login/oauth/access_token", clientIdEnv: "GITHUB_OAUTH_CLIENT_ID", clientSecretEnv: "GITHUB_OAUTH_CLIENT_SECRET", scopes: ["read:user", "repo"], apiBase: "https://api.github.com", apiHost: "api.github.com", hosts: ["api.github.com"], note: "Repository scopes are broad; prefer the token plugin for least privilege." },
  { id: "notion_oauth", label: "Notion", authorizeUrl: "https://api.notion.com/v1/oauth/authorize", tokenUrl: "https://api.notion.com/v1/oauth/token", clientIdEnv: "NOTION_OAUTH_CLIENT_ID", clientSecretEnv: "NOTION_OAUTH_CLIENT_SECRET", scopes: [], apiBase: "https://api.notion.com/v1", apiHost: "api.notion.com", hosts: ["api.notion.com"], note: "Needs a public Notion integration. Easier: use the Notion MCP server in the Custom tab." },
  { id: "linear", label: "Linear", authorizeUrl: "https://linear.app/oauth/authorize", tokenUrl: "https://api.linear.app/oauth/token", clientIdEnv: "LINEAR_CLIENT_ID", clientSecretEnv: "LINEAR_CLIENT_SECRET", scopes: ["read", "write"], apiBase: "https://api.linear.app", apiHost: "api.linear.app", hosts: ["api.linear.app"], note: "GraphQL API at /graphql. Easier: Linear MCP server in the Custom tab." },
  { id: "dropbox", label: "Dropbox", authorizeUrl: "https://www.dropbox.com/oauth2/authorize", tokenUrl: "https://api.dropboxapi.com/oauth2/token", clientIdEnv: "DROPBOX_CLIENT_ID", clientSecretEnv: "DROPBOX_CLIENT_SECRET", scopes: [], apiBase: "https://api.dropboxapi.com/2", apiHost: "api.dropboxapi.com", hosts: ["api.dropboxapi.com"], note: "Enable the scopes in the Dropbox app console." },
  { id: "hubspot", label: "HubSpot", authorizeUrl: "https://app.hubspot.com/oauth/authorize", tokenUrl: "https://api.hubapi.com/oauth/v1/token", clientIdEnv: "HUBSPOT_CLIENT_ID", clientSecretEnv: "HUBSPOT_CLIENT_SECRET", scopes: ["oauth", "crm.objects.contacts.read", "crm.objects.contacts.write", "crm.objects.companies.read", "crm.objects.deals.read"], apiBase: "https://api.hubapi.com", apiHost: "api.hubapi.com", hosts: ["api.hubapi.com"], note: "CRM contacts, companies, deals." },
  { id: "asana", label: "Asana", authorizeUrl: "https://app.asana.com/-/oauth_authorize", tokenUrl: "https://app.asana.com/-/oauth_token", clientIdEnv: "ASANA_CLIENT_ID", clientSecretEnv: "ASANA_CLIENT_SECRET", scopes: ["default"], apiBase: "https://app.asana.com/api/1.0", apiHost: "app.asana.com", hosts: ["app.asana.com"], note: "Tasks and projects." },
  { id: "zoom", label: "Zoom", authorizeUrl: "https://zoom.us/oauth/authorize", tokenUrl: "https://zoom.us/oauth/token", clientIdEnv: "ZOOM_CLIENT_ID", clientSecretEnv: "ZOOM_CLIENT_SECRET", scopes: ["user:read:user", "meeting:read:list_meetings"], apiBase: "https://api.zoom.us/v2", apiHost: "api.zoom.us", hosts: ["api.zoom.us"], note: "Meetings. Scopes depend on the Marketplace app." },
  { id: "figma", label: "Figma", authorizeUrl: "https://www.figma.com/oauth", tokenUrl: "https://api.figma.com/v1/oauth/token", clientIdEnv: "FIGMA_CLIENT_ID", clientSecretEnv: "FIGMA_CLIENT_SECRET", scopes: ["file_read"], apiBase: "https://api.figma.com/v1", apiHost: "api.figma.com", hosts: ["api.figma.com"], note: "Read files." },
  { id: "webflow", label: "Webflow", authorizeUrl: "https://webflow.com/oauth/authorize", tokenUrl: "https://api.webflow.com/oauth/access_token", clientIdEnv: "WEBFLOW_CLIENT_ID", clientSecretEnv: "WEBFLOW_CLIENT_SECRET", scopes: ["sites:read", "pages:read"], apiBase: "https://api.webflow.com/v2", apiHost: "api.webflow.com", hosts: ["api.webflow.com"], note: "Sites and pages." },
];
export const getOAuthProvider = (id: string) => OAUTH_PROVIDERS.find((p) => p.id === id);