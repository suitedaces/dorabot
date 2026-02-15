import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate, spring } from "remotion"
import { C, WindowChrome } from "./shared"

export const EmailDemo = () => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()

  const entrance = spring({ frame, fps, config: { damping: 200 } })

  // Scene: Agent composes and sends an email
  const to = "dentist@sfsmiles.com"
  const subject = "Appointment Reschedule Request"
  const body = "Hi, I'd like to reschedule my appointment from Feb 18 to Feb 20 at 2pm if available. Thank you!"

  const toTyped = Math.min(to.length, Math.floor(Math.max(0, frame - 15) * 1.2))
  const subjectStart = 15 + to.length / 1.2 + 8
  const subjectTyped = Math.min(subject.length, Math.floor(Math.max(0, frame - subjectStart) * 1.2))
  const bodyStart = subjectStart + subject.length / 1.2 + 8
  const bodyTyped = Math.min(body.length, Math.floor(Math.max(0, frame - bodyStart) * 1))

  // Send button
  const sendFrame = bodyStart + body.length + 15
  const sendPulse = frame >= sendFrame && frame < sendFrame + 10
    ? interpolate(frame, [sendFrame, sendFrame + 5, sendFrame + 10], [1, 0.92, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })
    : 1
  const sentOpacity = interpolate(frame, [sendFrame + 12, sendFrame + 20], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })

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
        <WindowChrome title="email - himalaya" width={520} accent={C.orange} />

        <div style={{ padding: 16 }}>
          {/* Compose form */}
          <div style={{ marginBottom: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, paddingBottom: 8, borderBottom: `1px solid ${C.border}` }}>
              <span style={{ fontSize: 10, color: C.textMuted, fontFamily: "'JetBrains Mono', monospace", width: 50 }}>To:</span>
              <span style={{ fontSize: 12, color: C.text, fontFamily: "'JetBrains Mono', monospace" }}>
                {to.slice(0, toTyped)}
              </span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, paddingBottom: 8, borderBottom: `1px solid ${C.border}` }}>
              <span style={{ fontSize: 10, color: C.textMuted, fontFamily: "'JetBrains Mono', monospace", width: 50 }}>Subject:</span>
              <span style={{ fontSize: 12, color: C.text, fontFamily: "'JetBrains Mono', monospace", fontWeight: 500 }}>
                {subject.slice(0, subjectTyped)}
              </span>
            </div>
          </div>

          {/* Body */}
          <div style={{ minHeight: 80, padding: 8, borderRadius: 8, background: C.bg, border: `1px solid ${C.border}`, marginBottom: 12 }}>
            <div style={{ fontSize: 12, color: C.text, fontFamily: "'JetBrains Mono', monospace", lineHeight: 1.6 }}>
              {body.slice(0, bodyTyped)}
              {bodyTyped > 0 && bodyTyped < body.length && (
                <span style={{ display: "inline-block", width: 7, height: 13, background: C.green, marginLeft: 1, verticalAlign: "middle", borderRadius: 1 }} />
              )}
            </div>
          </div>

          {/* Send button + status */}
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "6px 16px",
                borderRadius: 6,
                background: frame >= sendFrame ? C.green : C.accent,
                color: "#fff",
                fontSize: 11,
                fontWeight: 600,
                fontFamily: "'JetBrains Mono', monospace",
                transform: `scale(${sendPulse})`,
              }}
            >
              {frame >= sendFrame + 12 ? "✓ Sent" : "Send"}
            </div>
            <span style={{ fontSize: 10, color: C.green, fontFamily: "'JetBrains Mono', monospace", opacity: sentOpacity }}>
              Email delivered via SMTP
            </span>
          </div>
        </div>
      </div>
    </AbsoluteFill>
  )
}
