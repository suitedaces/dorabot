"use client"

import { motion } from "motion/react"
import { SectionPlayer } from "../remotion/SectionPlayer"
import { SecurityShield } from "../remotion/SecurityShield"

// Icon components
function LocalIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-6 w-6 text-green">
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <path d="M8 21h8M12 17v4" />
    </svg>
  )
}

function FileIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-6 w-6 text-green">
      <path d="M14.5 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V7.5L14.5 2z" />
      <path d="M14 2v6h6" />
      <path d="M9 15l2 2 4-4" />
    </svg>
  )
}

function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-6 w-6 text-green">
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0110 0v4" />
    </svg>
  )
}

function ShieldIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-6 w-6 text-green">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <path d="M9 12l2 2 4-4" />
    </svg>
  )
}

const items = [
  {
    title: "Runs locally",
    description: "No cloud server. Your data stays on your machine.",
    icon: <LocalIcon />,
  },
  {
    title: "Scoped file access",
    description: "Default: ~/ and /tmp. Sensitive dirs always blocked.",
    icon: <FileIcon />,
  },
  {
    title: "Token-authenticated gateway",
    description: "256-bit hex token. No unauthenticated access.",
    icon: <LockIcon />,
  },
  {
    title: "Tool approval tiers",
    description: "Auto-allow, notify, or require-approval. Your choice.",
    icon: <ShieldIcon />,
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
  hidden: { opacity: 0, y: 12 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.35 },
  },
}

export function Security() {
  return (
    <section className="relative px-6 py-20 sm:py-28 border-t border-border overflow-hidden">
      {/* Remotion background */}
      <SectionPlayer
        component={SecurityShield}
        opacity={0.2}
        compositionWidth={960}
        compositionHeight={540}
      />

      <div className="relative z-10 mx-auto max-w-5xl">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-100px" }}
          transition={{ duration: 0.4 }}
          className="text-center mb-12"
        >
          <h2 className="text-3xl font-bold sm:text-4xl lg:text-5xl tracking-tight mb-4">
            Security-first, not security-later
          </h2>
          <p className="text-text-secondary text-base sm:text-lg max-w-2xl mx-auto">
            Unlike certain 180k-star projects, dorabot doesn&apos;t expose your machine to the internet.
          </p>
        </motion.div>
        <motion.div
          variants={containerVariants}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-50px" }}
          className="grid gap-4 sm:grid-cols-2"
        >
          {items.map((item) => (
            <motion.div key={item.title} variants={itemVariants}>
              <div className="rounded-xl border border-border bg-bg-card/50 glass p-6 sm:p-7 text-left">
                <div className="flex items-center gap-4 mb-3">
                  <div className="flex items-center justify-center h-10 w-10 rounded-lg border border-border bg-surface-raised">
                    {item.icon}
                  </div>
                  <h3 className="font-semibold text-base sm:text-lg">{item.title}</h3>
                </div>
                <p className="text-sm sm:text-base text-text-secondary leading-relaxed">{item.description}</p>
              </div>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  )
}
