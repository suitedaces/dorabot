"use client"

import { useState, useEffect, useRef } from "react"
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
  const [visible, setVisible] = useState(true)
  const [atTop, setAtTop] = useState(true)
  const [mobileOpen, setMobileOpen] = useState(false)
  const lastY = useRef(0)

  useEffect(() => {
    const onScroll = () => {
      const y = window.scrollY
      if (y < 50) {
        setVisible(true)
        setAtTop(true)
      } else {
        setAtTop(false)
        if (y < lastY.current) {
          setVisible(true)
        } else {
          setVisible(false)
          setMobileOpen(false)
        }
      }
      lastY.current = y
    }
    window.addEventListener("scroll", onScroll, { passive: true })
    return () => window.removeEventListener("scroll", onScroll)
  }, [])

  return (
    <nav
      className={cn(
        "fixed top-0 inset-x-0 z-[5000] transition-all duration-300",
        visible ? "translate-y-0 opacity-100" : "-translate-y-full opacity-0",
        (!atTop || mobileOpen) && "backdrop-blur-xl bg-bg/80",
        "border-b",
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
      <div
        className={cn(
          "sm:hidden overflow-hidden transition-all duration-200",
          mobileOpen
            ? "max-h-96 opacity-100 border-t border-border"
            : "max-h-0 opacity-0"
        )}
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
      </div>
    </nav>
  )
}
