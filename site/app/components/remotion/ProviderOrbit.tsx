import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate } from "remotion"

export const ProviderOrbit = () => {
  const frame = useCurrentFrame()
  const { durationInFrames } = useVideoConfig()
  const progress = frame / durationInFrames

  const providers = [
    { label: "C", color: "oklch(0.72 0.18 250)", orbitR: 120, speed: 1 },
    { label: "O", color: "oklch(0.70 0.24 145)", orbitR: 170, speed: -0.7 },
    { label: "M", color: "oklch(0.74 0.19 80)", orbitR: 220, speed: 0.5 },
  ]

  // Orbit trails
  const trails = providers.map((p, i) => {
    const segments = 60
    return Array.from({ length: segments }, (_, s) => {
      const t = progress + (s / segments) * 0.15
      const angle = t * Math.PI * 2 * p.speed + (i * Math.PI * 2) / 3
      const x = 480 + Math.cos(angle) * p.orbitR
      const y = 270 + Math.sin(angle) * p.orbitR * 0.6
      const opacity = interpolate(s, [0, segments - 1], [0.15, 0.01])
      return { x, y, opacity }
    })
  })

  // Data flow particles between orbits
  const flowParticles = Array.from({ length: 16 }, (_, i) => {
    const t = (progress * 2 + i * 0.0625) % 1
    const fromR = 40
    const toR = 120 + (i % 3) * 50
    const angle = (i / 16) * Math.PI * 2 + progress * Math.PI
    const r = interpolate(t, [0, 1], [fromR, toR])
    const x = 480 + Math.cos(angle) * r
    const y = 270 + Math.sin(angle) * r * 0.6
    const opacity = interpolate(t, [0, 0.3, 0.7, 1], [0, 0.2, 0.2, 0])
    return { x, y, opacity }
  })

  return (
    <AbsoluteFill style={{ background: "transparent" }}>
      <svg width="100%" height="100%" viewBox="0 0 960 540">
        <defs>
          <filter id="provGlow">
            <feGaussianBlur stdDeviation="4" />
          </filter>
        </defs>

        {/* Orbit rings */}
        {providers.map((p, i) => (
          <ellipse
            key={`orbit-${i}`}
            cx="480"
            cy="270"
            rx={p.orbitR}
            ry={p.orbitR * 0.6}
            fill="none"
            stroke={p.color}
            strokeWidth="0.5"
            opacity={0.08}
            strokeDasharray="4 8"
          />
        ))}

        {/* Trails */}
        {trails.map((trail, ti) =>
          trail.map((seg, si) => (
            <circle
              key={`trail-${ti}-${si}`}
              cx={seg.x}
              cy={seg.y}
              r={1}
              fill={providers[ti].color}
              opacity={seg.opacity}
            />
          ))
        )}

        {/* Flow particles */}
        {flowParticles.map((fp, i) => (
          <circle
            key={`flow-${i}`}
            cx={fp.x}
            cy={fp.y}
            r={1.5}
            fill="oklch(0.72 0.18 250)"
            opacity={fp.opacity}
          />
        ))}

        {/* Central hub */}
        <circle cx="480" cy="270" r="30" fill="oklch(0.72 0.18 250)" opacity={0.06} filter="url(#provGlow)" />
        <circle cx="480" cy="270" r="4" fill="oklch(0.72 0.18 250)" opacity={0.4} />

        {/* Provider nodes */}
        {providers.map((p, i) => {
          const angle = progress * Math.PI * 2 * p.speed + (i * Math.PI * 2) / 3
          const x = 480 + Math.cos(angle) * p.orbitR
          const y = 270 + Math.sin(angle) * p.orbitR * 0.6
          const pulse = interpolate(
            Math.sin(progress * Math.PI * 4 + i),
            [-1, 1],
            [0.4, 0.8]
          )
          return (
            <g key={`prov-${i}`}>
              <circle cx={x} cy={y} r="14" fill={p.color} opacity={0.1} filter="url(#provGlow)" />
              <circle cx={x} cy={y} r="6" fill={p.color} opacity={pulse} />
              <text x={x} y={y + 1.5} textAnchor="middle" fill="oklch(0.14 0.005 270)" fontSize="6" fontWeight="bold" fontFamily="monospace">
                {p.label}
              </text>
            </g>
          )
        })}
      </svg>
    </AbsoluteFill>
  )
}
