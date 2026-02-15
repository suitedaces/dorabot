import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate, spring } from "remotion"
import { C, WindowChrome } from "./shared"

export const GoalsDemo = () => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()

  const entrance = spring({ frame, fps, config: { damping: 200 } })

  const goals = [
    { title: "Ship dorabot README + landing page", status: "in_progress", priority: "high" },
    { title: "Study Castari as competitive intel", status: "proposed", priority: "medium" },
    { title: "Integrate SDK 0.2.42 features", status: "proposed", priority: "high" },
    { title: "Set up Stripe API integration", status: "approved", priority: "medium" },
  ]

  // Goals appear one by one
  const goalEntrances = goals.map((_, i) => {
    const delay = 20 + i * 18
    return spring({ frame, fps, delay, config: { damping: 200 } })
  })

  // Status change animation: first goal goes from in_progress to done
  const statusChangeFrame = 90
  const statusProgress = interpolate(frame, [statusChangeFrame, statusChangeFrame + 15], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })

  // Second goal gets approved
  const approveFrame = 115
  const approveProgress = interpolate(frame, [approveFrame, approveFrame + 15], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })

  const getStatusColor = (status: string, index: number) => {
    if (index === 0 && statusProgress > 0.5) return C.green
    if (index === 1 && approveProgress > 0.5) return C.accent
    if (status === "in_progress") return C.orange
    if (status === "proposed") return C.textMuted
    if (status === "approved") return C.accent
    return C.textMuted
  }

  const getStatusLabel = (status: string, index: number) => {
    if (index === 0 && statusProgress > 0.5) return "done"
    if (index === 1 && approveProgress > 0.5) return "approved"
    return status.replace("_", " ")
  }

  return (
    <AbsoluteFill style={{ background: "transparent", display: "flex", justifyContent: "center", alignItems: "center" }}>
      <div
        style={{
          width: 520,
          borderRadius: 12,
          overflow: "hidden",
          border: `1px solid ${C.border}`,
          background: C.bgCard,
          opacity: entrance,
          transform: `translateY(${interpolate(entrance, [0, 1], [20, 0])}px)`,
          boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
        }}
      >
        <WindowChrome title="goals" width={520} />

        <div style={{ padding: 16 }}>
          {/* Header */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
            <div style={{ fontSize: 13, color: C.text, fontFamily: "'JetBrains Mono', monospace", fontWeight: 600 }}>Active Goals</div>
            <div style={{ fontSize: 10, color: C.textMuted, fontFamily: "'JetBrains Mono', monospace" }}>4 items</div>
          </div>

          {/* Goal cards */}
          {goals.map((goal, i) => {
            const e = goalEntrances[i]
            return (
              <div
                key={i}
                style={{
                  opacity: e,
                  transform: `translateX(${interpolate(e, [0, 1], [-16, 0])}px)`,
                  padding: "10px 12px",
                  marginBottom: 6,
                  borderRadius: 8,
                  border: `1px solid ${C.border}`,
                  background: C.bg,
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                }}
              >
                {/* Status dot */}
                <div
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: getStatusColor(goal.status, i),
                    flexShrink: 0,
                  }}
                />

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontSize: 11,
                    color: i === 0 && statusProgress > 0.5 ? C.textSecondary : C.text,
                    fontFamily: "'JetBrains Mono', monospace",
                    textDecoration: i === 0 && statusProgress > 0.5 ? "line-through" : "none",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}>
                    {goal.title}
                  </div>
                </div>

                {/* Status badge */}
                <div
                  style={{
                    fontSize: 9,
                    color: getStatusColor(goal.status, i),
                    padding: "2px 6px",
                    borderRadius: 4,
                    border: `1px solid ${getStatusColor(goal.status, i)}33`,
                    fontFamily: "'JetBrains Mono', monospace",
                    flexShrink: 0,
                  }}
                >
                  {getStatusLabel(goal.status, i)}
                </div>

                {/* Priority */}
                <div style={{ fontSize: 9, color: goal.priority === "high" ? C.orange : C.textMuted, fontFamily: "'JetBrains Mono', monospace", flexShrink: 0 }}>
                  {goal.priority}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </AbsoluteFill>
  )
}
