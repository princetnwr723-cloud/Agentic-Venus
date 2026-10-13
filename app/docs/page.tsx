import type { Metadata } from "next";
import DocsView from "@/components/docs/DocsView";

export const metadata: Metadata = {
  title: "Docs — AgenticVenus",
  description:
    "Everything about AgenticVenus: the agent, features, security model, architecture, setup, and an honest comparison with OpenClaw, Hermes Agent, Grok bots and OpenAI agents.",
};

export default function DocsPage() {
  return <DocsView />;
}