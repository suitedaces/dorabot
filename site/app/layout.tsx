import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "dorabot - Open-source personal AI agent",
  description:
    "Turn Claude Code and Codex into your personal AI assistant. Chat on WhatsApp, Telegram, Slack. Browse the web. Control your Mac. Runs locally, bring your own model.",
  openGraph: {
    title: "dorabot - Open-source personal AI agent",
    description:
      "Turn Claude Code and Codex into your personal AI assistant. Chat on WhatsApp, Telegram, Slack. Browse the web. Control your Mac.",
    type: "website",
    url: "https://dorabot.dev",
  },
  twitter: {
    card: "summary_large_image",
    title: "dorabot - Open-source personal AI agent",
    description:
      "Turn Claude Code and Codex into your personal AI assistant. Runs locally, bring your own model.",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:ital,wght@0,100..800;1,100..800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="antialiased">{children}</body>
    </html>
  );
}
