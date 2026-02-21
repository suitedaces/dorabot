import { Brain, Target, MousePointer2 } from "lucide-react"
import { HoverBorderGradient } from "../aceternity/hover-border-gradient"

function GithubIcon() {
  return (
    <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fillRule="evenodd"
        d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"
        clipRule="evenodd"
      />
    </svg>
  )
}

function ArrowRight() {
  return (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
    </svg>
  )
}

function WhatsAppLogo() {
  return (
    <svg viewBox="0 0 24 24" fill="#25D366" className="h-5 w-5">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
    </svg>
  )
}

function TelegramLogo() {
  return (
    <svg viewBox="0 0 24 24" fill="#26A5E4" className="h-5 w-5">
      <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/>
    </svg>
  )
}

function SlackLogo() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5">
      <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zm1.271 0a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313z" fill="#E01E5A"/>
      <path d="M8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zm0 1.271a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312z" fill="#36C5F0"/>
      <path d="M18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zm-1.27 0a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.163 0a2.528 2.528 0 0 1 2.523 2.522v6.312z" fill="#2EB67D"/>
      <path d="M15.163 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.163 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zm0-1.27a2.527 2.527 0 0 1-2.52-2.523 2.527 2.527 0 0 1 2.52-2.52h6.315A2.528 2.528 0 0 1 24 15.163a2.528 2.528 0 0 1-2.522 2.523h-6.315z" fill="#ECB22E"/>
    </svg>
  )
}

function ClaudeLogo() {
  return (
    <svg viewBox="0 0 256 257" className="h-5 w-5">
      <path d="M50.228 170.321 100.585 142.064l.843-2.463-.843-1.361h-2.463l-8.425-.518-28.776-.778-24.952-1.037-24.174-1.296-6.092-1.296L0 125.796l.583-3.759 5.12-3.434 7.324.648 16.202 1.102 24.304 1.685 17.628 1.037 26.119 2.722h4.148l.583-1.685-1.426-1.037-1.101-.963-25.146-17.045-27.22-18.017-14.258-10.37-7.713-5.25-3.888-4.925-1.685-10.759 7-7.712 9.397.648 2.398.648 9.527 7.323 20.35 15.749 26.572 19.573 3.889 3.24 1.555-1.101.195-.778-1.75-2.916-14.452-26.119-15.425-26.572-6.87-11.018-1.814-6.61c-.649-2.722-1.102-4.99-1.102-7.777l7.971-10.824 4.408-1.426 10.629 1.426 4.471 3.889 6.611 15.1 10.694 23.786 16.591 32.34 4.86 9.592 8.566 8.879.973 2.722h1.685v-1.556l1.361-18.211 2.528-22.36 2.462-28.775.843-8.101 4.018-9.722 7.971-5.25 6.222 2.982 5.12 7.324-.713 4.731-2.333 19.767-5.962 30.98-3.889 20.739h2.268l2.593-2.593 10.499-13.934 17.628-22.035 7.777-8.749 9.074-9.657 5.832-4.601 11.018 0 8.101 12.055-3.63 12.443-11.341 14.388-9.397 12.184-13.481 18.147-8.425 14.517.778 1.167 2.009-.195 30.461-6.481 16.462-2.981 19.637-3.37 8.879 4.148.973 4.212-3.5 8.62-21 5.184-24.627 4.926-36.683 8.684-.454.324.519.648 16.527 1.556 7.063.388 17.305 0 32.21 2.398 8.426 5.574 5.055 6.805-.843 5.184-12.962 6.611-17.499-4.148-40.83-9.722-13.999-3.5h-1.944v1.167l11.666 11.406 21.387 19.314 26.767 24.887 1.361 6.157-3.435 4.86-3.63-.518-23.525-17.693-9.074-7.972-20.544-17.304-1.361 0v1.815l4.731 6.934 25.017 37.59 1.296 11.536-1.815 3.759-6.481 2.268-7.129-1.296-14.647-20.545-15.1-23.137-12.184-20.739-1.491.843-7.194 77.29-3.37 3.953-7.777 2.982-6.481-4.926-3.435-7.972 3.435-15.749 4.148-20.544 3.37-16.333 3.046-20.286 1.815-6.74-.13-.454-1.491.195-15.296 21-23.266 31.433-18.406 19.702-4.407 1.75-7.648-3.953.713-7.064 4.277-6.287 25.471-32.405 15.36-20.091 9.916-11.601-.065-1.685-.583 0L44.071 198.125l-12.055 1.555-5.184-4.86.648-7.972 2.462-2.593 20.35-13.999-.064-.065Z" fill="#D97757"/>
    </svg>
  )
}

