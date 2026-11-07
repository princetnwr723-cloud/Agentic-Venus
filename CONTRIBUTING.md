# Contributing to AgenticVenus

Thank you for helping. Good first areas: tools (`lib/tools/`), connectors, skills, UI components, docs, tests.

## Rules

1. **No secrets.** Never commit keys, tokens, `.env*` files or service accounts. Use `.env.example` for names only.
2. **Protected files are maintainer-only.** Plans, usage limits, payments, auth and database rules
   (listed in `.github/protected-paths.txt`) cannot be changed by outside pull requests. CI rejects them.
   If you find a problem there, open an issue or follow `SECURITY.md`.
3. **Do not weaken checks.** A change that skips a limit check, lets the browser decide a plan or logs a secret is rejected.
4. **Tests.** Run `npm run check` and `npx tsc --noEmit` before opening a pull request. New logic needs a test in `scripts/tests/`.
5. **Small pull requests.** One idea per pull request, with a clear description.
6. **CLA.** By opening a pull request you agree to `CLA.md`.

## Workflow

Fork, create a branch, make the change, run the checks, open a pull request using the template.
A maintainer reviews every pull request (CODEOWNERS).