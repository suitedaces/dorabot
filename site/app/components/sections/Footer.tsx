export function Footer() {
  return (
    <footer className="border-t border-border px-4 py-8 sm:px-8 lg:px-12">
      <div className="mx-auto flex max-w-7xl flex-col items-center gap-4 sm:flex-row sm:justify-between">
        <div className="flex items-center gap-3 text-sm text-text-muted">
          <img src="/dorabot.png" alt="dorabot" width={67} height={91} loading="lazy" className="h-10 w-auto" style={{ imageRendering: "pixelated" }} />
          dorabot
        </div>
        <div className="flex items-center gap-6 text-sm text-text-muted">
          <a
            href="/docs"
            className="hover:text-text transition-colors"
          >
            Docs
          </a>
          <a
            href="https://github.com/suitedaces/dorabot"
            className="hover:text-text transition-colors"
          >
            GitHub
          </a>
          <a
            href="https://discord.gg/FH99jkvMz"
            className="hover:text-text transition-colors"
          >
            Discord
          </a>
          <a
            href="https://twitter.com/ishanxnagpal"
            className="hover:text-text transition-colors"
          >
            Twitter
          </a>
          <span>MIT License</span>
        </div>
      </div>
    </footer>
  )
}
