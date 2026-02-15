import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate, spring } from "remotion"
import { C, WindowChrome, Cursor } from "./shared"

export const ChatDemo = () => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()

  // Scene: User sends a message on Telegram, agent responds

  const userMsg = "remind me to call the dentist tomorrow at 9am"
  const agentMsg = "Done. Reminder set for tomorrow (Feb 15) at 9:00 AM PST."
  const agentMsg2 = "I'll message you on Telegram when it's time."

  // Typewriter timings
  const userTyped = Math.min(userMsg.length, Math.floor(Math.max(0, frame - 15) * 0.9))
  const userDone = frame > 15 + userMsg.length / 0.9
  const agentStart = Math.floor(15 + userMsg.length / 0.9 + 20)
  const agentTyped = Math.min(agentMsg.length, Math.floor(Math.max(0, frame - agentStart) * 1.2))
  const agent2Start = agentStart + agentMsg.length / 1.2 + 8
  const agent2Typed = Math.min(agentMsg2.length, Math.floor(Math.max(0, frame - agent2Start) * 1.2))

  // Entrance
  const entrance = spring({ frame, fps, config: { damping: 200 } })

  // Cursor blink
  const cursorOn = Math.floor(frame / 8) % 2 === 0

  // Check mark animation
  const checkFrame = agentStart + 5
  const checkOpacity = interpolate(frame, [checkFrame, checkFrame + 10], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })

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
        <WindowChrome title="telegram - dorabot" width={520} accent={C.green} />

        <div style={{ padding: 16, minHeight: 200, position: "relative" }}>
          {/* Channel indicator */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
            <div style={{ width: 28, height: 28, borderRadius: "50%", background: C.accent, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, color: C.bg, fontWeight: "bold", fontFamily: "'JetBrains Mono', monospace" }}>
              D
            </div>
            <div>
              <div style={{ fontSize: 12, color: C.text, fontFamily: "'JetBrains Mono', monospace", fontWeight: 500 }}>dorabot</div>
              <div style={{ fontSize: 9, color: C.green, fontFamily: "'JetBrains Mono', monospace" }}>online</div>
            </div>
          </div>

          {/* User message */}
          {userTyped > 0 && (
            <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
              <div
                style={{
                  maxWidth: "80%",
                  padding: "8px 12px",
                  borderRadius: "12px 12px 2px 12px",
                  background: C.accent,
                  color: "#fff",
                  fontSize: 12,
                  fontFamily: "'JetBrains Mono', monospace",
                  lineHeight: 1.5,
                }}
              >
                {userMsg.slice(0, userTyped)}
                {!userDone && <Cursor visible={cursorOn} />}
              </div>
            </div>
          )}

          {/* Agent response */}
          {agentTyped > 0 && (
            <div style={{ display: "flex", justifyContent: "flex-start", marginBottom: 8 }}>
              <div
                style={{
                  maxWidth: "85%",
                  padding: "8px 12px",
                  borderRadius: "12px 12px 12px 2px",
                  background: C.bgSurface,
                  color: C.text,
                  fontSize: 12,
                  fontFamily: "'JetBrains Mono', monospace",
                  lineHeight: 1.5,
                }}
              >
                <span style={{ color: C.green, opacity: checkOpacity }}>&#10003; </span>
                {agentMsg.slice(0, agentTyped)}
              </div>
            </div>
          )}

          {/* Agent response 2 */}
          {agent2Typed > 0 && (
            <div style={{ display: "flex", justifyContent: "flex-start" }}>
              <div
                style={{
                  maxWidth: "85%",
                  padding: "8px 12px",
                  borderRadius: "12px 12px 12px 2px",
                  background: C.bgSurface,
                  color: C.textSecondary,
                  fontSize: 11,
                  fontFamily: "'JetBrains Mono', monospace",
                  lineHeight: 1.5,
                }}
              >
                {agentMsg2.slice(0, agent2Typed)}
              </div>
            </div>
          )}
        </div>
      </div>
    </AbsoluteFill>
  )
}
