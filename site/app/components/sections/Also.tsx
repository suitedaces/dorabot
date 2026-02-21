"use client"

import { motion } from "motion/react"

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

const containerVariants = {
  hidden: {},
  visible: {
    transition: { staggerChildren: 0.05 },
  },
}

const itemVariants = {
  hidden: { opacity: 0, y: 8 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.3 },
  },
}

export function Also() {
  return (
    <section className="border-t border-border px-4 py-16 sm:px-8 sm:py-20 lg:px-12">
      <div className="mx-auto max-w-7xl">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.4 }}
          className="text-center mb-10"
        >
          <h2 className="text-2xl font-bold sm:text-3xl tracking-tight">Also</h2>
        </motion.div>

        <motion.div
          variants={containerVariants}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-50px" }}
          className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
        >
          {items.map((item) => (
            <motion.div
              key={item.label}
              variants={itemVariants}
              className="rounded-lg border border-border bg-bg-card/40 p-5"
            >
              <p className="font-medium text-text mb-1">{item.label}</p>
              <p className="text-sm text-text-secondary leading-relaxed">{item.detail}</p>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  )
}
