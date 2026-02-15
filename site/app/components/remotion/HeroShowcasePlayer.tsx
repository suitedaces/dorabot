"use client"

import { Player } from "@remotion/player"
import { useEffect, useState } from "react"
import { HeroShowcase } from "./HeroShowcase"

const SCENE_DURATION = 180
const SCENE_COUNT = 6
const TOTAL_DURATION = SCENE_DURATION * SCENE_COUNT

export function HeroShowcasePlayer() {
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted) {
    // SSR placeholder with matching dimensions
    return (
      <div
        style={{
          width: "100%",
          maxWidth: 720,
          aspectRatio: "16/10",
          borderRadius: 16,
          border: "1px solid rgba(80, 80, 120, 0.3)",
          background: "rgba(30, 30, 52, 0.5)",
        }}
      />
    )
  }

  return (
    <div
      style={{
        width: "100%",
        maxWidth: 720,
        borderRadius: 16,
        overflow: "hidden",
        border: "1px solid rgba(80, 80, 120, 0.3)",
        boxShadow: "0 24px 80px rgba(0,0,0,0.6), 0 0 40px rgba(108, 138, 255, 0.08)",
      }}
    >
      <Player
        component={HeroShowcase}
        durationInFrames={TOTAL_DURATION}
        fps={30}
        compositionWidth={720}
        compositionHeight={450}
        style={{ width: "100%", aspectRatio: "720/450" }}
        autoPlay
        loop
        controls={false}
        allowFullscreen={false}
        clickToPlay={false}
      />
    </div>
  )
}