function OpenAILogo() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5 text-[#10A37F]">
      <path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.676l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.872zm16.597 3.855l-5.833-3.387L15.119 7.2a.076.076 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.407-.667zm2.01-3.023l-.141-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135l-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08L8.704 5.46a.795.795 0 0 0-.393.681zm1.097-2.365l2.602-1.5 2.607 1.5v2.999l-2.597 1.5-2.607-1.5z"/>
    </svg>
  )
}

export function Hero() {
  return (
    <section className="relative flex flex-col items-center justify-center overflow-hidden px-4 pt-20 pb-14 sm:px-8 sm:pt-24 sm:pb-16 lg:px-12 lg:pt-28">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[400px] bg-accent/5 blur-[120px] rounded-full" />
      </div>

      <div className="relative z-10 mx-auto w-full max-w-7xl">
        <div className="mb-4 flex justify-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-border bg-bg-card/40 px-3.5 py-2 text-xs text-text-secondary sm:px-5 sm:py-2.5 sm:text-sm">
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-green animate-pulse" />
            Open-Source · 100% private · 100% local
          </div>
        </div>

        <div className="text-center">
          <div className="mb-6 flex justify-center">
            <img
              src="/dorabot.png"
              alt="dorabot"
              width={67}
              height={91}
              decoding="async"
              fetchPriority="high"
              className="h-28 w-auto dorabot-alive sm:h-32"
              style={{ imageRendering: "pixelated" }}
            />
          </div>

          <h1 className="mx-auto max-w-4xl text-center tracking-tight">
            <span className="block bg-gradient-to-r from-accent via-purple to-accent bg-clip-text text-2xl font-bold leading-[1.08] text-transparent sm:text-4xl md:text-5xl">
              Your 24x7 self-learning AI agent
            </span>
            <span className="mt-2 block text-lg font-medium text-text sm:text-xl md:text-2xl">
              with a workspace that runs itself.
            </span>
          </h1>

          <div className="mx-auto mt-6 flex max-w-4xl flex-wrap items-center justify-center gap-2 sm:gap-3 hero-stagger hero-stagger-4">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-bg-card/70 px-2.5 py-1.5 text-xs font-medium text-text sm:px-3 sm:text-base">
              <Brain className="h-4 w-4 text-accent" />
              Persistent memory
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-bg-card/70 px-2.5 py-1.5 text-xs font-medium text-text sm:px-3 sm:text-base">
              <Target className="h-4 w-4 text-accent" />
              Autonomous goals
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-bg-card/70 px-2.5 py-1.5 text-xs font-medium text-text sm:px-3 sm:text-base">
              <MousePointer2 className="h-4 w-4 text-accent" />
              Browser automation
            </span>
          </div>

          <div className="mt-6 flex flex-col items-center gap-3 sm:gap-4 hero-stagger hero-stagger-5">
            <div className="flex flex-wrap items-center justify-center gap-2 text-xs text-text-secondary sm:text-sm">
              <span>Available on</span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-bg-card/50 px-2.5 py-1.5 text-text sm:px-3">
                <TelegramLogo /> Telegram
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-bg-card/50 px-2.5 py-1.5 text-text sm:px-3">
                <WhatsAppLogo /> WhatsApp
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-bg-card/50 px-2.5 py-1.5 text-text sm:px-3">
                <SlackLogo /> Slack
              </span>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-2 text-xs text-text-secondary sm:text-sm">
              <span>Compatible with</span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-bg-card/50 px-2.5 py-1.5 text-text sm:px-3">
                <ClaudeLogo /> Claude Code
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-bg-card/50 px-2.5 py-1.5 text-text sm:px-3">
                <OpenAILogo /> Codex
              </span>
            </div>
          </div>

          <div className="mt-10 flex w-full max-w-xl flex-col items-center gap-3 sm:max-w-none sm:flex-row sm:justify-center sm:gap-4 hero-stagger hero-stagger-6">
            <a href="/api/download">
              <HoverBorderGradient containerClassName="w-full rounded-lg border border-white sm:w-auto" as="div">
                <span className="flex w-full items-center justify-center gap-3 px-3 py-2 text-base font-medium text-text">
                  <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24"><path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/></svg>
                  Download for macOS
                  <ArrowRight />
                </span>
              </HoverBorderGradient>
            </a>
            <a href="https://github.com/suitedaces/dorabot" className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-border bg-bg-card/50 px-4 text-sm text-text transition-colors hover:text-accent sm:h-auto sm:w-auto sm:border-0 sm:bg-transparent sm:px-0">
              <GithubIcon />
              View on GitHub
            </a>
          </div>

        </div>
      </div>
    </section>
  )
}
