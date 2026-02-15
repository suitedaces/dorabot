"use client"

import { Player } from "@remotion/player"
import { useEffect, useState, ComponentType } from "react"

interface SectionPlayerProps {
  component: ComponentType
  className?: string
  opacity?: number
  compositionWidth?: number
  compositionHeight?: number
  durationInFrames?: number
}

export function SectionPlayer({
  component,
  className = "",
  opacity = 0.35,
  compositionWidth = 1920,
  compositionHeight = 540,
  durationInFrames = 300,
}: SectionPlayerProps) {
  const [mounted, setMounted] = useState(false)
  const [isMobile, setIsMobile] = useState(false)

  useEffect(() => {
    setMounted(true)
    const mq = window.matchMedia("(max-width: 768px)")
    setIsMobile(mq.matches)
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches)
    mq.addEventListener("change", handler)
    return () => mq.removeEventListener("change", handler)
  }, [])

  if (!mounted || isMobile) return null

  return (
    <div
      className={`absolute inset-0 pointer-events-none ${className}`}
      style={{ opacity }}
    >
      <Player
        component={component}
        durationInFrames={durationInFrames}
        fps={30}
        compositionWidth={compositionWidth}
        compositionHeight={compositionHeight}
        style={{ width: "100%", height: "100%" }}
        autoPlay
        loop
        controls={false}
        allowFullscreen={false}
        clickToPlay={false}
      />
    </div>
  )
}
