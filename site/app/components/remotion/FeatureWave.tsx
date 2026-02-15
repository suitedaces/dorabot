import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate } from "remotion"

export const FeatureWave = () => {
  const frame = useCurrentFrame()
  const { durationInFrames } = useVideoConfig()
  const progress = frame / durationInFrames

  // Horizontal flowing wave lines
  const waves = Array.from({ length: 5 }, (_, i) => {
    const yBase = 100 + i * 80
    const amplitude = 20 + i * 5
    const frequency = 2 + i * 0.3
    const speed = progress * Math.PI * 2 * (i % 2 === 0 ? 1 : -0.7)
    const opacity = interpolate(
      Math.sin(progress * Math.PI * 2 + i),
      [-1, 1],
      [0.02, 0.08]
    )

    const points: string[] = []
    for (let x = 0; x <= 1920; x += 10) {
      const xNorm = x / 1920
      const y = yBase + Math.sin(xNorm * Math.PI * frequency + speed) * amplitude
      points.push(`${x},${y}`)
    }

    return { points: points.join(" "), opacity, color: i % 2 === 0 ? "oklch(0.72 0.18 250)" : "oklch(0.68 0.19 310)" }
  })

  // Floating nodes on the waves
  const nodes = Array.from({ length: 12 }, (_, i) => {
    const waveIdx = i % 5
    const xPos = ((i * 160 + progress * 400) % 1920)
    const yBase = 100 + waveIdx * 80
    const frequency = 2 + waveIdx * 0.3
    const speed = progress * Math.PI * 2 * (waveIdx % 2 === 0 ? 1 : -0.7)
    const xNorm = xPos / 1920
    const yPos = yBase + Math.sin(xNorm * Math.PI * frequency + speed) * (20 + waveIdx * 5)
    const size = 2 + Math.sin(progress * Math.PI * 3 + i) * 1
    const opacity = interpolate(
      Math.sin(progress * Math.PI * 2 + i * 0.7),
      [-1, 1],
      [0.08, 0.3]
    )

    return { x: xPos, y: yPos, size, opacity }
  })

  return (
    <AbsoluteFill style={{ background: "transparent" }}>
      <svg width="100%" height="100%" viewBox="0 0 1920 540">
        {waves.map((wave, i) => (
          <polyline
            key={i}
            points={wave.points}
            fill="none"
            stroke={wave.color}
            strokeWidth="1"
            opacity={wave.opacity}
          />
        ))}
        {nodes.map((node, i) => (
          <circle
            key={`n-${i}`}
            cx={node.x}
            cy={node.y}
            r={node.size}
            fill="oklch(0.72 0.18 250)"
            opacity={node.opacity}
          />
        ))}
      </svg>
    </AbsoluteFill>
  )
}
