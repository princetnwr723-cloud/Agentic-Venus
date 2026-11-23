import type { Metadata } from "next";
import LegalPage, { COMPANY, CONTACT, H, L, P } from "@/components/legal/LegalPage";

export const metadata: Metadata = { title: "Terms of Service — AgenticVenus" };

// TEMPLATE: written to match how the product really works. Have a lawyer in your country review it and fill in the company name,
// address and governing law before launch (NEXT_PUBLIC_COMPANY_NAME and NEXT_PUBLIC_CONTACT_EMAIL are read from the environment).
export default function Terms() {
  return (
    <LegalPage title="Terms of Service">
      <P>These terms are between you and {COMPANY} (“we”, “us”). By creating an account or using the service you agree to them. If you do not agree, do not use the service. You must be 18 or older.</P>

      <H>1. What the service is</H>
      <P>{COMPANY} lets you run AI agents that can use tools, browse, work on a cloud computer and connect to your other services. The AI models are provided by third parties you choose (for example OpenAI, Anthropic, Google). Agents can make mistakes. You are responsible for checking important results before you rely on them.</P>

      <H>2. Your account and your keys</H>
      <L items={[
        "Keep your sign-in safe. You are responsible for what happens under your account.",
        "You bring your own AI provider keys and, if you use a cloud computer, your own E2B key. Charges from those providers go to you, not to us. Per-run cost limits in the app are a safety net, not a guarantee.",
        "Saved logins, cards and tokens are stored encrypted. You can delete them at any time.",
      ]} />

      <H>3. Actions the agent takes</H>
      <P>The agent can send messages, change files, publish sites and, if you allow it, ask to pay for things. Actions that send, change or spend are held for your approval unless you switch on Automatic mode or “don’t ask” for a connector. Payments always need your own approval in the app, are limited to the site, limit and budget you set, and in the beta period are also capped by a server limit. If you approve something or turn on Automatic mode, you accept the result of what the agent then does.</P>

      <H>4. Acceptable use</H>
      <L items={[
        "No illegal activity, fraud, harassment, spam or attempts to break into other people’s accounts or systems.",
        "No use of the cloud computer or browser to attack, scrape in breach of a site’s rules, or evade security of services you do not own or have permission to use.",
        "No attempts to get around plan limits, rate limits or approvals, or to overload the service.",
        "You are responsible for having the right to connect the accounts and data you connect.",
      ]} />
      <P>We can limit or suspend an account that breaks these rules or puts others at risk.</P>

      <H>5. Plans and payments</H>
      <P>Paid plans are sold through Gumroad and renew until you cancel. Limits for each plan are shown in the app and refresh in time windows. If your plan lapses you return to the Free plan. Refunds follow the rules shown at checkout. Prices can change for future renewals with notice.</P>

      <H>6. Your content</H>
      <P>You own your content. You give us the right to store and process it only to run the service for you (including sending it to the AI providers and tools you choose). We do not sell your content.</P>

      <H>7. Third-party services</H>
      <P>When you connect Gmail, Slack, GitHub, an MCP server or any other service, that service’s own terms apply and it receives what the agent sends it. We are not responsible for third-party services or for errors they return.</P>

      <H>8. No warranty, limited liability</H>
      <P>The service is provided “as is”, without promises that it will be uninterrupted or error-free. To the extent the law allows, we are not liable for indirect or consequential losses, lost profits, lost data, or for decisions you take based on agent output, and our total liability is limited to what you paid us in the 3 months before the claim. Nothing here limits liability that cannot be limited by law.</P>

      <H>9. Ending</H>
      <P>You can stop using the service and delete your account at any time from the <a className="underline" href="/account">Your data</a> page (cancel a paid plan first). We may end the service for an account that breaks these terms.</P>

      <H>10. Changes, law and contact</H>
      <P>We may update these terms; the date above changes and material changes are announced in the app. These terms are governed by the laws of your place of business as stated in the order form, or if none, the laws of India, and disputes go to the courts there, unless your local consumer law says otherwise. Questions: <a className="underline" href={`mailto:${CONTACT}`}>{CONTACT}</a>.</P>
    </LegalPage>
  );
}
