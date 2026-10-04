// Server-only. Videos live in a PRIVATE Supabase Storage bucket; the browser
// only ever sees short-lived signed links, and the service key never leaves the server.

export const BUCKET = "venus-videos";

export function supabaseConfigured(): boolean {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

function cfg() {
  const url = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!url || !key) {
    throw new Error(
      "Supabase is not set up — add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Vercel and redeploy."
    );
  }
  return { url, key };
}

async function storage(path: string, init: { method?: string; json?: unknown; headers?: Record<string, string> } = {}) {
  const { url, key } = cfg();
  const res = await fetch(url + "/storage/v1" + path, {
    method: init.method ?? "GET",
    headers: {
      apikey: key,
      Authorization: "Bearer " + key,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
    body: init.json !== undefined ? JSON.stringify(init.json) : undefined,
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  let data: any = {};
  try {
    data = JSON.parse(text);
  } catch {
    // not JSON
  }
  return { res, data, text };
}

let bucketReady = false;
async function ensureBucket() {
  if (bucketReady) return;
  const { res, data, text } = await storage("/bucket", {
    method: "POST",
    json: { id: BUCKET, name: BUCKET, public: false },
  });
  if (!res.ok && !/exist|duplicate/i.test(text)) {
    throw new Error("Could not create the Supabase bucket: " + String(data?.message || text).slice(0, 200));
  }
  bucketReady = true;
}

const enc = (p: string) => p.split("/").map(encodeURIComponent).join("/");

/** A one-time URL the computer can PUT the video to (no secret inside the sandbox). */
export async function createSignedUpload(path: string): Promise<string> {
  await ensureBucket();
  const { url } = cfg();
  const { res, data, text } = await storage("/object/upload/sign/" + BUCKET + "/" + enc(path), {
    method: "POST",
    json: {}, // Supabase rejects this call with "Body cannot be empty" when no body is sent
    headers: { "x-upsert": "true" },
  });
  if (!res.ok) throw new Error("Could not create the Supabase upload link: " + String(data?.message || text).slice(0, 200));
  if (data.url) return url + "/storage/v1" + data.url;
  if (data.token) return url + "/storage/v1/object/upload/sign/" + BUCKET + "/" + enc(path) + "?token=" + data.token;
  throw new Error("Supabase did not return an upload link.");
}

export async function createSignedDownload(path: string, expiresIn = 6 * 3600): Promise<string> {
  const { url } = cfg();
  const { res, data, text } = await storage("/object/sign/" + BUCKET + "/" + enc(path), {
    method: "POST",
    json: { expiresIn },
  });
  if (!res.ok || !data.signedURL) {
    throw new Error("Could not create the video link: " + String(data?.message || text).slice(0, 200));
  }
  return url + "/storage/v1" + data.signedURL;
}

export async function removeObjects(paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  await storage("/object/" + BUCKET, { method: "DELETE", json: { prefixes: paths } });
}