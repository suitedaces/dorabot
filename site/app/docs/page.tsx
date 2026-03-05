"use client"

import { useEffect, useState } from "react"
import { Navbar } from "../components/sections/Navbar"
import { Footer } from "../components/sections/Footer"

const sections = [
  { id: "getting-started", label: "Getting Started" },
  { id: "workspace", label: "Workspace" },
  { id: "memory", label: "Memory" },
  { id: "goals-tasks", label: "Goals & Tasks" },
  { id: "research", label: "Research" },
  { id: "messaging", label: "Messaging" },
  { id: "browser", label: "Browser Automation" },
  { id: "scheduling", label: "Scheduling" },
  { id: "skills", label: "Skills" },
  { id: "configuration", label: "Configuration" },
  { id: "cli", label: "CLI" },
  { id: "security", label: "Security" },
]

function CodeBlock({ children, title }: { children: string; title?: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface-base/60 overflow-hidden">
      {title && (
        <div className="border-b border-border px-4 py-2 text-xs text-text-muted">
          {title}
        </div>
      )}
      <pre className="overflow-x-auto p-4 text-sm leading-relaxed">
        <code>{children}</code>
      </pre>
    </div>
  )
}

function InlineCode({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded border border-border bg-surface-base/60 px-1.5 py-0.5 text-[13px]">
      {children}
    </code>
  )
}

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-20">
      <h2 className="text-xl font-bold sm:text-2xl tracking-tight mb-4">{title}</h2>
      <div className="space-y-4 text-sm sm:text-base text-text-secondary leading-relaxed">
        {children}
      </div>
    </section>
  )
}

function SubSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-base font-semibold text-text mb-2">{title}</h3>
      <div className="space-y-3">{children}</div>
    </div>
  )
}

