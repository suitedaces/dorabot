"use client"

import { useState } from "react"
import { LazyMotion, domAnimation, m, useScroll, useMotionValueEvent, AnimatePresence } from "motion/react"
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
  const [mobileOpen, setMobileOpen] = useState(false)

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
        setMobileOpen(false)
      }
    }
  })

  return (
    <LazyMotion features={domAnimation}>
    <AnimatePresence mode="wait">
      <m.nav
        initial={{ opacity: 1, y: 0 }}
        animate={{ y: visible ? 0 : -100, opacity: visible ? 1 : 0 }}
        transition={{ duration: 0.3 }}
        className={cn(
          "fixed top-0 inset-x-0 z-[5000]",
          !atTop && "backdrop-blur-xl bg-bg/80",
          mobileOpen && "backdrop-blur-xl bg-bg/80",
          "border-b transition-colors duration-300",
          atTop && !mobileOpen ? "border-transparent" : "border-border",
          className
        )}
      >
        <div className="mx-auto flex w-full max-w-7xl items-center justify-between px-3 py-2.5 sm:px-8 sm:py-3.5 lg:px-12">
          <div className="flex items-center gap-4 sm:gap-8">
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
          </div>
          <div className="flex items-center gap-2 sm:gap-3">
            <div className="hidden sm:flex">{action}</div>
            {/* hamburger */}
            <button
              onClick={() => setMobileOpen((v) => !v)}
              className="sm:hidden flex flex-col gap-1.5 p-2"
              aria-label="Toggle menu"
            >
              <span className={cn("block h-0.5 w-5 bg-text transition-all duration-200", mobileOpen && "rotate-45 translate-y-[4px]")} />
              <span className={cn("block h-0.5 w-5 bg-text transition-all duration-200", mobileOpen && "opacity-0")} />
              <span className={cn("block h-0.5 w-5 bg-text transition-all duration-200", mobileOpen && "-rotate-45 -translate-y-[4px]")} />
            </button>
          </div>
        </div>
        {/* mobile dropdown */}
        <AnimatePresence>
          {mobileOpen && (
            <m.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="sm:hidden overflow-hidden border-t border-border"
            >
              <div className="flex flex-col gap-1 px-4 py-4 sm:px-8 lg:px-12">
                {navItems.map((item) => (
                  <a
                    key={item.name}
                    href={item.link}
                    onClick={() => setMobileOpen(false)}
                    className="py-2.5 text-sm text-text-secondary hover:text-text transition-colors"
                  >
                    {item.name}
                  </a>
                ))}
                {action && (
                  <div className="mt-2 border-t border-border pt-3">
                    {action}
                  </div>
                )}
              </div>
            </m.div>
          )}
        </AnimatePresence>
      </m.nav>
    </AnimatePresence>
    </LazyMotion>
  )
}
