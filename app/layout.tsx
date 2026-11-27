import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { AuthProvider } from "@/lib/auth-context";
import { KeysProvider } from "@/lib/keys-context";
import LimitModal from "@/components/LimitModal";
import NativeBridge from "@/components/NativeBridge";
import RunKeeper from "@/components/agent/RunKeeper";
import ThemeProvider from "@/components/ThemeProvider";
import "./globals.css";
import "./mobile.css";
import "./theme.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const THEME_BOOT = `try{var t=localStorage.getItem("av:theme");document.documentElement.setAttribute("data-theme",t==="light"&&location.pathname!=="/"?"light":"dark")}catch(e){}`;

export const metadata: Metadata = {
  title: "AgenticVenus — AI teammates that finish the work",
  description:
    "Give real work to AI teammates with their own computer. They sign into your tools, work while you're away, and only come back when something needs you.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0a0a0b",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={inter.variable} data-theme="dark" suppressHydrationWarning>
      <head>
        {/* sets the saved theme before the first paint, so there is no dark/light flash */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
      </head>
      <body className="font-sans antialiased">
        <AuthProvider>
          <KeysProvider>{children}</KeysProvider>
          <LimitModal />
          <NativeBridge />
          <RunKeeper />
          <ThemeProvider />
        </AuthProvider>
      </body>
    </html>
  );
}