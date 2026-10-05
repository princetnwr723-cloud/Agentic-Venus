let installed = false;

/** Every same-origin /api/* request automatically carries your Firebase ID token, so no call site needs changing. */
export function installSecureFetch(getToken: () => Promise<string | null>) {
  if (installed || typeof window === "undefined") return;
  installed = true;
  const orig = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    try {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const u = new URL(url, window.location.origin);
      if (u.origin === window.location.origin && u.pathname.startsWith("/api/")) {
        const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
        if (!headers.has("Authorization")) {
          const t = await getToken();
          if (t) headers.set("Authorization", "Bearer " + t);
        }
        return orig(input, { ...init, headers });
      }
    } catch { /* fall through to the plain fetch */ }
    return orig(input, init);
  };
}
