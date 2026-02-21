import { ScrollReveal, StaggerReveal } from "../scroll-reveal"

const items = [
  {
    label: "Browser automation",
    detail: "90+ actions with your real Chrome profile. Already logged in everywhere.",
  },
  {
    label: "Multi-provider",
    detail: "Claude, OpenAI Codex, MiniMax. Use the model you're already paying for.",
  },
  {
    label: "Multimodal",
    detail: "Send images, screenshots, diagrams. The agent sees them.",
  },
  {
    label: "Multi-pane workspace",
    detail: "Split panes, parallel agents, streaming responses.",
  },
  {
    label: "Local-only & secure",
    detail: "No cloud relay. No telemetry. Your data stays on your Mac.",
  },
  {
    label: "Auto-update",
    detail: "Signed, notarized, one-click updates from GitHub Releases.",
  },
]

export function Also() {
  return (
    <section className="border-t border-border px-4 py-16 sm:px-8 sm:py-20 lg:px-12">
      <div className="mx-auto max-w-7xl">
        <ScrollReveal className="text-center mb-10">
          <h2 className="text-2xl font-bold sm:text-3xl tracking-tight">Also</h2>
        </ScrollReveal>

        <StaggerReveal className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" staggerDelay={0.05}>
          {items.map((item) => (
            <div
              key={item.label}
              className="stagger-item rounded-lg border border-border bg-bg-card/40 p-5"
            >
              <p className="font-medium text-text mb-1">{item.label}</p>
              <p className="text-sm text-text-secondary leading-relaxed">{item.detail}</p>
            </div>
          ))}
        </StaggerReveal>
      </div>
    </section>
  )
}
