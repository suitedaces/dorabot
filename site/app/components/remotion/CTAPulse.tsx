import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate } from "remotion"

export const CTAPulse = () => {
  const frame = useCurrentFrame()
  const { durationInFrames } = useVideoConfig()
  const progress = frame / durationInFrames

  // Expanding concentric circles from center
  const pulses = Array.from({ length: 5 }, (_, i) => {
    const t = ((progress * 1.5 + i * 0.2) % 1)
    const r = interpolate(t, [0, 1], [20, 350])
    const opacity = interpolate(t, [0, 0.1, 0.8, 1], [0, 0.12, 0.03, 0])
    return { r, opacity }
  })

  // Corner accent lines
  const corners = [
    { x1: 80, y1: 80, x2: 160, y2: 80, x3: 80, y3: 160 },
    { x1: 880, y1: 80, x2: 800, y2: 80, x3: 880, y3: 160 },
    { x1: 80, y1: 460, x2: 160, y2: 460, x3: 80, y3: 380 },
    { x1: 880, y1: 460, x2: 800, y2: 460, x3: 880, y3: 380 },
  ]

  // Floating particles
  const particles = Array.from({ length: 20 }, (_, i) => {
    const angle = (i / 20) * Math.PI * 2 + progress * Math.PI * 0.5
    const r = 100 + Math.sin(progress * Math.PI * 2 + i * 0.8) * 80
    const x = 480 + Math.cos(angle) * r
    const y = 270 + Math.sin(angle) * r * 0.6
    const opacity = interpolate(
      Math.sin(progress * Math.PI * 2 + i * 0.5),
      [-1, 1],
      [0.05, 0.2]
    )
    return { x, y, opacity }
  })

  return (
    <AbsoluteFill style={{ background: "transparent" }}>
      <svg width="100%" height="100%" viewBox="0 0 960 540">
        {/* Expanding pulses */}
        {pulses.map((pulse, i) => (
          <circle
            key={`pulse-${i}`}
            cx="480"
            cy="270"
            r={pulse.r}
            fill="none"
            stroke="oklch(0.72 0.18 250)"
            strokeWidth="1"
            opacity={pulse.opacity}
          />
        ))}

        {/* Corner accents */}
        {corners.map((c, i) => {
          const opacity = interpolate(
            Math.sin(progress * Math.PI * 2 + i),
            [-1, 1],
            [0.04, 0.12]
          )
          return (
            <g key={`corner-${i}`}>
              <line x1={c.x1} y1={c.y1} x2={c.x2} y2={c.y2} stroke="oklch(0.72 0.18 250)" strokeWidth="0.5" opacity={opacity} />
              <line x1={c.x1} y1={c.y1} x2={c.x3} y2={c.y3} stroke="oklch(0.72 0.18 250)" strokeWidth="0.5" opacity={opacity} />
            </g>
          )
        })}

        {/* Floating particles */}
        {particles.map((p, i) => (
          <circle
            key={`fp-${i}`}
            cx={p.x}
            cy={p.y}
            r={2}
            fill={i % 3 === 0 ? "oklch(0.68 0.19 310)" : "oklch(0.72 0.18 250)"}
            opacity={p.opacity}
          />
        ))}

        {/* Central glow */}
        <circle cx="480" cy="270" r="60" fill="oklch(0.72 0.18 250)" opacity={0.03} />
      </svg>
    </AbsoluteFill>
  )
}
