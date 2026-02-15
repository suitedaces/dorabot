import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate, spring } from "remotion"
import { C, WindowChrome } from "./shared"

export const BrowserDemo = () => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()

  const entrance = spring({ frame, fps, config: { damping: 200 } })

  // Scene: Agent navigates to a page, fills a form, clicks submit
  const urlText = "https://booking.com/search"
  const urlTyped = Math.min(urlText.length, Math.floor(Math.max(0, frame - 10) * 1.5))

  // Page "loads" after URL is typed
  const pageStart = 10 + urlText.length / 1.5 + 15
  const pageOpacity = interpolate(frame, [pageStart, pageStart + 15], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })

  // Fill form field
  const fieldText = "San Francisco, Feb 20-22"
  const fieldStart = pageStart + 20
  const fieldTyped = Math.min(fieldText.length, Math.floor(Math.max(0, frame - fieldStart) * 1))

  // Click animation
  const clickStart = fieldStart + fieldText.length + 15
  const clickScale = frame >= clickStart && frame < clickStart + 8
    ? interpolate(frame, [clickStart, clickStart + 4, clickStart + 8], [1, 0.95, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })
    : 1

  // Status messages
  const status1Start = clickStart + 12
  const status2Start = status1Start + 25
  const status1Opacity = interpolate(frame, [status1Start, status1Start + 8], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })
  const status2Opacity = interpolate(frame, [status2Start, status2Start + 8], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })

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
        <WindowChrome title="browser automation" width={520} accent={C.purple} />

        {/* URL bar */}
        <div style={{ padding: "6px 12px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ display: "flex", gap: 4 }}>
            <div style={{ width: 14, height: 14, borderRadius: 4, border: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 8, color: C.textMuted }}>&larr;</div>
            <div style={{ width: 14, height: 14, borderRadius: 4, border: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 8, color: C.textMuted }}>&rarr;</div>
          </div>
          <div style={{ flex: 1, padding: "4px 8px", borderRadius: 6, background: C.bg, fontSize: 11, color: C.accent, fontFamily: "'JetBrains Mono', monospace" }}>
            {urlText.slice(0, urlTyped)}
          </div>
        </div>

        {/* Page content */}
        <div style={{ padding: 16, minHeight: 180, opacity: pageOpacity }}>
          {/* Fake search form */}
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 10, color: C.textMuted, marginBottom: 4, fontFamily: "'JetBrains Mono', monospace" }}>Destination</div>
            <div style={{ padding: "6px 10px", borderRadius: 6, border: `1px solid ${fieldTyped > 0 ? C.accent : C.border}`, background: C.bg, fontSize: 12, color: C.text, fontFamily: "'JetBrains Mono', monospace", minHeight: 24, transition: "border-color 0.2s" }}>
              {fieldText.slice(0, fieldTyped)}
              {fieldTyped > 0 && fieldTyped < fieldText.length && (
                <span style={{ display: "inline-block", width: 7, height: 13, background: C.green, marginLeft: 1, verticalAlign: "middle", borderRadius: 1 }} />
              )}
            </div>
          </div>

          {/* Search button */}
          <div
            style={{
              display: "inline-flex",
              padding: "6px 16px",
              borderRadius: 6,
              background: C.accent,
              color: "#fff",
              fontSize: 11,
              fontWeight: 600,
              fontFamily: "'JetBrains Mono', monospace",
              transform: `scale(${clickScale})`,
              cursor: "pointer",
            }}
          >
            Search
          </div>

          {/* Agent status log */}
          <div style={{ marginTop: 16, borderTop: `1px solid ${C.border}`, paddingTop: 10 }}>
            <div style={{ opacity: status1Opacity, fontSize: 10, color: C.textSecondary, fontFamily: "'JetBrains Mono', monospace", marginBottom: 4 }}>
              <span style={{ color: C.green }}>&#10003;</span> Navigated to booking.com/search
            </div>
            <div style={{ opacity: status1Opacity, fontSize: 10, color: C.textSecondary, fontFamily: "'JetBrains Mono', monospace", marginBottom: 4 }}>
              <span style={{ color: C.green }}>&#10003;</span> Filled destination: San Francisco, Feb 20-22
            </div>
            <div style={{ opacity: status2Opacity, fontSize: 10, color: C.textSecondary, fontFamily: "'JetBrains Mono', monospace" }}>
              <span style={{ color: C.green }}>&#10003;</span> Clicked &quot;Search&quot; - found 23 results
            </div>
          </div>
        </div>
      </div>
    </AbsoluteFill>
  )
}
