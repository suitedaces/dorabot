"use client"

import { motion } from "motion/react"

function WhatsAppLogo() {
  return (
    <svg viewBox="0 0 24 24" fill="#25D366" className="h-4 w-4">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347" />
    </svg>
  )
}

function TelegramLogo() {
  return (
    <svg viewBox="0 0 24 24" fill="#26A5E4" className="h-4 w-4">
      <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
    </svg>
  )
}

function SlackLogo() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4">
      <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zm1.271 0a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313z" fill="#E01E5A" />
      <path d="M8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zm0 1.271a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312z" fill="#36C5F0" />
      <path d="M18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zm-1.27 0a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.163 0a2.528 2.528 0 0 1 2.523 2.522v6.312z" fill="#2EB67D" />
      <path d="M15.163 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.163 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zm0-1.27a2.527 2.527 0 0 1-2.52-2.523 2.527 2.527 0 0 1 2.52-2.52h6.315A2.528 2.528 0 0 1 24 15.163a2.528 2.528 0 0 1-2.522 2.523h-6.315z" fill="#ECB22E" />
    </svg>
  )
}

const features = [
  {
    title: "Persistent Memory & Self-Learning",
    description:
      "Daily journals, curated memory, personality config. The agent remembers decisions, preferences, and context across every session. It gets better the more you use it.",
    video: "https://pub-4316e19c5e0c4561879dabd80ec994f7.r2.dev/gifs/memory.mp4",
  },
  {
    title: "Automations & Scheduling",
    description:
      "Cron jobs, scheduled pulses, recurring tasks. The agent wakes up, does work, and messages you. iCal RRULE support, Apple Calendar sync.",
    video: "https://pub-4316e19c5e0c4561879dabd80ec994f7.r2.dev/gifs/automations.mp4",
  },
  {
    title: "Goals & Tasks",
    description:
      "The agent proposes goals, writes plans, and executes them. You approve from the desktop app or Telegram. Full pipeline: research, plan, review, execute, done.",
    video: "https://pub-4316e19c5e0c4561879dabd80ec994f7.r2.dev/gifs/goals.mp4",
  },
  {
    title: "Research & Knowledge",
    description:
      "The agent creates and maintains its own research for you. Topics tracked, categorized, and searchable. Point it at anything and it keeps the knowledge organized.",
    video: "https://pub-4316e19c5e0c4561879dabd80ec994f7.r2.dev/gifs/research.mp4",
  },
  {
    title: "Multi-Channel Messaging",
    description:
      "Same agent on WhatsApp, Telegram, and Slack. Send text, photos, voice, documents. It responds with full context from every past conversation.",
    video: "https://pub-4316e19c5e0c4561879dabd80ec994f7.r2.dev/gifs/channels.mp4",
  },
  {
    title: "Skills & MCP Servers",
    description:
      "Built-in skills for GitHub, email, macOS, PR review, agent swarms. Browse 56k+ community skills. Connect 7,300+ MCP servers via Smithery.",
    video: "https://pub-4316e19c5e0c4561879dabd80ec994f7.r2.dev/gifs/extensions.mp4",
  },
]

const containerVariants = {
  hidden: {},
  visible: {
    transition: {
      staggerChildren: 0.08,
    },
  },
}

const itemVariants = {
  hidden: { opacity: 0, y: 16 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.4 },
  },
}

export function Features() {
  return (
    <section id="features" className="px-4 py-20 sm:px-8 sm:py-28 lg:px-12">
      <div className="mx-auto max-w-7xl">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-100px" }}
          transition={{ duration: 0.4 }}
          className="text-center mb-14"
        >
          <h2 className="text-3xl font-bold sm:text-4xl lg:text-5xl tracking-tight">
            From model to autonomous operator
          </h2>
          <p className="mt-4 text-text-secondary text-base sm:text-lg max-w-2xl mx-auto">
            Bring your own API key or subscription. dorabot handles the rest.
          </p>
        </motion.div>

        <motion.div
          variants={containerVariants}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-50px" }}
          className="space-y-8 lg:space-y-10"
        >
          {features.map((f, i) => (
            <motion.div
              key={f.title}
              variants={itemVariants}
              className={`flex flex-col ${i % 2 === 0 ? "md:flex-row" : "md:flex-row-reverse"} gap-6 md:gap-12 lg:gap-16 items-center`}
            >
              {/* GIF */}
              <div className="w-full md:w-7/12 rounded-xl border border-border overflow-hidden bg-surface-base/30">
                <video
                  src={f.video}
                  autoPlay
                  loop
                  muted
                  playsInline
                  className="w-full"
                />
              </div>
              {/* Text */}
              <div className="w-full md:w-5/12">
                <h3 className="text-xl sm:text-2xl font-semibold mb-3">{f.title}</h3>
                {f.title === "Multi-Channel Messaging" && (
                  <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-text-secondary">
                    <span className="inline-flex items-center gap-1 rounded-full border border-border bg-bg-card/50 px-2 py-1">
                      <WhatsAppLogo /> WhatsApp
                    </span>
                    <span className="inline-flex items-center gap-1 rounded-full border border-border bg-bg-card/50 px-2 py-1">
                      <TelegramLogo /> Telegram
                    </span>
                    <span className="inline-flex items-center gap-1 rounded-full border border-border bg-bg-card/50 px-2 py-1">
                      <SlackLogo /> Slack
                    </span>
                  </div>
                )}
                <p className="text-sm sm:text-base text-text-secondary leading-relaxed">
                  {f.description}
                </p>
              </div>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  )
}
