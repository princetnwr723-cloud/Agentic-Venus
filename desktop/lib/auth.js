"use strict";
// Login for the desktop app: the same PKCE flow as the Android app (browser login, one-time code, secret verifier).
const crypto = require("crypto");

const b64url = (buf) => Buffer.from(buf).toString("base64url");
function pkce() {
  const verifier = b64url(crypto.randomBytes(32));
  const challenge = b64url(crypto.createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

async function post(url, body, json = true) {
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": json ? "application/json" : "application/x-www-form-urlencoded" },
    body: json ? JSON.stringify(body) : new URLSearchParams(body).toString(),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j.error && (j.error.message || j.error)) || "Login failed (" + r.status + ").");
  return j;
}

/** one-time code + verifier  ->  Firebase custom token */
async function redeem(appUrl, code, verifier) {
  const j = await post(appUrl + "/api/native-auth/redeem", { code, verifier });
  if (!j.token) throw new Error("Login failed.");
  return j.token;
}

/** custom token -> ID token (1 hour) + refresh token, using Firebase's public REST API (the web API key is public). */
async function signIn(apiKey, customToken) {
  const j = await post(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${encodeURIComponent(apiKey)}`, { token: customToken, returnSecureToken: true });
  return { idToken: j.idToken, refreshToken: j.refreshToken, expiresAt: Date.now() + Number(j.expiresIn || 3600) * 1000 };
}

async function refresh(apiKey, refreshToken) {
  const j = await post(`https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(apiKey)}`, { grant_type: "refresh_token", refresh_token: refreshToken }, false);
  return { idToken: j.id_token, refreshToken: j.refresh_token || refreshToken, expiresAt: Date.now() + Number(j.expires_in || 3600) * 1000 };
}

/** Keeps a fresh ID token; the refresh token is saved by the caller (encrypted). */
class Session {
  constructor(apiKey, save) { this.apiKey = apiKey; this.save = save; this.t = null; }
  get signedIn() { return Boolean(this.t && this.t.refreshToken); }
  set(t) { this.t = t; this.save(t.refreshToken); }
  restore(refreshToken) { this.t = { idToken: "", refreshToken, expiresAt: 0 }; }
  clear() { this.t = null; this.save(null); }
  async idToken() {
    if (!this.t) throw new Error("Not signed in.");
    if (this.t.expiresAt - Date.now() < 5 * 60_000) { this.t = await refresh(this.apiKey, this.t.refreshToken); this.save(this.t.refreshToken); }
    return this.t.idToken;
  }
}

module.exports = { pkce, redeem, signIn, refresh, Session };