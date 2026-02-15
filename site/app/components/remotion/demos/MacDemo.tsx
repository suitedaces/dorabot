import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate, spring } from "remotion"
import { C, WindowChrome } from "./shared"

export const MacDemo = () => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()

  const entrance = spring({ frame, fps, config: { damping: 200 } })

  // Scene: Agent controls Mac - moves windows, launches apps, controls Spotify
  const commands = [
    { cmd: "osascript: move Safari to left half", status: "done", icon: "◧", delay: 15 },
    { cmd: "osascript: move Terminal to right half", status: "done", icon: "◨", delay: 40 },
    { cmd: "osascript: launch Spotify", status: "done", icon: "♫", delay: 65 },
    { cmd: 'osascript: play "Feather" by Nujabes', status: "done", icon: "▶", delay: 90 },
    { cmd: "osascript: set volume to 40%", status: "done", icon: "◉", delay: 110 },
  ]

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
        <WindowChrome title="mac control - applescript" width={520} accent={C.accent} />

        <div style={{ padding: 16 }}>
          {/* Mini desktop preview */}
          <div style={{ marginBottom: 14, padding: 8, borderRadius: 8, border: `1px solid ${C.border}`, background: C.bg, display: "flex", gap: 4, height: 60, overflow: "hidden" }}>
            {/* Left window */}
            <div style={{
              flex: 1,
              borderRadius: 4,
              border: `1px solid ${C.border}`,
              background: C.bgSurface,
              opacity: interpolate(frame, [15, 30], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
              transform: `translateX(${interpolate(frame, [15, 30], [-20, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })}px)`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 8,
              color: C.textMuted,
              fontFamily: "'JetBrains Mono', monospace",
            }}>
              Safari
            </div>
            {/* Right window */}
            <div style={{
              flex: 1,
              borderRadius: 4,
              border: `1px solid ${C.border}`,
              background: C.bgSurface,
              opacity: interpolate(frame, [40, 55], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
              transform: `translateX(${interpolate(frame, [40, 55], [20, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })}px)`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 8,
              color: C.textMuted,
              fontFamily: "'JetBrains Mono', monospace",
            }}>
              Terminal
            </div>
          </div>

          {/* Command log */}
          {commands.map((cmd, i) => {
            const cmdEntrance = spring({ frame, fps, delay: cmd.delay, config: { damping: 200 } })
            const doneDelay = cmd.delay + 12
            const doneOpacity = interpolate(frame, [doneDelay, doneDelay + 8], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })

            return (
              <div
                key={i}
                style={{
                  opacity: cmdEntrance,
                  transform: `translateY(${interpolate(cmdEntrance, [0, 1], [8, 0])}px)`,
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "5px 0",
                  borderBottom: i < commands.length - 1 ? `1px solid ${C.border}` : "none",
                }}
              >
                <span style={{ fontSize: 12, width: 18, textAlign: "center" }}>{cmd.icon}</span>
                <span style={{ flex: 1, fontSize: 11, color: C.text, fontFamily: "'JetBrains Mono', monospace" }}>
                  {cmd.cmd}
                </span>
                <span style={{ fontSize: 10, color: C.green, fontFamily: "'JetBrains Mono', monospace", opacity: doneOpacity }}>
                  &#10003;
                </span>
              </div>
            )
          })}

          {/* Now playing bar */}
          {frame > 95 && (
            <div style={{
              marginTop: 12,
              padding: "8px 10px",
              borderRadius: 8,
              background: `${C.green}11`,
              border: `1px solid ${C.green}33`,
              display: "flex",
              alignItems: "center",
              gap: 8,
              opacity: interpolate(frame, [95, 110], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
            }}>
              <span style={{ fontSize: 12 }}>▶</span>
              <div>
                <div style={{ fontSize: 11, color: C.text, fontFamily: "'JetBrains Mono', monospace" }}>Feather</div>
                <div style={{ fontSize: 9, color: C.textSecondary, fontFamily: "'JetBrains Mono', monospace" }}>Nujabes - Modal Soul</div>
              </div>
              <div style={{ marginLeft: "auto", fontSize: 10, color: C.textMuted, fontFamily: "'JetBrains Mono', monospace" }}>
                vol: 40%
              </div>
            </div>
          )}
        </div>
      </div>
    </AbsoluteFill>
  )
}
