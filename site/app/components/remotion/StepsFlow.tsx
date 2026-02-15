import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate } from "remotion"

export const StepsFlow = () => {
  const frame = useCurrentFrame()
  const { durationInFrames } = useVideoConfig()
  const progress = frame / durationInFrames

  // 4 nodes connected by flowing lines (vertical timeline)
  const nodes = [
    { x: 480, y: 80, label: "01" },
    { x: 480, y: 200, label: "02" },
    { x: 480, y: 320, label: "03" },
    { x: 480, y: 440, label: "04" },
  ]

  // Flow particles moving down the path
  const flowParticles = Array.from({ length: 20 }, (_, i) => {
    const t = ((progress * 3 + i * 0.05) % 1)
    const totalY = nodes[3].y - nodes[0].y
    const y = nodes[0].y + t * totalY
    const xWobble = Math.sin(t * Math.PI * 4 + progress * Math.PI * 2) * 15
    const opacity = interpolate(t, [0, 0.1, 0.9, 1], [0, 0.25, 0.25, 0])
    return { x: 480 + xWobble, y, opacity }
  })

  // Pulsing rings around each node
  const pulseRings = nodes.map((node, i) => {
    const ringScale = interpolate(
      Math.sin(progress * Math.PI * 2 + i * 1.5),
      [-1, 1],
      [0.8, 1.4]
    )
    const ringOpacity = interpolate(
      Math.sin(progress * Math.PI * 2 + i * 1.5),
      [-1, 1],
      [0.05, 0.15]
    )
    return { ...node, ringScale, ringOpacity }
  })

  // Horizontal scan line
  const scanY = interpolate(
    (progress * 2) % 1,
    [0, 1],
    [nodes[0].y - 20, nodes[3].y + 20]
  )
  const scanOpacity = interpolate(
    Math.sin(progress * Math.PI * 6),
    [-1, 1],
    [0.02, 0.06]
  )

  return (
    <AbsoluteFill style={{ background: "transparent" }}>
      <svg width="100%" height="100%" viewBox="0 0 960 540">
        {/* Scan line */}
        <line
          x1="200"
          y1={scanY}
          x2="760"
          y2={scanY}
          stroke="oklch(0.72 0.18 250)"
          strokeWidth="1"
          opacity={scanOpacity}
        />

        {/* Connection line */}
        <line
          x1="480"
          y1={nodes[0].y}
          x2="480"
          y2={nodes[3].y}
          stroke="oklch(0.72 0.18 250)"
          strokeWidth="0.5"
          opacity={0.08}
          strokeDasharray="4 6"
        />

        {/* Flow particles */}
        {flowParticles.map((fp, i) => (
          <circle
            key={`fp-${i}`}
            cx={fp.x}
            cy={fp.y}
            r={1.5}
            fill="oklch(0.68 0.19 310)"
            opacity={fp.opacity}
          />
        ))}

        {/* Nodes with pulse rings */}
        {pulseRings.map((node, i) => (
          <g key={`node-${i}`}>
            <circle
              cx={node.x}
              cy={node.y}
              r={28 * node.ringScale}
              fill="none"
              stroke="oklch(0.72 0.18 250)"
              strokeWidth="0.5"
              opacity={node.ringOpacity}
            />
            <circle
              cx={node.x}
              cy={node.y}
              r="16"
              fill="oklch(0.72 0.18 250)"
              opacity={0.06}
            />
            <circle
              cx={node.x}
              cy={node.y}
              r="4"
              fill={i === Math.floor((progress * 4) % 4) ? "oklch(0.70 0.24 145)" : "oklch(0.72 0.18 250)"}
              opacity={0.5}
            />
          </g>
        ))}

        {/* Side decorative lines */}
        {nodes.map((node, i) => {
          const lineLen = interpolate(
            Math.sin(progress * Math.PI * 2 + i * 0.8),
            [-1, 1],
            [30, 80]
          )
          const lineOpacity = interpolate(
            Math.sin(progress * Math.PI * 2 + i * 0.8),
            [-1, 1],
            [0.02, 0.06]
          )
          return (
            <g key={`side-${i}`}>
              <line
                x1={node.x - 30}
                y1={node.y}
                x2={node.x - 30 - lineLen}
                y2={node.y}
                stroke="oklch(0.72 0.18 250)"
                strokeWidth="0.5"
                opacity={lineOpacity}
              />
              <line
                x1={node.x + 30}
                y1={node.y}
                x2={node.x + 30 + lineLen}
                y2={node.y}
                stroke="oklch(0.72 0.18 250)"
                strokeWidth="0.5"
                opacity={lineOpacity}
              />
            </g>
          )
        })}
      </svg>
    </AbsoluteFill>
  )
}
