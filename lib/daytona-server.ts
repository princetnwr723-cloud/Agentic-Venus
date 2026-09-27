// Server-only. Talks to Daytona's REST API directly (confirmed format from
// daytona.io/docs) rather than the SDK, so no extra dependency is needed.
// The API key is the person's own — passed in per-request, never stored
// in an env var — so each user's sandboxes bill to their own Daytona
// account.

const BASE = "https://app.daytona.io/api";

export async function createSandbox(apiKey: string): Promise<string> {
  const res = await fetch(`${BASE}/sandbox`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      data?.message || "Could not create a computer — check the Daytona API key."
    );
  }
  if (!data?.id) {
    throw new Error("Daytona didn't return a sandbox id.");
  }
  return data.id as string;
}

export async function deleteSandbox(apiKey: string, sandboxId: string): Promise<void> {
  const res = await fetch(`${BASE}/sandbox/${sandboxId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data?.message || "Could not delete the sandbox.");
  }
}