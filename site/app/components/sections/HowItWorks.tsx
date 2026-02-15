"use client"

import { motion } from "motion/react"
import { SectionPlayer } from "../remotion/SectionPlayer"
import { StepsFlow } from "../remotion/StepsFlow"

const steps = [
  {
    number: "01",
    title: "Bring your model",
    description:
      "Claude API key, Pro/Max subscription, OpenAI key, or MiniMax key. Whatever you already have.",
  },
  {
    number: "02",
    title: "Connect your channels",
    description:
      "Scan a QR for WhatsApp. Paste a bot token for Telegram. Add app tokens for Slack. Takes minutes.",
  },
  {
    number: "03",
    title: "Teach it about you",
    description:
      "Run the onboard skill or edit USER.md and SOUL.md directly. Tell it your name, preferences, style.",
  },
  {
    number: "04",
    title: "Let it work",
    description:
      "It proposes goals, runs scheduled tasks, sends you updates. The more context it has, the more useful it gets.",
  },
]

export function HowItWorks() {
  return (
    <section id="how-it-works" className="relative px-6 py-20 sm:py-28 border-t border-border overflow-hidden">
      {/* Remotion background */}
      <SectionPlayer
        component={StepsFlow}
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
          className="text-center mb-14"
        >
          <h2 className="text-3xl font-bold sm:text-4xl lg:text-5xl tracking-tight">How it works</h2>
          <p className="mt-4 text-text-secondary text-base sm:text-lg max-w-2xl mx-auto">
            From zero to personal AI agent in under 10 minutes.
          </p>
        </motion.div>
        <div className="relative">
          {/* Vertical line */}
          <div className="absolute left-[23px] top-0 bottom-0 w-px bg-gradient-to-b from-accent/30 via-purple/20 to-transparent hidden sm:block" />

          <div className="space-y-8">
            {steps.map((step, i) => (
              <motion.div
                key={step.number}
                initial={{ opacity: 0, x: -16 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true, margin: "-50px" }}
                transition={{ duration: 0.4, delay: i * 0.1 }}
                className="flex gap-6"
              >
                {/* Number badge */}
                <div className="relative flex-shrink-0">
                  <div className="flex items-center justify-center h-12 w-12 rounded-xl border border-border bg-bg-card/50 glass text-sm font-semibold text-accent">
                    {step.number}
                  </div>
                </div>

                <div className="pt-1">
                  <h3 className="font-semibold text-lg sm:text-xl mb-2">{step.title}</h3>
                  <p className="text-sm sm:text-base text-text-secondary leading-relaxed max-w-xl">
                    {step.description}
                  </p>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