export default function DocsPage() {
  const [active, setActive] = useState("getting-started")
  const [sidebarOpen, setSidebarOpen] = useState(false)

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActive(entry.target.id)
          }
        }
      },
      { rootMargin: "-80px 0px -60% 0px" }
    )

    for (const s of sections) {
      const el = document.getElementById(s.id)
      if (el) observer.observe(el)
    }
    return () => observer.disconnect()
  }, [])

  return (
    <div className="min-h-screen bg-bg">
      <Navbar />

      <div className="mx-auto max-w-7xl px-4 sm:px-8 lg:px-12">
        <div className="flex gap-12 py-10 sm:py-14">
          {/* Sidebar */}
          <aside className="hidden lg:block w-56 shrink-0">
            <nav className="sticky top-20 space-y-0.5">
              <p className="text-xs font-semibold uppercase tracking-wider text-text-muted mb-3">
                Documentation
              </p>
              {sections.map((s) => (
                <a
                  key={s.id}
                  href={`#${s.id}`}
                  className={`block rounded-md px-3 py-1.5 text-sm transition-colors ${
                    active === s.id
                      ? "bg-accent/10 text-accent font-medium"
                      : "text-text-muted hover:text-text hover:bg-surface-mid/50"
                  }`}
                >
                  {s.label}
                </a>
              ))}
            </nav>
          </aside>

          {/* Mobile sidebar toggle */}
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="lg:hidden fixed bottom-6 right-6 z-50 rounded-full bg-accent px-4 py-2.5 text-sm font-medium text-white shadow-lg"
          >
            {sidebarOpen ? "Close" : "Sections"}
          </button>

          {sidebarOpen && (
            <div className="lg:hidden fixed inset-0 z-40 bg-bg/95 backdrop-blur-sm pt-20 px-6 overflow-y-auto">
              <nav className="space-y-1">
                {sections.map((s) => (
                  <a
                    key={s.id}
                    href={`#${s.id}`}
                    onClick={() => setSidebarOpen(false)}
                    className={`block rounded-md px-3 py-2.5 text-base ${
                      active === s.id
                        ? "bg-accent/10 text-accent font-medium"
                        : "text-text-muted"
                    }`}
                  >
                    {s.label}
                  </a>
                ))}
              </nav>
            </div>
          )}

          {/* Content */}
          <main className="min-w-0 flex-1 space-y-14">
            <div>
              <h1 className="text-3xl font-bold sm:text-4xl tracking-tight">
                Documentation
              </h1>
              <p className="mt-3 text-base text-text-secondary max-w-2xl">
                Everything you need to set up and use dorabot: your 24/7 self-learning AI agent with persistent memory, autonomous goals, and multi-channel messaging.
              </p>
            </div>

            {/* Getting Started */}
            <Section id="getting-started" title="Getting Started">
              <SubSection title="Installation">
                <p>
                  Download the latest release from{" "}
                  <a href="https://github.com/suitedaces/dorabot/releases" className="text-accent hover:underline">
                    GitHub Releases
                  </a>{" "}
                  or click "Download for macOS" on the homepage. Open the DMG and drag dorabot to your Applications folder.
                </p>
                <p>
                  dorabot is a signed and notarized macOS app. It runs entirely on your machine with no cloud relay.
                </p>
              </SubSection>

              <SubSection title="First launch">
                <p>
                  On first launch, the onboarding flow will walk you through:
                </p>
                <ol className="list-decimal list-inside space-y-1.5 pl-1">
                  <li>Setting your AI provider API key (Claude, OpenAI, or MiniMax)</li>
                  <li>Telling the agent who you are (saved to <InlineCode>USER.md</InlineCode>)</li>
                  <li>Defining the agent's personality (saved to <InlineCode>SOUL.md</InlineCode>)</li>
                </ol>
                <p>
                  All configuration is stored locally in <InlineCode>~/.dorabot/</InlineCode>.
                </p>
              </SubSection>

              <SubSection title="Requirements">
                <ul className="list-disc list-inside space-y-1.5 pl-1">
                  <li>macOS (Apple Silicon or Intel)</li>
                  <li>An API key for Claude (Anthropic) or OpenAI Codex</li>
                  <li>Node.js 22+ (for CLI / development mode)</li>
                </ul>
              </SubSection>
            </Section>

            {/* Workspace */}
            <Section id="workspace" title="Workspace">
              <p>
                The workspace is a set of markdown files the agent loads every session. They live in{" "}
                <InlineCode>~/.dorabot/workspace/</InlineCode> and are fully user-editable.
              </p>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="rounded-lg border border-border bg-bg-card/40 p-4">
                  <p className="font-medium text-text mb-1">SOUL.md</p>
                  <p className="text-sm text-text-secondary">
                    The agent's persona and tone. Keep it short (5-10 lines). This shapes how the agent communicates.
                  </p>
                </div>
                <div className="rounded-lg border border-border bg-bg-card/40 p-4">
                  <p className="font-medium text-text mb-1">USER.md</p>
                  <p className="text-sm text-text-secondary">
                    Who you are: your name, goals, context, communication style. The agent reads this to understand you.
                  </p>
                </div>
                <div className="rounded-lg border border-border bg-bg-card/40 p-4">
                  <p className="font-medium text-text mb-1">MEMORY.md</p>
                  <p className="text-sm text-text-secondary">
                    Persistent facts and preferences. The agent updates this as it learns about you. Capped at 500 lines.
                  </p>
                </div>
                <div className="rounded-lg border border-border bg-bg-card/40 p-4">
                  <p className="font-medium text-text mb-1">AGENTS.md</p>
                  <p className="text-sm text-text-secondary">
                    Optional agent-specific instructions. Use this for specialized behavior overrides.
                  </p>
                </div>
              </div>

              <p>
                Edit these files from the desktop app's Soul tab, or directly in your editor. Changes take effect on the next session.
              </p>
            </Section>

            {/* Memory */}
            <Section id="memory" title="Memory">
              <p>
                dorabot has two layers of memory: curated working memory and detailed daily journals.
              </p>

              <SubSection title="Working memory (MEMORY.md)">
                <p>
                  The agent maintains <InlineCode>MEMORY.md</InlineCode> with stable facts: your preferences, active projects, decisions, and context. This is loaded every session and kept under 500 lines.
                </p>
              </SubSection>

              <SubSection title="Daily journals">
                <p>
                  Detailed logs of what the agent did, learned, and found each day. Stored at{" "}
                  <InlineCode>~/.dorabot/workspace/memories/YYYY-MM-DD/MEMORY.md</InlineCode> with timestamped entries. The 3 most recent journals are loaded into context automatically.
                </p>
              </SubSection>

              <SubSection title="Memory search">
                <p>
                  Full-text search (SQLite FTS5) across all past conversations. The agent can search by query, channel, origin (pulse, scheduled task, desktop, telegram, whatsapp), and date range.
                </p>
                <CodeBlock>{`// Example: search for past conversations about a topic
memory_search({ query: "deployment pipeline", after: "2026-03-01" })`}</CodeBlock>
              </SubSection>
            </Section>

            {/* Goals & Tasks */}
            <Section id="goals-tasks" title="Goals & Tasks">
              <p>
                The planning pipeline lets the agent propose, plan, and execute work autonomously with human approval gates.
              </p>

              <SubSection title="Goals">
                <p>
                  High-level outcomes with short, durable titles. Goals track status: <InlineCode>active</InlineCode>,{" "}
                  <InlineCode>paused</InlineCode>, or <InlineCode>done</InlineCode>. The agent can propose goals based on context, or you can create them directly.
                </p>
              </SubSection>

              <SubSection title="Tasks">
                <p>
                  Concrete work items linked to goals. Every task follows a status flow:
                </p>
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  {["planning", "planned", "approved", "in_progress", "done"].map((s, i) => (
                    <span key={s} className="flex items-center gap-2">
                      <span className="inline-flex items-center rounded-full border border-border bg-bg-card/50 px-2.5 py-1 text-xs font-medium text-text">
                        {s}
                      </span>
                      {i < 4 && <span className="text-text-muted">&rarr;</span>}
                    </span>
                  ))}
                </div>
                <p>
                  The agent writes a detailed plan (PLAN.md) for each task before submitting it for approval. You review and approve from the desktop app or Telegram.
                </p>
              </SubSection>

              <SubSection title="Plan format">
                <p>Each task plan includes:</p>
                <ul className="list-disc list-inside space-y-1 pl-1">
                  <li>Objective: what the task achieves</li>
                  <li>Context: background and dependencies</li>
                  <li>Execution plan: step-by-step approach</li>
                  <li>Risks: what could go wrong</li>
                  <li>Validation: how to verify success</li>
                </ul>
              </SubSection>
            </Section>

            {/* Research */}
            <Section id="research" title="Research">
              <p>
                The agent creates and maintains structured research items on topics you're investigating. Each item is a markdown file with YAML frontmatter stored in{" "}
                <InlineCode>~/.dorabot/research/</InlineCode>.
              </p>

              <SubSection title="How it works">
                <p>
                  Research items have a title, topic, content, tags, and sources. They can be{" "}
                  <InlineCode>active</InlineCode>, <InlineCode>completed</InlineCode>, or{" "}
                  <InlineCode>archived</InlineCode>. The agent creates research items when exploring a topic and updates them as it learns more.
                </p>
                <p>
                  All research is full-text indexed via SQLite, so the agent can search across all items.
                </p>
              </SubSection>
            </Section>

            {/* Messaging */}
            <Section id="messaging" title="Messaging">
              <p>
                Connect dorabot to your messaging channels. Same agent, same memory, same context, any channel.
              </p>

              <div className="grid gap-4 sm:grid-cols-3">
                <div className="rounded-lg border border-border bg-bg-card/40 p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <svg viewBox="0 0 24 24" fill="#26A5E4" className="h-5 w-5">
                      <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
                    </svg>
                    <p className="font-medium text-text">Telegram</p>
                  </div>
                  <p className="text-sm text-text-secondary">
                    Connect via bot token. DM and group support. Inline keyboard for task approvals. Markdown rendering.
                  </p>
                </div>
                <div className="rounded-lg border border-border bg-bg-card/40 p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <svg viewBox="0 0 24 24" fill="#25D366" className="h-5 w-5">
                      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
                    </svg>
                    <p className="font-medium text-text">WhatsApp</p>
                  </div>
                  <p className="text-sm text-text-secondary">
                    Connect via QR code. DM and group support. Send text, photos, voice, documents.
                  </p>
                </div>
                <div className="rounded-lg border border-border bg-bg-card/40 p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <svg viewBox="0 0 24 24" className="h-5 w-5">
                      <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zm1.271 0a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313z" fill="#E01E5A" />
                      <path d="M8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zm0 1.271a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312z" fill="#36C5F0" />
                      <path d="M18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zm-1.27 0a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.163 0a2.528 2.528 0 0 1 2.523 2.522v6.312z" fill="#2EB67D" />
                      <path d="M15.163 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.163 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zm0-1.27a2.527 2.527 0 0 1-2.52-2.523 2.527 2.527 0 0 1 2.52-2.52h6.315A2.528 2.528 0 0 1 24 15.163a2.528 2.528 0 0 1-2.522 2.523h-6.315z" fill="#ECB22E" />
                    </svg>
                    <p className="font-medium text-text">Slack</p>
                  </div>
                  <p className="text-sm text-text-secondary">
                    Connect via bot token. Channels and DMs. Thread-aware responses.
                  </p>
                </div>
              </div>

              <SubSection title="Session keys">
                <p>
                  Each conversation is identified by a session key:{" "}
                  <InlineCode>channel:chatType:chatId</InlineCode>. For example,{" "}
                  <InlineCode>telegram:dm:123456</InlineCode> or{" "}
                  <InlineCode>whatsapp:group:xyz@g.us</InlineCode>. The agent maintains full context across all channels.
                </p>
              </SubSection>

              <SubSection title="Tool approval">
                <p>
                  When the agent wants to take an action on a messaging channel, it goes through a 3-tier approval system:
                </p>
                <ul className="list-disc list-inside space-y-1 pl-1">
                  <li><strong>Auto-allow</strong>: trusted tools run immediately</li>
                  <li><strong>Notify</strong>: you're told before execution</li>
                  <li><strong>Require approval</strong>: you must confirm (5-minute timeout)</li>
                </ul>
              </SubSection>
            </Section>

            {/* Browser */}
            <Section id="browser" title="Browser Automation">
              <p>
                dorabot includes full browser automation via Playwright and Chrome DevTools Protocol. It uses a persistent Chrome profile, so it's already logged into your accounts.
              </p>

              <SubSection title="Capabilities">
                <p>37+ browser actions including:</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {[
                    "Navigate, reload, go back/forward",
                    "Click, double-click, hover, drag",
                    "Type, fill forms, select dropdowns",
                    "Take screenshots and DOM snapshots",
                    "Execute JavaScript in page context",
                    "Upload files, handle dialogs",
                    "Inspect console logs and network",
                    "Export pages as PDF",
                  ].map((item) => (
                    <div key={item} className="flex items-start gap-2 text-sm">
                      <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                      {item}
                    </div>
                  ))}
                </div>
              </SubSection>

              <SubSection title="Persistent profile">
                <p>
                  The browser profile lives at <InlineCode>~/.dorabot/browser/profile/</InlineCode>. Since it's your real Chrome profile, the agent can access any site you're already logged into: dashboards, admin panels, internal tools.
                </p>
              </SubSection>
            </Section>

            {/* Scheduling */}
            <Section id="scheduling" title="Scheduling">
              <p>
                dorabot uses RFC 5545 iCal RRULE scheduling for recurring tasks, reminders, and the autonomy pulse.
              </p>

              <SubSection title="Autonomy pulse">
                <p>
                  The autonomy pulse is a recurring background task (configurable: 15m, 30m, 1h, 2h) where the agent wakes up and runs through its priority loop:
                </p>
                <ol className="list-decimal list-inside space-y-1 pl-1">
                  <li>Advance in-progress tasks</li>
                  <li>Monitor things (deployments, PRs, prices)</li>
                  <li>Follow up with you</li>
                  <li>Handle blockers</li>
                  <li>Research and prepare</li>
                  <li>Propose goals and tasks</li>
                  <li>Create momentum</li>
                </ol>
              </SubSection>

              <SubSection title="Scheduled items">
                <p>
                  Create events, todos, and reminders with full RRULE support. Timezone-aware with automatic DST handling. Syncs with Apple Calendar so items show up on your Watch and iPhone.
                </p>
                <CodeBlock>{`// Daily standup reminder at 9am PST
schedule({
  summary: "Daily standup",
  message: "Time for standup. Check goals and tasks.",
  dtstart: "2026-03-01T09:00:00",
  rrule: "FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR;BYHOUR=9;BYMINUTE=0",
  timezone: "America/Los_Angeles"
})`}</CodeBlock>
              </SubSection>
            </Section>

            {/* Skills */}
            <Section id="skills" title="Skills">
              <p>
                Skills are markdown files with instructions that get injected into the agent's context when relevant. They give the agent specialized knowledge for specific tasks.
              </p>

              <SubSection title="Built-in skills">
                <div className="grid gap-2 sm:grid-cols-2">
                  {[
                    { name: "github", desc: "PR creation, issue management, repo operations" },
                    { name: "review-pr", desc: "Code review with structured feedback" },
                    { name: "macos", desc: "System automation and app control" },
                    { name: "himalaya", desc: "Email via CLI (read, send, search)" },
                    { name: "agent-swarm", desc: "Orchestrate multiple parallel agents" },
                    { name: "onboard", desc: "New user setup and personality calibration" },
                  ].map((s) => (
                    <div key={s.name} className="flex items-start gap-2 text-sm">
                      <InlineCode>{s.name}</InlineCode>
                      <span className="text-text-secondary">{s.desc}</span>
                    </div>
                  ))}
                </div>
              </SubSection>

              <SubSection title="Custom skills">
                <p>
                  Drop a markdown file in <InlineCode>~/.dorabot/skills/</InlineCode> with YAML frontmatter:
                </p>
                <CodeBlock title="~/.dorabot/skills/deploy.md">{`---
name: deploy
description: "Deploy the app to production"
user-invocable: true
metadata:
  requires:
    bins: [git, ssh]
    env: [DEPLOY_KEY]
---

# Deploy

Steps to deploy the application...`}</CodeBlock>
                <p>
                  Skills are matched to prompts via keyword matching on the name and description. Eligibility checks verify required binaries, environment variables, and config keys.
                </p>
              </SubSection>

              <SubSection title="MCP servers">
                <p>
                  Connect 7,300+ community MCP servers via{" "}
                  <a href="https://smithery.ai" className="text-accent hover:underline">Smithery</a>.
                  Browse and install from the Skills tab in the desktop app.
                </p>
              </SubSection>
            </Section>

            {/* Configuration */}
            <Section id="configuration" title="Configuration">
              <p>
                Configuration is loaded from <InlineCode>~/.dorabot/config.json</InlineCode> (or <InlineCode>./dorabot.config.json</InlineCode> in a project, or <InlineCode>--config</InlineCode> flag).
              </p>

              <SubSection title="Key settings">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-left">
                        <th className="py-2 pr-4 font-medium text-text">Setting</th>
                        <th className="py-2 pr-4 font-medium text-text">Default</th>
                        <th className="py-2 font-medium text-text">Description</th>
                      </tr>
                    </thead>
                    <tbody className="text-text-secondary">
                      {[
                        ["model", "claude-sonnet-4-5", "Default model for conversations"],
                        ["provider", "claude", "AI provider: claude or codex"],
                        ["autonomy", "supervised", "supervised or autonomous"],
                        ["permissionMode", "default", "default, acceptEdits, bypassPermissions, plan"],
                        ["sandbox.enabled", "false", "Enable sandboxed execution"],
                        ["channels.telegram.enabled", "false", "Enable Telegram channel"],
                        ["channels.whatsapp.enabled", "false", "Enable WhatsApp channel"],
                      ].map(([setting, def, desc]) => (
                        <tr key={setting} className="border-b border-border/50">
                          <td className="py-2 pr-4"><InlineCode>{setting}</InlineCode></td>
                          <td className="py-2 pr-4 text-text-muted">{def}</td>
                          <td className="py-2">{desc}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </SubSection>

              <SubSection title="Autonomy modes">
                <ul className="list-disc list-inside space-y-1.5 pl-1">
                  <li>
                    <strong>Supervised</strong> (default): the agent asks before sending messages, taking destructive actions, or making public posts.
                  </li>
                  <li>
                    <strong>Autonomous</strong>: the agent acts on its own, confirming only before irreversible operations (force-push, deleting data) or spending money.
                  </li>
                </ul>
              </SubSection>
            </Section>

            {/* CLI */}
            <Section id="cli" title="CLI">
              <SubSection title="Running modes">
                <CodeBlock>{`# Production gateway (daemon mode)
dorabot -g

# Interactive terminal REPL
dorabot -i

# One-off question
dorabot -m "What's on my calendar today?"

# Development mode (gateway + desktop with HMR)
npm run dev

# CLI dev mode with auto-reload
npm run dev:cli`}</CodeBlock>
              </SubSection>

              <SubSection title="Interactive commands">
                <div className="grid gap-2 sm:grid-cols-2">
                  {[
                    ["/new", "Start a new session"],
                    ["/resume <id>", "Resume a previous session"],
                    ["/sessions", "List all sessions"],
                    ["/skills", "List eligible skills"],
                    ["/agents", "List available agents"],
                    ["/schedule", "Show scheduled items"],
                    ["/channels", "Show channel status"],
                    ["/exit", "Quit the REPL"],
                  ].map(([cmd, desc]) => (
                    <div key={cmd} className="flex items-start gap-2 text-sm">
                      <InlineCode>{cmd}</InlineCode>
                      <span className="text-text-secondary">{desc}</span>
                    </div>
                  ))}
                </div>
              </SubSection>
            </Section>

            {/* Security */}
            <Section id="security" title="Security">
              <p>
                dorabot is local-first with no cloud relay. Your data stays on your machine.
              </p>

              <SubSection title="Always-denied paths">
                <p>
                  The agent can never read or write these paths, regardless of configuration:
                </p>
                <CodeBlock>{`~/.ssh
~/.gnupg
~/.aws
~/.dorabot/whatsapp/auth
~/.dorabot/gateway-token`}</CodeBlock>
              </SubSection>

              <SubSection title="Gateway authentication">
                <p>
                  The desktop app communicates with the agent via a Unix domain socket at{" "}
                  <InlineCode>~/.dorabot/gateway.sock</InlineCode>. Authentication uses a 64-character hex token stored locally. No network ports are opened.
                </p>
              </SubSection>

              <SubSection title="Sandbox modes">
                <ul className="list-disc list-inside space-y-1 pl-1">
                  <li><strong>Off</strong>: no sandboxing (default)</li>
                  <li><strong>Non-main</strong>: sandbox messaging channels but not desktop</li>
                  <li><strong>All</strong>: sandbox everything</li>
                </ul>
              </SubSection>
            </Section>

            {/* Bottom CTA */}
            <div className="rounded-xl border border-border bg-bg-card/30 p-8 text-center">
              <h2 className="text-xl font-bold mb-2">Ready to get started?</h2>
              <p className="text-text-secondary mb-6">
                Download dorabot and set up your personal AI agent in under 5 minutes.
              </p>
              <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center sm:gap-4">
                <a
                  href="/api/download"
                  className="inline-flex items-center gap-2 rounded-lg bg-accent px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-accent-hover"
                >
                  <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24"><path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/></svg>
                  Download for macOS
                </a>
                <a
                  href="https://github.com/suitedaces/dorabot"
                  className="inline-flex items-center gap-2 rounded-lg border border-border px-5 py-2.5 text-sm text-text transition-colors hover:text-accent"
                >
                  <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24"><path fillRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" clipRule="evenodd" /></svg>
                  View on GitHub
                </a>
              </div>
            </div>
          </main>
        </div>
      </div>

      <Footer />
    </div>
  )
}
