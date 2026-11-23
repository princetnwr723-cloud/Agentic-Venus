import type { Metadata } from "next";
import LegalPage, { COMPANY, CONTACT, H, L, P } from "@/components/legal/LegalPage";

export const metadata: Metadata = { title: "Privacy Policy — AgenticVenus" };

// TEMPLATE: written to match what the code really stores (see lib/vault.ts, lib/vpassword.ts, lib/billing-server.ts, app/api/account/route.ts).
// Have a lawyer review it, add your company address and name a Grievance Officer before launch. Keep it true: if you add a new
// service that receives user data, add it to section 3.
export default function Privacy() {
  return (
    <LegalPage title="Privacy Policy">
      <P>This explains what {COMPANY} stores, why, who else receives it and what you can do. It is written for the Indian Digital Personal Data Protection Act, 2023 (DPDP) and is meant to also fit GDPR-style rights.</P>

      <H>1. What we store</H>
      <L items={[
        "Account: your sign-in identity from Google/Firebase (email, name, user id).",
        "Your work: chats and messages, agent runs and their steps, memories and skills the agent saved, routines, projects, team settings, files the agent made.",
        "Connections: tokens for services you connect (Gmail, Slack, MCP servers…) and your own AI/E2B keys. These are encrypted before they are saved (AES-256-GCM).",
        "vPassword: logins, cards, 2FA seeds and proxies you add. The secret part is encrypted; the list shows only a label, a site and a hint such as the last four digits. A card number is released only for one payment that you approved in the app, for that amount and that site, and the AI model never sees it.",
        "Billing and usage: your plan, usage counters (tokens, computer time) and payment events from Gumroad. We do not store your card details for plan payments; Gumroad does.",
        "Security log: a short trail of sensitive actions (a write action, a vault change, a payment request) so you can see what the agent did.",
        "Technical data: error reports and server logs with secrets removed, and your network address for rate limiting.",
      ]} />

      <H>2. Why we use it</H>
      <P>To run the service you asked for, keep it safe, bill you correctly, prevent abuse and fix errors. We do not sell your data. Your content is not used to train any model unless you switch on the optional FOUNT learning program in settings: then scrubbed summaries of finished runs (secrets, e-mail addresses and names removed, tied only to a one-way code, not to your identity) are kept for a limited time (60 days by default) to improve our agent. You can switch it off at any time.</P>

      <H>3. Who else receives data</H>
      <L items={[
        "Hosting and database: Vercel and Google (Firebase) store and process your data.",
        "AI providers you choose (OpenAI, Anthropic, Google and others): they receive the prompts, files and tool results the agent sends, under their own terms.",
        "E2B: runs your cloud computer, with your own E2B key.",
        "Services you connect (Gmail, Slack, GitHub, MCP servers, Telegram, Twilio…): they receive what the agent sends them when you ask it to act.",
        "Gumroad: payments for plans.",
        "Error monitoring (for example Sentry), if the operator turned it on: receives error messages with secrets removed.",
      ]} />

      <H>4. Pages the agent reads</H>
      <P>The agent reads web pages, mails and files that other people wrote. We treat that text as untrusted data and flag instruction-like text, but no filter is perfect. Approvals exist so that a bad page cannot spend your money or send your data without you.</P>

      <H>5. How long we keep it</H>
      <P>Until you delete it or your account. When you delete your account we remove your data and login. We keep a minimal record that an account was deleted and payment records that the law or accounting requires, without your content.</P>

      <H>6. Your rights</H>
      <P>You can: download your data, correct it, delete it, withdraw consent and complain. The <a className="underline" href="/account">Your data</a> page lets you download everything (secrets excluded) and delete your account. For anything else, or if you are not satisfied, write to our Grievance Officer at <a className="underline" href={`mailto:${CONTACT}`}>{CONTACT}</a>. You can also complain to the Data Protection Board of India or your local authority.</P>

      <H>7. Security</H>
      <P>Secrets are encrypted at rest, requests are authenticated, background tasks use signed short-lived tokens, and there are rate limits and approval gates. No system is perfectly secure; tell us at once if you suspect a problem.</P>

      <H>8. Children</H>
      <P>The service is for people 18 and over. We do not knowingly collect data from children.</P>

      <H>9. Changes</H>
      <P>When this policy changes, the date above changes and material changes are announced in the app.</P>
    </LegalPage>
  );
}
