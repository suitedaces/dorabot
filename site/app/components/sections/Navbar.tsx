"use client"

import { useEffect, useState } from "react"

function GithubIcon() {
  return (
    <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fillRule="evenodd"
        d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"
        clipRule="evenodd"
      />
    </svg>
  )
}

function DiscordIcon() {
  return (
    <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
    </svg>
  )
}

export function Navbar() {
  const [theme, setTheme] = useState<"dark" | "light">("dark")
  const [mobileOpen, setMobileOpen] = useState(false)

  useEffect(() => {
    const saved = localStorage.getItem("dorabot-site-theme")
    const initial: "dark" | "light" = saved === "light" ? "light" : "dark"
    setTheme(initial)
    document.documentElement.classList.toggle("dark", initial === "dark")
  }, [])

  const toggleTheme = () => {
    setTheme((prev) => {
      const next = prev === "dark" ? "light" : "dark"
      document.documentElement.classList.toggle("dark", next === "dark")
      localStorage.setItem("dorabot-site-theme", next)
      return next
    })
  }

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border bg-bg/95 sm:backdrop-blur-sm sm:bg-bg/80">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:px-8 lg:px-12">
        <div className="flex items-center gap-6">
          <a href="/" className="flex items-center gap-1.5">
            <img
              src="/dorabot.png"
              alt="dorabot"
              width={67}
              height={91}
              decoding="async"
              className="h-9 w-auto dorabot-alive"
              style={{ imageRendering: "pixelated" }}
            />
            <span className="text-sm font-medium text-text-secondary">dorabot</span>
          </a>
          <nav className="hidden sm:flex items-center gap-6">
            <a href="/docs" className="text-sm text-text-muted hover:text-text transition-colors">Docs</a>
            <a href="/#features" className="text-sm text-text-muted hover:text-text transition-colors">Features</a>
          </nav>
        </div>
        <div className="flex items-center gap-2">
          <a
            href="https://discord.gg/FH99jkvMz"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-text-muted hover:text-text hover:bg-surface-mid transition-colors"
            aria-label="Discord"
          >
            <DiscordIcon />
          </a>
          <button
            onClick={toggleTheme}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-text-muted hover:text-text hover:bg-surface-mid transition-colors"
            aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          >
            {theme === "dark" ? (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4">
                <circle cx="12" cy="12" r="4" />
                <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4">
                <path d="M21 12.79A9 9 0 1111.21 3c0 .28.01.56.04.84A7 7 0 0021 12.79z" />
              </svg>
            )}
          </button>
          <a
            href="https://github.com/suitedaces/dorabot"
            className="star-glow hidden sm:inline-flex items-center gap-2 rounded-lg border border-accent/40 bg-bg-card px-4 py-2 text-sm font-medium text-text"
          >
            <GithubIcon />
            <span>Star on GitHub</span>
            <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4 text-yellow-400"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" /></svg>
          </a>
          <button
            onClick={() => setMobileOpen(v => !v)}
            className="sm:hidden inline-flex h-8 w-8 items-center justify-center rounded-md text-text-muted hover:text-text hover:bg-surface-mid transition-colors"
            aria-label="Toggle menu"
          >
            {mobileOpen ? (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4">
                <path d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            )}
          </button>
        </div>
      </div>
      {mobileOpen && (
        <div className="sm:hidden border-t border-border px-4 py-3">
          <a href="/docs" onClick={() => setMobileOpen(false)} className="block py-2 text-sm text-text-muted hover:text-text">
            Docs
          </a>
          <a href="/#features" onClick={() => setMobileOpen(false)} className="block py-2 text-sm text-text-muted hover:text-text">
            Features
          </a>
          <a href="https://github.com/suitedaces/dorabot" className="flex items-center gap-1.5 py-2 text-sm text-text-muted hover:text-text">
            <GithubIcon /> Star on GitHub
          </a>
          <a href="https://discord.gg/FH99jkvMz" className="flex items-center gap-1.5 py-2 text-sm text-text-muted hover:text-text">
            <DiscordIcon /> Discord
          </a>
        </div>
      )}
    </header>
  )
}
