import Link from "next/link";
import type { ReactNode } from "react";

export const COMPANY = process.env.NEXT_PUBLIC_COMPANY_NAME || "AgenticVenus";
export const CONTACT = process.env.NEXT_PUBLIC_CONTACT_EMAIL || "support@your-domain.com";
export const UPDATED = "22 November 2026";

export function H({ children }: { children: ReactNode }) {
  return <h2 className="mt-8 text-base font-medium text-ink">{children}</h2>;
}
export function P({ children }: { children: ReactNode }) {
  return <p className="mt-2 text-sm leading-relaxed text-muted">{children}</p>;
}
export function L({ items }: { items: ReactNode[] }) {
  return (
    <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-muted">
      {items.map((x, i) => <li key={i}>{x}</li>)}
    </ul>
  );
}

export default function LegalPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="min-h-screen bg-bg px-5 py-10 text-ink">
      <div className="mx-auto max-w-2xl">
        <Link href="/" className="text-xs text-muted hover:text-ink">← {COMPANY}</Link>
        <h1 className="mt-4 text-2xl font-semibold">{title}</h1>
        <p className="mt-1 text-xs text-faint">Last updated {UPDATED}</p>
        {children}
        <div className="mt-10 flex flex-wrap gap-4 border-t border-line pt-4 text-xs text-muted">
          <Link href="/terms" className="hover:text-ink">Terms</Link>
          <Link href="/privacy" className="hover:text-ink">Privacy</Link>
          <Link href="/status" className="hover:text-ink">Status</Link>
          <Link href="/account" className="hover:text-ink">Your data</Link>
          <a href={`mailto:${CONTACT}`} className="hover:text-ink">{CONTACT}</a>
        </div>
      </div>
    </main>
  );
}
