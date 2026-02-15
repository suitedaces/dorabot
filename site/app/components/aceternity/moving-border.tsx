"use client"

import { useRef } from "react"
import { motion, useAnimationFrame } from "motion/react"
import { cn } from "@/lib/utils"

export function MovingBorder({
  children,
  duration = 2000,
  borderRadius = "1.25rem",
  className,
  containerClassName,
  borderClassName,
  as: Component = "div",
  ...otherProps
}: {
  children: React.ReactNode
  duration?: number
  borderRadius?: string
  className?: string
  containerClassName?: string
  borderClassName?: string
  as?: React.ElementType
  [key: string]: unknown
}) {
  return (
    <Component
      className={cn("relative overflow-hidden bg-transparent p-[1px] text-text", containerClassName)}
      style={{ borderRadius }}
      {...otherProps}
    >
      <div
        className="absolute inset-0"
        style={{ borderRadius }}
      >
        <MovingBorderSVG duration={duration} rx="30%" ry="30%">
          <div
            className={cn(
              "h-20 w-20 bg-[radial-gradient(oklch(0.72_0.18_250)_40%,transparent_60%)] opacity-[0.8]",
              borderClassName
            )}
          />
        </MovingBorderSVG>
      </div>
      <div
        className={cn("relative z-10 border border-border bg-bg-card backdrop-blur-xl", className)}
        style={{ borderRadius: `calc(${borderRadius} * 0.96)` }}
      >
        {children}
      </div>
    </Component>
  )
}

function MovingBorderSVG({
  children,
  duration = 2000,
  rx,
  ry,
}: {
  children: React.ReactNode
  duration?: number
  rx?: string
  ry?: string
}) {
  const pathRef = useRef<SVGRectElement>(null)
  const progressRef = useRef(0)
  const ref = useRef<HTMLDivElement>(null)

  useAnimationFrame((time) => {
    if (!pathRef.current || !ref.current) return
    const progress = (time / duration) % 1
    progressRef.current = progress
    const length = pathRef.current.getTotalLength()
    const point = pathRef.current.getPointAtLength(progress * length)
    ref.current.style.transform = `translate(${point.x}px, ${point.y}px) translate(-50%, -50%)`
  })

  return (
    <>
      <svg
        xmlns="http://www.w3.org/2000/svg"
        preserveAspectRatio="none"
        className="absolute h-full w-full"
        width="100%"
        height="100%"
      >
        <rect
          fill="none"
          width="100%"
          height="100%"
          rx={rx}
          ry={ry}
          ref={pathRef}
        />
      </svg>
      <div ref={ref} className="absolute top-0 left-0 inline-flex transform">
        {children}
      </div>
    </>
  )
}
