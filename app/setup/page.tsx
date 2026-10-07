"use client";

import { useState } from "react";

export default function SetupPage() {
  const [key, setKey] = useState("");
  const [copied, setCopied] = useState(false);
  function gen() {
    const b = new Uint8Array(32);
    crypto.getRandomValues(b);
    setKey(btoa(String.fromCharCode(...Array.from(b))));
    setCopied(false);
  }
  return (
    <div className="min-h-screen bg-bg px-6 py-10 text-ink">
      <div className="mx-auto max-w-xl space-y-4">
        <h1 className="text-xl font-semibold">Encryption key (optional)</h1>
        <p className="text-sm leading-relaxed text-muted">
          The app already encrypts your secrets with a key derived from <b className="text-ink">ROUTINE_RUNNER_SECRET</b>, so you do not need this. If you want a dedicated key, generate one here. It is created in your browser and is never sent anywhere.
        </p>
        <button onClick={gen} className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-bg">Generate a key</button>
        {key && (
          <>
            <p className="break-all rounded-lg border border-line bg-panel p-3 font-mono text-xs">{key}</p>
            <button onClick={() => { navigator.clipboard?.writeText(key); setCopied(true); }} className="rounded-lg border border-line px-3 py-1.5 text-xs">{copied ? "Copied" : "Copy"}</button>
            <ol className="list-decimal space-y-1 pl-5 text-sm text-muted">
              <li>Vercel → your project → Settings → Environment Variables.</li>
              <li>Name <b className="text-ink">VAULT_KEY</b>, paste the value, select all environments, Save.</li>
              <li>Deployments → latest → Redeploy.</li>
              <li>Keep a copy somewhere safe. If you lose it you must re-enter your saved secrets.</li>
            </ol>
          </>
        )}
      </div>
    </div>
  );
}