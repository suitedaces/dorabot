import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate } from "remotion"
import { useMemo } from "react"

interface Particle {
  x: number
  y: number
  phase: number
  size: number
}

export const ParticleGrid = () => {
  const frame = useCurrentFrame()
  const { durationInFrames } = useVideoConfig()

  const particles = useMemo(() => {
    const grid: Particle[] = []
    const cols = 10
    const rows = 8
    for (let i = 0; i < cols * rows; i++) {
      const col = i % cols
      const row = Math.floor(i / cols)
      grid.push({
        x: (col + 0.5) / cols,
        y: (row + 0.5) / rows,
        phase: (col * 0.7 + row * 1.3) % (Math.PI * 2),
        size: 1.5 + ((col + row) % 3) * 0.5,
      })
    }
    return grid
  }, [])

  const progress = frame / durationInFrames

  return (
    <AbsoluteFill style={{ background: "transparent" }}>
      <svg width="100%" height="100%" style={{ position: "absolute", inset: 0 }}>
        {/* Connection lines */}
        {particles.map((p1, i) =>
          particles.slice(i + 1).map((p2, j) => {
            const dist = Math.hypot(p1.x - p2.x, p1.y - p2.y)
            if (dist > 0.18) return null

            const waveOffset = Math.sin(progress * Math.PI * 2 + p1.phase) * 0.3
            const lineOpacity = interpolate(
              waveOffset,
              [-0.3, 0.3],
              [0.02, 0.08]
            )

            return (
              <line
                key={`${i}-${j}`}
                x1={`${p1.x * 100}%`}
                y1={`${p1.y * 100}%`}
                x2={`${p2.x * 100}%`}
                y2={`${p2.y * 100}%`}
                stroke="oklch(0.72 0.18 250)"
                strokeWidth="0.5"
                opacity={lineOpacity}
              />
            )
          })
        )}

        {/* Particles */}
        {particles.map((p, i) => {
          const wave = Math.sin(progress * Math.PI * 2 + p.phase)
          const scale = interpolate(wave, [-1, 1], [0.6, 1.4])
          const opacity = interpolate(wave, [-1, 1], [0.05, 0.2])

          return (
            <circle
              key={i}
              cx={`${p.x * 100}%`}
              cy={`${p.y * 100}%`}
              r={p.size * scale}
              fill="oklch(0.72 0.18 250)"
              opacity={opacity}
            />
          )
        })}
      </svg>
    </AbsoluteFill>
  )
}
