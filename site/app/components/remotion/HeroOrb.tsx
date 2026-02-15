import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate, spring } from "remotion"

export const HeroOrb = () => {
  const frame = useCurrentFrame()
  const { fps, durationInFrames } = useVideoConfig()

  const progress = frame / durationInFrames

  // Central pulsing orb
  const orbScale = interpolate(
    Math.sin(progress * Math.PI * 2),
    [-1, 1],
    [0.85, 1.15]
  )
  const orbGlow = interpolate(
    Math.sin(progress * Math.PI * 2 + 0.5),
    [-1, 1],
    [0.3, 0.8]
  )

  // Orbiting particles
  const particles = Array.from({ length: 24 }, (_, i) => {
    const angle = (i / 24) * Math.PI * 2 + progress * Math.PI * 2 * (i % 2 === 0 ? 1 : -0.6)
    const radius = 180 + Math.sin(progress * Math.PI * 4 + i) * 40
    const size = 2 + Math.sin(progress * Math.PI * 3 + i * 0.8) * 1.5
    const opacity = interpolate(
      Math.sin(progress * Math.PI * 2 + i * 0.5),
      [-1, 1],
      [0.05, 0.4]
    )
    return { angle, radius, size, opacity }
  })

  // Connection arcs
  const arcs = Array.from({ length: 6 }, (_, i) => {
    const startAngle = (i / 6) * Math.PI * 2 + progress * Math.PI * 1.5
    const sweep = Math.PI * 0.8
    const radius = 140 + i * 25
    const opacity = interpolate(
      Math.sin(progress * Math.PI * 2 + i * 1.2),
      [-1, 1],
      [0.02, 0.12]
    )
    return { startAngle, sweep, radius, opacity }
  })

  // Floating rings
  const rings = Array.from({ length: 3 }, (_, i) => {
    const r = 120 + i * 70
    const rotation = progress * 360 * (i % 2 === 0 ? 1 : -1) * 0.3
    const opacity = interpolate(
      Math.sin(progress * Math.PI * 2 + i * 2),
      [-1, 1],
      [0.03, 0.1]
    )
    const dashOffset = progress * 600
    return { r, rotation, opacity, dashOffset }
  })

  return (
    <AbsoluteFill style={{ background: "transparent" }}>
      <svg width="100%" height="100%" viewBox="0 0 960 540">
        <defs>
          <radialGradient id="orbGrad" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="oklch(0.72 0.18 250)" stopOpacity={orbGlow * 0.6} />
            <stop offset="40%" stopColor="oklch(0.68 0.19 310)" stopOpacity={orbGlow * 0.3} />
            <stop offset="100%" stopColor="oklch(0.72 0.18 250)" stopOpacity={0} />
          </radialGradient>
          <radialGradient id="outerGlow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="oklch(0.72 0.18 250)" stopOpacity={0.08} />
            <stop offset="100%" stopColor="oklch(0.72 0.18 250)" stopOpacity={0} />
          </radialGradient>
          <filter id="blur">
            <feGaussianBlur stdDeviation="2" />
          </filter>
          <filter id="bigBlur">
            <feGaussianBlur stdDeviation="30" />
          </filter>
        </defs>

        {/* Outer glow */}
        <circle cx="480" cy="270" r="250" fill="url(#outerGlow)" filter="url(#bigBlur)" />

        {/* Floating rings */}
        {rings.map((ring, i) => (
          <circle
            key={`ring-${i}`}
            cx="480"
            cy="270"
            r={ring.r}
            fill="none"
            stroke="oklch(0.72 0.18 250)"
            strokeWidth="0.5"
            opacity={ring.opacity}
            strokeDasharray="8 16"
            strokeDashoffset={ring.dashOffset}
            transform={`rotate(${ring.rotation} 480 270)`}
          />
        ))}

        {/* Connection arcs */}
        {arcs.map((arc, i) => {
          const x1 = 480 + Math.cos(arc.startAngle) * arc.radius
          const y1 = 270 + Math.sin(arc.startAngle) * arc.radius
          const x2 = 480 + Math.cos(arc.startAngle + arc.sweep) * arc.radius
          const y2 = 270 + Math.sin(arc.startAngle + arc.sweep) * arc.radius
          return (
            <path
              key={`arc-${i}`}
              d={`M ${x1} ${y1} A ${arc.radius} ${arc.radius} 0 0 1 ${x2} ${y2}`}
              fill="none"
              stroke="oklch(0.68 0.19 310)"
              strokeWidth="0.8"
              opacity={arc.opacity}
            />
          )
        })}

        {/* Central orb */}
        <circle
          cx="480"
          cy="270"
          r={40 * orbScale}
          fill="url(#orbGrad)"
          filter="url(#blur)"
        />
        <circle
          cx="480"
          cy="270"
          r={8 * orbScale}
          fill="oklch(0.72 0.18 250)"
          opacity={0.6}
        />

        {/* Orbiting particles */}
        {particles.map((p, i) => {
          const x = 480 + Math.cos(p.angle) * p.radius
          const y = 270 + Math.sin(p.angle) * p.radius
          return (
            <circle
              key={`p-${i}`}
              cx={x}
              cy={y}
              r={p.size}
              fill={i % 3 === 0 ? "oklch(0.68 0.19 310)" : "oklch(0.72 0.18 250)"}
              opacity={p.opacity}
            />
          )
        })}

        {/* Radial pulse lines */}
        {Array.from({ length: 8 }, (_, i) => {
          const angle = (i / 8) * Math.PI * 2 + progress * Math.PI * 0.5
          const len = interpolate(
            Math.sin(progress * Math.PI * 4 + i * 1.5),
            [-1, 1],
            [30, 80]
          )
          const innerR = 50
          const x1 = 480 + Math.cos(angle) * innerR
          const y1 = 270 + Math.sin(angle) * innerR
          const x2 = 480 + Math.cos(angle) * (innerR + len)
          const y2 = 270 + Math.sin(angle) * (innerR + len)
          const opacity = interpolate(
            Math.sin(progress * Math.PI * 2 + i),
            [-1, 1],
            [0.03, 0.1]
          )
          return (
            <line
              key={`ray-${i}`}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke="oklch(0.72 0.18 250)"
              strokeWidth="0.5"
              opacity={opacity}
            />
          )
        })}
      </svg>
    </AbsoluteFill>
  )
}
