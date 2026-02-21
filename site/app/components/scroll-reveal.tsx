"use client"

import { useRef, useEffect, type ReactNode } from "react"

export function ScrollReveal({
  children,
  className,
  delay = 0,
  as: Tag = "div",
}: {
  children: ReactNode
  className?: string
  delay?: number
  as?: "div" | "section" | "h2" | "p"
}) {
  const ref = useRef<HTMLElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          if (delay) {
            setTimeout(() => el.classList.add("revealed"), delay * 1000)
          } else {
            el.classList.add("revealed")
          }
          observer.disconnect()
        }
      },
      { rootMargin: "-60px" }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [delay])

  return (
    <Tag ref={ref as any} className={`scroll-reveal ${className ?? ""}`}>
      {children}
    </Tag>
  )
}

export function StaggerReveal({
  children,
  className,
  staggerDelay = 0.08,
}: {
  children: ReactNode
  className?: string
  staggerDelay?: number
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          const items = el.querySelectorAll(".stagger-item")
          items.forEach((item, i) => {
            setTimeout(() => item.classList.add("revealed"), i * staggerDelay * 1000)
          })
          observer.disconnect()
        }
      },
      { rootMargin: "-40px" }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [staggerDelay])

  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  )
}
