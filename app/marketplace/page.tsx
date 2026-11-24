import type { Metadata } from "next";
import MarketplaceHub from "@/components/marketplace/MarketplaceHub";

export const metadata: Metadata = { title: "Marketplace — AgenticVenus" };

export default function MarketplacePage() {
  return <MarketplaceHub />;
}
