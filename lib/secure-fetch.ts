let installed = false;

/** A plan limit comes back as HTTP 402 "... limit reached on the Free plan ...". Tell the page so it can show the upgrade popup. */
function announceLimit(res: Response) {
  if (res.status !== 402) return;
  res
    .clone()
    .json()
    .then((j) => {
      const message = String(j?.error ?? "");
      if (/limit reached on the .+ plan/i.test(message)) {
        window.dispatchEvent(new CustomEvent("venus:limit", { detail: { message } }));
      }
    })
    .catch(() => undefined);
}

/** Every same-origin /api/* request automatically carries your Firebase ID token, so no call site needs changing. */
export function installSecureFetch(getToken: () => Promise<string | null>) {
  if (installed || typeof window === "undefined") return;
  installed = true;
  const orig = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    let isApi = false;
    let nextInit = init;
    try {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const u = new URL(url, window.location.origin);
      if (u.origin === window.location.origin && u.pathname.startsWith("/api/")) {
        isApi = true;
        const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
        if (!headers.has("Authorization")) {
          const t = await getToken();
          if (t) headers.set("Authorization", "Bearer " + t);
        }
        nextInit = { ...init, headers };
      }
    } catch { /* fall through to the plain fetch */ }
    const res = await orig(input, nextInit);
    if (isApi) announceLimit(res);
    return res;
  };
}