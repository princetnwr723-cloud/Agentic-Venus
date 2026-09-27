import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { AuthProvider } from "@/lib/auth-context";
import { KeysProvider } from "@/lib/keys-context";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: "AgenticVenus — AI teammates that finish the work",
  description:
    "Give real work to AI teammates with their own computer. They sign into your tools, work while you're away, and only come back when something needs you.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="font-sans antialiased">
        <AuthProvider>
          <KeysProvider>{children}</KeysProvider>
        </AuthProvider>
      </body>
    </html>
  );
}