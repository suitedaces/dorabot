import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate } from "remotion"

export const ArchitectureFlow = () => {
  const frame = useCurrentFrame()
  const { durationInFrames } = useVideoConfig()
  const progress = frame / durationInFrames

  // Network topology: gateway in center, channels on top, services below
  const gateway = { x: 480, y: 270 }

  const channels = [
    { x: 240, y: 100, label: "D" },
    { x: 400, y: 80, label: "T" },
    { x: 560, y: 80, label: "W" },
    { x: 720, y: 100, label: "S" },
  ]

  const services = [
    { x: 300, y: 440, label: "MCP" },
    { x: 480, y: 460, label: "DB" },
    { x: 660, y: 440, label: "CRON" },
  ]

  // Data packets flowing along connections
  const packets = Array.from({ length: 24 }, (_, i) => {
    const isUpstream = i < 12
    const connIdx = i % 4
    const source = isUpstream ? channels[connIdx] : gateway
    const target = isUpstream ? gateway : services[i % 3]
    const t = ((progress * 2 + i * 0.083) % 1)
    const x = interpolate(t, [0, 1], [source.x, target.x])
    const y = interpolate(t, [0, 1], [source.y, target.y])
    const opacity = interpolate(t, [0, 0.1, 0.9, 1], [0, 0.3, 0.3, 0])
    return { x, y, opacity, color: isUpstream ? "oklch(0.72 0.18 250)" : "oklch(0.68 0.19 310)" }
  })

  // Hex grid background
  const hexSize = 30
  const hexes: { x: number; y: number; opacity: number }[] = []
  for (let row = 0; row < 10; row++) {
    for (let col = 0; col < 18; col++) {
      const x = col * hexSize * 1.75 + (row % 2 ? hexSize * 0.875 : 0)
      const y = row * hexSize * 1.5 + 20
      const dist = Math.hypot(x - gateway.x, y - gateway.y)
      const opacity = interpolate(
        Math.sin(progress * Math.PI * 2 + dist * 0.01),
        [-1, 1],
        [0.01, 0.04]
      )
      hexes.push({ x, y, opacity })
    }
  }

  const hexPath = (cx: number, cy: number, r: number) => {
    const pts = Array.from({ length: 6 }, (_, i) => {
      const angle = (Math.PI / 3) * i - Math.PI / 6
      return `${cx + r * Math.cos(angle)},${cy + r * Math.sin(angle)}`
    })
    return `M${pts.join("L")}Z`
  }

  return (
    <AbsoluteFill style={{ background: "transparent" }}>
      <svg width="100%" height="100%" viewBox="0 0 960 540">
        {/* Hex grid */}
        {hexes.map((h, i) => (
          <path
            key={`hex-${i}`}
            d={hexPath(h.x, h.y, 12)}
            fill="none"
            stroke="oklch(0.72 0.18 250)"
            strokeWidth="0.3"
            opacity={h.opacity}
          />
        ))}

        {/* Connection lines */}
        {channels.map((ch, i) => (
          <line
            key={`conn-up-${i}`}
            x1={ch.x}
            y1={ch.y}
            x2={gateway.x}
            y2={gateway.y}
            stroke="oklch(0.72 0.18 250)"
            strokeWidth="0.5"
            opacity={0.06}
          />
        ))}
        {services.map((sv, i) => (
          <line
            key={`conn-dn-${i}`}
            x1={gateway.x}
            y1={gateway.y}
            x2={sv.x}
            y2={sv.y}
            stroke="oklch(0.68 0.19 310)"
            strokeWidth="0.5"
            opacity={0.06}
          />
        ))}

        {/* Data packets */}
        {packets.map((p, i) => (
          <circle
            key={`pkt-${i}`}
            cx={p.x}
            cy={p.y}
            r={2}
            fill={p.color}
            opacity={p.opacity}
          />
        ))}

        {/* Gateway node */}
        <circle cx={gateway.x} cy={gateway.y} r="24" fill="oklch(0.72 0.18 250)" opacity={0.08} />
        <circle
          cx={gateway.x}
          cy={gateway.y}
          r={interpolate(Math.sin(progress * Math.PI * 2), [-1, 1], [6, 8])}
          fill="oklch(0.72 0.18 250)"
          opacity={0.5}
        />

        {/* Channel nodes */}
        {channels.map((ch, i) => {
          const pulse = interpolate(
            Math.sin(progress * Math.PI * 3 + i),
            [-1, 1],
            [0.2, 0.5]
          )
          return (
            <g key={`ch-${i}`}>
              <circle cx={ch.x} cy={ch.y} r="12" fill="oklch(0.72 0.18 250)" opacity={0.06} />
              <circle cx={ch.x} cy={ch.y} r="4" fill="oklch(0.72 0.18 250)" opacity={pulse} />
            </g>
          )
        })}

        {/* Service nodes */}
        {services.map((sv, i) => {
          const pulse = interpolate(
            Math.sin(progress * Math.PI * 3 + i + 2),
            [-1, 1],
            [0.2, 0.5]
          )
          return (
            <g key={`sv-${i}`}>
              <circle cx={sv.x} cy={sv.y} r="12" fill="oklch(0.68 0.19 310)" opacity={0.06} />
              <circle cx={sv.x} cy={sv.y} r="4" fill="oklch(0.68 0.19 310)" opacity={pulse} />
            </g>
          )
        })}
      </svg>
    </AbsoluteFill>
  )
}
