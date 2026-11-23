# Launch checklist (web + cloud computer)

Everything below was checked by running the repo's tests (`node --experimental-strip-types --no-warnings --test scripts/tests/*.test.mjs`).
Things marked **YOU** cannot be done by code alone.

## Before the first public user

1. **YOU: lock the dependencies.** Run `npm install` once on your computer and commit the new `package-lock.json`. (The CI already warns when it is missing.)
2. **YOU: build once.** Run `npx tsc --noEmit` and `npm run build`. The new files were type-checked in strict mode only against stand-in declarations for Next, React and Firebase, so a real build is the final proof.
3. **YOU: set the secrets** listed in `.env.example` under "Launch safety" and "Monitoring". At minimum: `SENTRY_DSN` or `ALERT_WEBHOOK_URL`, `NEXT_PUBLIC_COMPANY_NAME`, `NEXT_PUBLIC_CONTACT_EMAIL`.
4. **YOU: legal review.** `/terms` and `/privacy` are templates written to match what the code really stores. Have a lawyer check them, add your address and a Grievance Officer name (DPDP Act).
5. **YOU: schedule the new job.** `.github/workflows/connectors-catalog.yml` refreshes the connector list daily (uses the same `APP_URL` and `ROUTINE_RUNNER_SECRET` secrets as the routine runner).
6. Payments stay in **beta mode** (default): every payment needs the owner's approval, cards must be tied to one site, and a single payment is capped by `VENUS_BETA_MAX_PAYMENT` (default 1000). Move to `VENUS_PAYMENTS_MODE=on` only after you have watched real use.

## What was added

| Area | Files |
|---|---|
| Rate limiting (per IP + per user) | `lib/rate-limit.ts`, `middleware.ts`, `lib/request.ts` |
| Plan-aware cost cap per run | `lib/agent/cost-policy.ts`, `lib/agent/worker.ts` |
| Payments beta mode | `lib/payments-mode.ts`, `app/api/vpassword/route.ts` |
| Hinglish / Hindi / multi-language injection shield | `lib/shield.ts`, `lib/agent/risk.ts` |
| Monitoring + status page | `lib/monitor.ts`, `app/api/status/route.ts`, `app/status/page.tsx` |
| Legal + data rights | `app/terms`, `app/privacy`, `app/account`, `app/api/account/route.ts`, `lib/account-core.ts` |
| MCP connector catalog (logos, search, one-click) | `lib/mcp/catalog.ts`, `lib/mcp/catalog-server.ts`, `app/api/connectors/catalog/*`, `components/dashboard/McpCatalogBrowser.tsx`, `components/dashboard/ConnectorsModal.tsx` |
| 221 eval tasks + nightly run | `evals/suite.json`, `scripts/build-eval-suite.py`, `scripts/eval-suite.mjs`, `.github/workflows/quality-evals.yml` |
| Cloud computer: human-like input, captcha hand-off, proxy presets | `lib/pc-runner-script.ts`, `lib/proxy-presets.ts`, `app/vpassword/page.tsx` |
| Semantic memory engine (not connected yet) | `lib/embed.ts` |

## Not done (and why)

- **Virtual cards.** Needs a card-issuing provider (Stripe Issuing or similar) and a business agreement.
- **Splitting `app/dashboard/page.tsx` (about 2000 lines) and removing the ~420 `any` types.** A change of that size without a real build and click-through would risk breaking the dashboard. Do it with `npm run build` available.
- **Connecting embeddings to memory.** `lib/embed.ts` is ready and tested; it needs a decision on which provider key pays for it and where vectors are cached.
- **Browsing 1000+ MCP servers.** The catalog reads every server the official registry lists with a remote address. The real number depends on the registry on the day you sync (the Refresh button shows it). Servers that only ship a local package (stdio) cannot run from a web server.
