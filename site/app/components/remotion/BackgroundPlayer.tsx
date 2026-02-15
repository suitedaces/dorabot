"use client"

import { Player } from "@remotion/player"
import { ParticleGrid } from "./ParticleGrid"
import { useEffect, useState } from "react"

export function BackgroundPlayer() {
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
    <div className="absolute inset-0 pointer-events-none opacity-40">
      <Player
        component={ParticleGrid}
        durationInFrames={300}
        fps={30}
        compositionWidth={1920}
        compositionHeight={1080}
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
