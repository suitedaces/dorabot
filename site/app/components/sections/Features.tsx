"use client"

import { motion } from "motion/react"
import { Spotlight } from "../aceternity/spotlight"
import { SectionPlayer } from "../remotion/SectionPlayer"
import { FeatureWave } from "../remotion/FeatureWave"

// SVG icon components for each feature
function ChatIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-6 w-6 text-accent">
      <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22z" />
      <path d="M8 12h.01M12 12h.01M16 12h.01" strokeWidth={2.5} strokeLinecap="round" />
    </svg>
  )
}

function GoalsIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-6 w-6 text-accent">
      <path d="M9 11l3 3L22 4" strokeWidth={2} />
      <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />
    </svg>
  )
}

function BrowserIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-6 w-6 text-accent">
      <rect x="2" y="3" width="20" height="18" rx="2" />
      <path d="M2 9h20" />
      <circle cx="6" cy="6" r="1" fill="currentColor" stroke="none" />
      <circle cx="9.5" cy="6" r="1" fill="currentColor" stroke="none" />
    </svg>
  )
}

function EmailIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-6 w-6 text-accent">
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="M22 7l-8.97 5.7a1.94 1.94 0 01-2.06 0L2 7" />
    </svg>
  )
}

function MacIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="h-6 w-6 text-accent">
      <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/>
    </svg>
  )
}

function ScheduleIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-6 w-6 text-accent">
      <circle cx="12" cy="12" r="10" />
      <path d="M12 6v6l4 2" strokeWidth={2} strokeLinecap="round" />
    </svg>
  )
}

function GitHubIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="h-6 w-6 text-accent">
      <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
    </svg>
  )
}

function SkillsIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-6 w-6 text-accent">
      <path d="M12 2L2 7l10 5 10-5-10-5z" />
      <path d="M2 17l10 5 10-5" />
      <path d="M2 12l10 5 10-5" />
    </svg>
  )
}

function MemoryIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-6 w-6 text-accent">
      <path d="M12 2a3 3 0 00-3 3v1a3 3 0 006 0V5a3 3 0 00-3-3z" />
      <path d="M19 9H5a2 2 0 00-2 2v1a2 2 0 002 2h14a2 2 0 002-2v-1a2 2 0 00-2-2z" />
      <path d="M12 14v4" />
      <path d="M8 14v2a2 2 0 002 2h4a2 2 0 002-2v-2" />
      <path d="M7 22h10" />
      <path d="M12 18v4" />
    </svg>
  )
}

const features = [
  {
    icon: <ChatIcon />,
    title: "Chat anywhere",
    description:
      "WhatsApp, Telegram, Slack, or the desktop app. Persistent memory across all channels.",
  },
  {
    icon: <GoalsIcon />,
    title: "Proactive goals",
    description:
      "The agent proposes goals on its own. Kanban board to approve. Tracks progress autonomously.",
  },
  {
    icon: <BrowserIcon />,
    title: "Browse the web",
    description:
      "Full browser automation via Playwright. Fill forms, click buttons, stay logged in. 90+ actions.",
  },
  {
    icon: <EmailIcon />,
    title: "Read and send email",
    description:
      "Via Himalaya CLI. IMAP/SMTP, no OAuth headaches. Read, reply, compose, attach files.",
  },
  {
    icon: <MacIcon />,
    title: "Control your Mac",
    description:
      "Move windows, launch apps, control Spotify, manage Calendar, system settings. All via AppleScript.",
  },
  {
    icon: <ScheduleIcon />,
    title: "Schedule anything",
    description:
      "One-shot reminders, recurring tasks, full cron expressions with timezone support.",
  },
  {
    icon: <GitHubIcon />,
    title: "GitHub workflows",
    description:
      "PRs, issues, CI checks, code review via gh CLI. Manage repos without leaving the chat.",
  },
  {
    icon: <SkillsIcon />,
    title: "56k+ skills",
    description:
      "9 built-in skills, 56k+ community skills from the gallery. Or create new ones on the fly.",
  },
  {
    icon: <MemoryIcon />,
    title: "Persistent memory",
    description:
      "SOUL.md for personality. USER.md for your profile. MEMORY.md for learned facts. Gets better over time.",
  },
]

const containerVariants = {
  hidden: {},
  visible: {
    transition: {
      staggerChildren: 0.06,
    },
  },
}

const itemVariants = {
  hidden: { opacity: 0, y: 12 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.35 },
  },
}

export function Features() {
  return (
    <section id="features" className="relative px-6 py-20 sm:py-28 overflow-hidden">
      {/* Remotion background */}
      <SectionPlayer component={FeatureWave} opacity={0.25} />

      <div className="relative z-10 mx-auto max-w-7xl">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-100px" }}
          transition={{ duration: 0.4 }}
          className="text-center mb-14"
        >
          <h2 className="text-3xl font-bold sm:text-4xl lg:text-5xl tracking-tight">
            Everything your AI model can&apos;t do alone
          </h2>
          <p className="mt-4 text-text-secondary text-base sm:text-lg max-w-2xl mx-auto">
            Bring your own API key. dorabot handles the rest.
          </p>
        </motion.div>
        <motion.div
          variants={containerVariants}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-50px" }}
          className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
        >
          {features.map((f) => (
            <motion.div key={f.title} variants={itemVariants}>
              <Spotlight className="h-full border border-border bg-bg-card/50 glass">
                <div className="p-6 sm:p-7">
                  <div className="flex items-center justify-center h-10 w-10 rounded-lg border border-border bg-surface-raised mb-4">
                    {f.icon}
                  </div>
                  <h3 className="font-semibold text-base sm:text-lg mb-2">{f.title}</h3>
                  <p className="text-sm sm:text-base text-text-secondary leading-relaxed">
                    {f.description}
                  </p>
                </div>
              </Spotlight>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  )
}
