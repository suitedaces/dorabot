import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate, spring } from "remotion"
import { C, WindowChrome } from "./shared"

export const ScheduleDemo = () => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()

  const entrance = spring({ frame, fps, config: { damping: 200 } })

  const schedules = [
    { time: "9:00 AM", label: "Daily standup prep", recurrence: "FREQ=DAILY", active: true, delay: 15 },
    { time: "12:00 PM", label: "Check HN + Reddit for AI news", recurrence: "FREQ=DAILY", active: true, delay: 30 },
    { time: "6:00 PM", label: "Evening digest to Telegram", recurrence: "FREQ=DAILY", active: true, delay: 45 },
    { time: "Mon 10 AM", label: "Weekly goal review", recurrence: "FREQ=WEEKLY", active: true, delay: 60 },
  ]

  // New schedule being created
  const createStart = 85
  const createMsg = "every friday at 5pm, remind me to do my expense report"
  const createTyped = Math.min(createMsg.length, Math.floor(Math.max(0, frame - createStart) * 0.8))

  const confirmStart = createStart + createMsg.length / 0.8 + 15
  const confirmOpacity = interpolate(frame, [confirmStart, confirmStart + 12], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })

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
        <WindowChrome title="scheduled tasks" width={520} accent={C.orange} />

        <div style={{ padding: 16 }}>
          {/* Existing schedules */}
          {schedules.map((s, i) => {
            const e = spring({ frame, fps, delay: s.delay, config: { damping: 200 } })
            return (
              <div
                key={i}
                style={{
                  opacity: e,
                  transform: `translateX(${interpolate(e, [0, 1], [-12, 0])}px)`,
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "8px 0",
                  borderBottom: `1px solid ${C.border}`,
                }}
              >
                <div style={{ width: 70, fontSize: 10, color: C.accent, fontFamily: "'JetBrains Mono', monospace", fontWeight: 500, flexShrink: 0 }}>
                  {s.time}
                </div>
                <div style={{ flex: 1, fontSize: 11, color: C.text, fontFamily: "'JetBrains Mono', monospace" }}>
                  {s.label}
                </div>
                <div style={{ fontSize: 8, color: C.textMuted, fontFamily: "'JetBrains Mono', monospace", padding: "2px 5px", borderRadius: 3, border: `1px solid ${C.border}`, flexShrink: 0 }}>
                  {s.recurrence}
                </div>
              </div>
            )
          })}

          {/* Creating new schedule */}
          {createTyped > 0 && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 9, color: C.textMuted, fontFamily: "'JetBrains Mono', monospace", marginBottom: 4 }}>New request:</div>
              <div style={{ padding: "8px 10px", borderRadius: 8, background: C.bg, border: `1px solid ${C.accent}44`, fontSize: 11, color: C.text, fontFamily: "'JetBrains Mono', monospace", lineHeight: 1.5 }}>
                {createMsg.slice(0, createTyped)}
                {createTyped < createMsg.length && (
                  <span style={{ display: "inline-block", width: 7, height: 13, background: C.green, marginLeft: 1, verticalAlign: "middle", borderRadius: 1 }} />
                )}
              </div>
            </div>
          )}

          {/* Confirmation */}
          {confirmOpacity > 0 && (
            <div style={{ marginTop: 8, opacity: confirmOpacity, padding: "8px 10px", borderRadius: 8, background: `${C.green}11`, border: `1px solid ${C.green}33`, fontSize: 11, fontFamily: "'JetBrains Mono', monospace" }}>
              <span style={{ color: C.green }}>&#10003;</span>
              <span style={{ color: C.text }}> Scheduled: </span>
              <span style={{ color: C.accent }}>Fri 5:00 PM</span>
              <span style={{ color: C.textSecondary }}> - expense report reminder</span>
            </div>
          )}
        </div>
      </div>
    </AbsoluteFill>
  )
}
