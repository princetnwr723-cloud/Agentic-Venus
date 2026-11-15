import type { Metadata } from "next";
import BusinessHub from "@/components/business/BusinessHub";

export const metadata: Metadata = { title: "Venus Business Hub — AgenticVenus" };

export default function BusinessPage() {
  return <BusinessHub />;
}
