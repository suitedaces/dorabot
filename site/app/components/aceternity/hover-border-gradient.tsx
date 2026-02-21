"use client"

import { useRef, useState, useEffect } from "react"
import { LazyMotion, domAnimation, m } from "motion/react"
import { cn } from "@/lib/utils"

export function HoverBorderGradient({
  children,
  containerClassName,
  className,
  as: Tag = "button",
  duration = 1,
  clockwise = true,
  ...props
}: {
  children: React.ReactNode
  containerClassName?: string
  className?: string
  as?: React.ElementType
  duration?: number
  clockwise?: boolean
  [key: string]: unknown
}) {
  const [hovered, setHovered] = useState(false)
  const [direction, setDirection] = useState<"TOP" | "LEFT" | "BOTTOM" | "RIGHT">("TOP")

  const rotateDirection = (current: typeof direction) => {
    const directions: (typeof direction)[] = clockwise
      ? ["TOP", "RIGHT", "BOTTOM", "LEFT"]
      : ["TOP", "LEFT", "BOTTOM", "RIGHT"]
    const idx = directions.indexOf(current)
    return directions[(idx + 1) % directions.length]
  }

  const movingMap: Record<string, string> = {
    TOP: "radial-gradient(20.7% 50% at 50% 0%, oklch(0.72 0.18 250) 0%, oklch(0.72 0.18 250 / 0) 100%)",
    LEFT: "radial-gradient(16.6% 43.1% at 0% 50%, oklch(0.72 0.18 250) 0%, oklch(0.72 0.18 250 / 0) 100%)",
    BOTTOM: "radial-gradient(20.7% 50% at 50% 100%, oklch(0.72 0.18 250) 0%, oklch(0.72 0.18 250 / 0) 100%)",
    RIGHT: "radial-gradient(16.2% 41.199% at 100% 50%, oklch(0.72 0.18 250) 0%, oklch(0.72 0.18 250 / 0) 100%)",
  }

  const highlight = "radial-gradient(75% 181.15942028985506% at 50% 50%, oklch(0.72 0.18 250) 0%, oklch(0.72 0.18 250 / 0) 100%)"

  useEffect(() => {
    if (!hovered) {
      const id = setInterval(() => {
        setDirection((prev) => rotateDirection(prev))
      }, duration * 1000)
      return () => clearInterval(id)
    }
  }, [hovered, duration])

  return (
    <Tag
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className={cn(
        "relative flex rounded-full content-center bg-bg-card hover:bg-bg-secondary transition duration-500 items-center flex-col flex-nowrap gap-10 h-min justify-center overflow-visible p-px decoration-clone w-fit",
        containerClassName
      )}
      {...props}
    >
      <div className={cn("w-auto z-10 rounded-[inherit] px-6 py-2.5", className)}>{children}</div>
      <LazyMotion features={domAnimation}>
        <m.div
          className="flex-none inset-0 overflow-hidden absolute z-0 rounded-[inherit]"
          style={{ filter: "blur(2px)", position: "absolute", width: "100%", height: "100%" }}
          initial={{ background: movingMap[direction] }}
          animate={{
            background: hovered
              ? [movingMap[direction], highlight]
              : movingMap[direction],
          }}
          transition={{ ease: "linear", duration: duration ?? 1 }}
        />
      </LazyMotion>
      <div className="bg-bg-card absolute z-1 flex-none inset-[2px] rounded-[inherit]" />
    </Tag>
  )
}
