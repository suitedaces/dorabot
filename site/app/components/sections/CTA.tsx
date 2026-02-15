"use client"

import { motion } from "motion/react"
import { TextGenerateEffect } from "../aceternity/text-generate-effect"
import { HoverBorderGradient } from "../aceternity/hover-border-gradient"
import { SectionPlayer } from "../remotion/SectionPlayer"
import { CTAPulse } from "../remotion/CTAPulse"

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

export function CTA() {
  return (
    <section className="relative px-6 py-24 sm:py-32 border-t border-border overflow-hidden">
      {/* Remotion background */}
      <SectionPlayer
        component={CTAPulse}
        opacity={0.25}
        compositionWidth={960}
        compositionHeight={540}
      />

      {/* Background glow */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[300px] bg-accent/5 blur-[120px] rounded-full" />
      </div>

      <div className="relative z-10 mx-auto max-w-4xl text-center">
        <TextGenerateEffect
          words="Your data never leaves your machine"
          className="text-3xl font-bold sm:text-4xl lg:text-5xl xl:text-6xl leading-tight tracking-tight"
          duration={0.4}
        />
        <motion.p
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ delay: 0.8, duration: 0.5 }}
          className="mt-6 text-text-secondary text-base sm:text-lg"
        >
          Open source. MIT licensed. 5 commands to install.
        </motion.p>
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ delay: 1, duration: 0.4 }}
          className="mt-12"
        >
          <a href="https://github.com/suitedaces/dorabot">
            <HoverBorderGradient
              containerClassName="rounded-lg mx-auto"
              as="div"
            >
              <span className="flex items-center gap-3 px-3 py-1.5 text-base font-medium text-text">
                <GithubIcon />
                Get Started on GitHub
              </span>
            </HoverBorderGradient>
          </a>
        </motion.div>
      </div>
    </section>
  )
}
