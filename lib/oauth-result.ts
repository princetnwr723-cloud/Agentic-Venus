import { appBaseUrl } from "@/lib/voice-server";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));

/**
 * What the owner sees when a sign-in ends (success OR failure). The dashboard did not show the result,
 * so a failed sign-in just looked like "it sent me back to Agentic Venus". Now the result is written on the page.
 * Success goes back to the dashboard by itself after a moment; an error stays until the owner reads it.
 */
export function oauthResultPage(req: Request, ok: boolean, message: string, o: { chatId?: string; provider?: string } = {}): Response {
  let base: string;
  try { base = appBaseUrl(req); } catch { base = new URL(req.url).origin; }
  const dash = new URL("/dashboard", base);
  dash.searchParams.set("connector_oauth", ok ? "success" : "error");
  dash.searchParams.set("message", message.slice(0, 180));
  if (o.provider) dash.searchParams.set("provider", o.provider);
  if (o.chatId) dash.searchParams.set("chatId", o.chatId);
  const href = dash.toString();
  const color = ok ? "#5eead4" : "#fca5a5";
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${ok ? "Connected" : "Sign-in problem"} · Agentic Venus</title></head>
<body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0b0b0c;color:#ececec;font-family:system-ui,-apple-system,Segoe UI,sans-serif;padding:24px">
<div style="max-width:440px;width:100%;border:1px solid #2a2a2e;border-radius:16px;padding:28px;background:#131316;text-align:center">
<div style="font-size:34px;line-height:1;color:${color}">${ok ? "✓" : "!"}</div>
<h1 style="font-size:18px;margin:14px 0 8px">${ok ? "Connected" : "The sign-in did not finish"}</h1>
<p style="font-size:14px;line-height:1.55;color:#b5b5ba;margin:0 0 18px;word-break:break-word">${esc(message)}</p>
<p style="font-size:12px;color:#8a8a90;margin:0 0 18px">${ok ? "You can close this tab and go back to your chat. The agent already has the new tools." : "Go back to your chat and ask the agent to connect it again. If it keeps failing, send this message to whoever runs the site."}</p>
<a href="${esc(href)}" style="display:inline-block;background:#fff;color:#0b0b0c;border-radius:8px;padding:9px 16px;font-size:13px;font-weight:600;text-decoration:none">Back to Agentic Venus</a>
</div>${ok ? `<script>setTimeout(function(){location.replace(${JSON.stringify(href).replace(/</g, "\\u003c")})},3500)</script>` : ""}</body></html>`;
  return new Response(html, { status: ok ? 200 : 400, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}
