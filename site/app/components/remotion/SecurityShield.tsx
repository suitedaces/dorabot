import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate } from "remotion"

export const SecurityShield = () => {
  const frame = useCurrentFrame()
  const { durationInFrames } = useVideoConfig()
  const progress = frame / durationInFrames

  // Shield shape
  const shieldPath = "M480 100 L580 160 L580 320 Q580 400 480 440 Q380 400 380 320 L380 160 Z"

  // Scanning line rotating around shield
  const scanAngle = progress * Math.PI * 2 * 1.5
  const scanLen = 200
  const scanX = 480 + Math.cos(scanAngle) * scanLen
  const scanY = 270 + Math.sin(scanAngle) * scanLen

  // Shield pulse
  const shieldOpacity = interpolate(
    Math.sin(progress * Math.PI * 2),
    [-1, 1],
    [0.04, 0.1]
  )
  const shieldStroke = interpolate(
    Math.sin(progress * Math.PI * 2),
    [-1, 1],
    [0.08, 0.2]
  )

  // Barrier particles orbiting the shield
  const barriers = Array.from({ length: 30 }, (_, i) => {
    const angle = (i / 30) * Math.PI * 2 + progress * Math.PI * 0.8
    const radius = 160 + Math.sin(progress * Math.PI * 4 + i * 0.5) * 15
    const x = 480 + Math.cos(angle) * radius
    const y = 270 + Math.sin(angle) * radius * 0.8
    const opacity = interpolate(
      Math.sin(progress * Math.PI * 2 + i * 0.4),
      [-1, 1],
      [0.05, 0.25]
    )
    const size = 1.5 + Math.sin(progress * Math.PI * 3 + i) * 0.5
    return { x, y, opacity, size }
  })

  // Threat indicators (red dots that appear and get blocked)
  const threats = Array.from({ length: 6 }, (_, i) => {
    const t = ((progress * 1.5 + i * 0.167) % 1)
    const angle = (i / 6) * Math.PI * 2 + Math.PI * 0.3
    const outerR = 250
    const innerR = 160
    const r = interpolate(t, [0, 1], [outerR, innerR])
    const x = 480 + Math.cos(angle) * r
    const y = 270 + Math.sin(angle) * r * 0.8
    // Fade in, then flash red at barrier, then disappear
    const opacity = interpolate(t, [0, 0.3, 0.8, 0.9, 1], [0, 0.3, 0.3, 0.5, 0])
    const isBlocked = t > 0.85
    return { x, y, opacity, isBlocked }
  })

  // Concentric defense rings
  const defenseRings = Array.from({ length: 3 }, (_, i) => {
    const r = 120 + i * 40
    const dashOffset = progress * 300 * (i % 2 === 0 ? 1 : -1)
    const opacity = interpolate(
      Math.sin(progress * Math.PI * 2 + i * 1.5),
      [-1, 1],
      [0.02, 0.07]
    )
    return { r, dashOffset, opacity }
  })

  return (
    <AbsoluteFill style={{ background: "transparent" }}>
      <svg width="100%" height="100%" viewBox="0 0 960 540">
        <defs>
          <filter id="shieldGlow">
            <feGaussianBlur stdDeviation="8" />
          </filter>
        </defs>

        {/* Defense rings */}
        {defenseRings.map((ring, i) => (
          <ellipse
            key={`def-${i}`}
            cx="480"
            cy="270"
            rx={ring.r}
            ry={ring.r * 0.8}
            fill="none"
            stroke="oklch(0.70 0.24 145)"
            strokeWidth="0.5"
            opacity={ring.opacity}
            strokeDasharray="6 10"
            strokeDashoffset={ring.dashOffset}
          />
        ))}

        {/* Shield glow */}
        <path d={shieldPath} fill="oklch(0.70 0.24 145)" opacity={shieldOpacity * 0.5} filter="url(#shieldGlow)" />

        {/* Shield outline */}
        <path
          d={shieldPath}
          fill="oklch(0.70 0.24 145)"
          fillOpacity={shieldOpacity}
          stroke="oklch(0.70 0.24 145)"
          strokeWidth="1"
          opacity={shieldStroke}
        />

        {/* Scan line */}
        <line
          x1="480"
          y1="270"
          x2={scanX}
          y2={scanY}
          stroke="oklch(0.70 0.24 145)"
          strokeWidth="0.5"
          opacity={0.06}
        />

        {/* Barrier particles */}
        {barriers.map((b, i) => (
          <circle
            key={`b-${i}`}
            cx={b.x}
            cy={b.y}
            r={b.size}
            fill="oklch(0.70 0.24 145)"
            opacity={b.opacity}
          />
        ))}

        {/* Threats */}
        {threats.map((t, i) => (
          <circle
            key={`threat-${i}`}
            cx={t.x}
            cy={t.y}
            r={t.isBlocked ? 4 : 2.5}
            fill={t.isBlocked ? "oklch(0.65 0.24 27)" : "oklch(0.65 0.24 27)"}
            opacity={t.opacity}
          />
        ))}

        {/* Central lock icon (simple) */}
        <rect
          x="472"
          y="265"
          width="16"
          height="14"
          rx="2"
          fill="oklch(0.70 0.24 145)"
          opacity={0.3}
        />
        <path
          d="M475 265 L475 258 Q475 250 480 250 Q485 250 485 258 L485 265"
          fill="none"
          stroke="oklch(0.70 0.24 145)"
          strokeWidth="1.5"
          opacity={0.3}
        />
      </svg>
    </AbsoluteFill>
  )
}
