import type { Metadata } from "next";
import { JetBrains_Mono } from "next/font/google";
import "./globals.css";

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains",
  display: "swap",
});

export const metadata: Metadata = {
  title: "dorabot - Your 24/7 AI agent for macOS",
  description:
    "Open-source, private, local-first AI agent. Run dozens of agents in parallel. Browser automation, scheduling, memory, Telegram, WhatsApp, Slack. Built on Claude Code.",
  metadataBase: new URL("https://dora.so"),
  openGraph: {
    title: "dorabot - Your 24/7 AI agent for macOS",
    description:
      "Open-source, private, local-first AI agent. Run dozens of agents in parallel. Browser automation, scheduling, memory, messaging.",
    type: "website",
    url: "https://dora.so",
    siteName: "dorabot",
    images: [
      {
        url: "/og.jpg",
        width: 1200,
        height: 630,
        alt: "dorabot - AI agent workspace",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "dorabot - Your 24/7 AI agent for macOS",
    description:
      "Open-source, private, local-first AI agent. Browser automation, scheduling, memory, messaging. Built on Claude Code.",
    images: ["/og.jpg"],
    creator: "@ishanxnagpal",
  },
  icons: {
    icon: "/favicon.png",
    apple: "/dorabot.png",
  },
  keywords: [
    "AI agent",
    "Claude Code",
    "macOS app",
    "open source",
    "local AI",
    "browser automation",
    "personal AI",
    "agentic development",
    "Telegram bot",
    "AI workspace",
  ],
  robots: {
    index: true,
    follow: true,
  },
  alternates: {
    canonical: "https://dora.so",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`dark ${jetbrainsMono.variable}`} suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://pub-4316e19c5e0c4561879dabd80ec994f7.r2.dev" />
      </head>
      <body className="antialiased">{children}</body>
    </html>
  );
}
