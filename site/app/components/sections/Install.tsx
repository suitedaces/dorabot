"use client"

import { motion } from "motion/react"

export function Install() {
  return (
    <section className="px-6 pb-12">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-100px" }}
        transition={{ duration: 0.5 }}
        className="mx-auto max-w-2xl"
      >
        <div className="rounded-xl border border-border bg-surface-base/50 glass overflow-hidden">
          {/* Terminal chrome */}
          <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
            <div className="h-3 w-3 rounded-full bg-[oklch(0.65_0.24_27)]" />
            <div className="h-3 w-3 rounded-full bg-[oklch(0.74_0.19_80)]" />
            <div className="h-3 w-3 rounded-full bg-[oklch(0.70_0.24_145)]" />
            <span className="ml-2 text-xs text-text-muted">terminal</span>
          </div>
          {/* Terminal body */}
          <div className="p-5 sm:p-6">
            <pre className="text-sm sm:text-base text-text-secondary leading-relaxed overflow-x-auto">
              <code>
                <span className="text-text-muted">$</span>{" "}
                <span className="text-text">git clone</span>{" "}
                <span className="text-accent">
                  https://github.com/suitedaces/dorabot.git
                </span>
                {"\n"}
                <span className="text-text-muted">$</span>{" "}
                <span className="text-text">cd dorabot && npm install</span>
                {"\n"}
                <span className="text-text-muted">$</span>{" "}
                <span className="text-text">npm run build && npm link</span>
                {"\n"}
                <span className="text-text-muted">$</span>{" "}
                <span className="text-text">npm run dev</span>
                {"\n\n"}
                <span className="text-green">&#10003;</span>{" "}
                <span className="text-text-secondary">Gateway running on port 18789</span>
                {"\n"}
                <span className="text-green">&#10003;</span>{" "}
                <span className="text-text-secondary">Desktop app ready</span>
              </code>
            </pre>
          </div>
        </div>
      </motion.div>
    </section>
  )
}
