import { NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { getAdminDb } from "@/lib/firebase-admin";
import { vaultPut } from "@/lib/vault";
import { getOAuthProvider } from "@/lib/tools/oauth-catalog";

export const runtime = "nodejs";
function secret() { const v = process.env.ROUTINE_RUNNER_SECRET; if (!v || v.length < 32) throw new Error("OAuth callback is not configured securely."); return v; }
function fail(req: Request, message: string, _status=400) { const u=new URL("/dashboard",req.url); u.searchParams.set("connector_oauth","error"); u.searchParams.set("message",message.slice(0,180)); return NextResponse.redirect(u,303); }
export async function GET(req: Request) {
  try {
    const u=new URL(req.url); const code=u.searchParams.get("code"); const state=u.searchParams.get("state");
    if (u.searchParams.has("error")) return fail(req,`Provider denied authorization: ${u.searchParams.get("error_description") || u.searchParams.get("error")}`);
    if (!code || !state || state.length>4096) return fail(req,"OAuth callback is missing code or state.");
    const parts=state.split("."); if(parts.length!==2) return fail(req,"Invalid OAuth state.");
    const [payload,sig]=parts; const expected=createHmac("sha256",secret()).update(payload).digest(); const actual=Buffer.from(sig,"base64url");
    if(actual.length!==expected.length || !timingSafeEqual(actual,expected)) return fail(req,"OAuth state signature is invalid.");
    const d=JSON.parse(Buffer.from(payload,"base64url").toString("utf8")) as {uid:string;chatId:string;provider:string;exp:number;nonce:string};
    if(!d.uid || !d.chatId || !d.nonce || !Number.isFinite(d.exp) || d.exp<Date.now()) return fail(req,"OAuth state expired. Start connection again.");
    const provider=getOAuthProvider(d.provider); if(!provider) return fail(req,"Unknown OAuth provider.");
    const db=getAdminDb(); const nonceRef=db.collection("oauthNonces").doc(d.nonce);
    try { await nonceRef.create({uid:d.uid,chatId:d.chatId,provider:d.provider,createdAt:Date.now(),expiresAt:d.exp}); } catch { return fail(req,"OAuth state was already used or could not be verified."); }
    const clientId=process.env[provider.clientIdEnv], clientSecret=process.env[provider.clientSecretEnv];
    if(!clientId || !clientSecret) return fail(req,`Server setup missing ${provider.clientIdEnv} or ${provider.clientSecretEnv}.`,503);
    const redirectUri=process.env.OAUTH_REDIRECT_URI || new URL("/api/connectors/oauth/callback",req.url).toString();
    const body=new URLSearchParams({grant_type:"authorization_code",code,redirect_uri:redirectUri,client_id:clientId,client_secret:clientSecret});
    const basicAuth = ["notion_oauth","figma"].includes(provider.id);
    const response=await fetch(provider.tokenUrl,{method:"POST",headers:{Accept:"application/json", "Content-Type":basicAuth?"application/json":"application/x-www-form-urlencoded", ...(basicAuth?{Authorization:`Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`}:{})},body:basicAuth?JSON.stringify({grant_type:"authorization_code",code,redirect_uri:redirectUri}):body,signal:AbortSignal.timeout(15000)});
    const tokenData=await response.json().catch(()=>({}));
    if(!response.ok || !tokenData.access_token) return fail(req,`Token exchange failed for ${provider.label}. Check the app credentials, redirect URI, and provider-specific OAuth requirements.`);
    const chatRef=db.collection("users").doc(d.uid).collection("chats").doc(d.chatId);
    const chat=await chatRef.get(); if(!chat.exists) return fail(req,"Target chat no longer exists.",404);
    const token=String(tokenData.access_token);
    const placeholder=await vaultPut(d.uid,`conn.${d.chatId.toLowerCase()}.oauth:${provider.id}`,token);
    await chatRef.update({[`connectors.oauth:${provider.id}`]:placeholder,[`connectorStatus.${provider.id}`]:{status:"connected",connectedAt:Date.now(),scopes:provider.scopes}});
    const done=new URL("/dashboard",req.url); done.searchParams.set("connector_oauth","success"); done.searchParams.set("provider",provider.id); done.searchParams.set("chatId",d.chatId);
    return NextResponse.redirect(done);
  } catch(e) { return fail(req,e instanceof Error?e.message:"OAuth callback failed.",500); }
}
