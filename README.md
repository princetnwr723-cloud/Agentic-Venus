# AgenticVenus

An AI agent team that chats, builds websites, makes videos and works on a cloud computer.
The agent is **open source**. The **official hosted service** keeps its plans, limits and payments on our servers.

## How "open" works here

| Part | Where it lives | Can the community change it? |
|---|---|---|
| Agent, tools, UI, Venus Code, Venus Pro, connectors, skills | this repository | Yes, pull requests welcome |
| Plans, usage limits, payment checks | server code in this repository, running on **our** servers with **our** secrets | Reviewed by maintainers only (see `.github/protected-paths.txt`) |
| Payment data, plan and usage records, API keys | our Firebase project and hosting | Never in the repository |

Why limits cannot be bypassed on the hosted service: the browser and the code you edit never decide a plan.
Every request is checked on our server against our database (`users/{uid}/billing/*`), which no browser can write
(`firestore.rules`). A modified copy of the code can only talk to **your** servers, not to ours.

## Self-hosting (honest version)

If you run your own copy you use **your own** Firebase, keys and servers, so you also set **your own** limits.
That is allowed by the license. What you may not do is use the AgenticVenus name or logo for it, or run a modified
version as a network service without publishing your changes (AGPL-3.0, see `LICENSE`).

## Quick start

```bash
cp .env.example .env.local     # fill in your own values
npm install
npm run dev
npm run check                  # tests + evals
npx tsc --noEmit               # types
```

Deploy the database rules to your Firebase project: `firebase deploy --only firestore:rules`.

## Contributing

Read `CONTRIBUTING.md`. Security problems: `SECURITY.md`. Name and logo: `TRADEMARK.md`.