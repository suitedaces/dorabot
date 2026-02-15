"use client"

import { useState, useEffect } from "react"
import { motion, useScroll, useMotionValueEvent, AnimatePresence } from "motion/react"
import { cn } from "@/lib/utils"

export function FloatingNavbar({
  navItems,
  className,
  logo,
  action,
}: {
  navItems: { name: string; link: string }[]
  className?: string
  logo?: React.ReactNode
  action?: React.ReactNode
}) {
  const { scrollY } = useScroll()
  const [visible, setVisible] = useState(true)
  const [atTop, setAtTop] = useState(true)

  useMotionValueEvent(scrollY, "change", (current) => {
    const previous = scrollY.getPrevious() ?? 0
    if (current < 50) {
      setVisible(true)
      setAtTop(true)
    } else {
      setAtTop(false)
      if (current < previous) {
        setVisible(true)
      } else {
        setVisible(false)
      }
    }
  })

  return (
    <AnimatePresence mode="wait">
      <motion.nav
        initial={{ opacity: 1, y: 0 }}
        animate={{ y: visible ? 0 : -100, opacity: visible ? 1 : 0 }}
        transition={{ duration: 0.3 }}
        className={cn(
          "fixed top-0 inset-x-0 z-[5000]",
          !atTop && "backdrop-blur-xl bg-bg/80",
          "border-b transition-colors duration-300",
          atTop ? "border-transparent" : "border-border",
          className
        )}
      >
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3.5">
          {logo}
          <div className="hidden sm:flex items-center gap-6">
            {navItems.map((item) => (
              <a
                key={item.name}
                href={item.link}
                className="text-sm text-text-secondary hover:text-text transition-colors"
              >
                {item.name}
              </a>
            ))}
          </div>
          {action}
        </div>
      </motion.nav>
    </AnimatePresence>
  )
}
