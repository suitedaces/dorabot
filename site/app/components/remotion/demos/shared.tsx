import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion"

// Color constants matching the site theme
export const C = {
  bg: "#1a1a2e",
  bgCard: "#1e1e34",
  bgSurface: "#222240",
  border: "rgba(80, 80, 120, 0.4)",
  text: "#e5e5e5",
  textSecondary: "#999",
  textMuted: "#666",
  accent: "#6c8aff",
  green: "#4ade80",
  purple: "#c084fc",
  orange: "#fbbf24",
  red: "#f87171",
}

// Typewriter helper: returns sliced string based on frame
export function useTypewriter(text: string, startFrame: number, charsPerFrame = 0.8) {
  const frame = useCurrentFrame()
  const elapsed = Math.max(0, frame - startFrame)
  const chars = Math.min(text.length, Math.floor(elapsed * charsPerFrame))
  return text.slice(0, chars)
}

// Spring entrance
export function useEntrance(delay = 0) {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const s = spring({ frame, fps, delay, config: { damping: 200 } })
  return {
    opacity: s,
    transform: `translateY(${interpolate(s, [0, 1], [12, 0])}px)`,
  }
}

// Chat bubble component
export function ChatBubble({
  text,
  isUser,
  y,
  opacity = 1,
}: {
  text: string
  isUser: boolean
  y: number
  opacity?: number
}) {
  return (
    <div
      style={{
        position: "absolute",
        top: y,
        left: isUser ? "auto" : 16,
        right: isUser ? 16 : "auto",
        maxWidth: "70%",
        padding: "8px 12px",
        borderRadius: isUser ? "12px 12px 2px 12px" : "12px 12px 12px 2px",
        background: isUser ? C.accent : C.bgSurface,
        color: C.text,
        fontSize: 13,
        fontFamily: "'JetBrains Mono', monospace",
        lineHeight: 1.5,
        opacity,
      }}
    >
      {text}
    </div>
  )
}

// Window chrome (title bar)
export function WindowChrome({ title, width, accent }: { title: string; width: number; accent?: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "8px 12px",
        borderBottom: `1px solid ${C.border}`,
        background: C.bg,
        width,
      }}
    >
      <div style={{ width: 8, height: 8, borderRadius: "50%", background: C.red }} />
      <div style={{ width: 8, height: 8, borderRadius: "50%", background: C.orange }} />
      <div style={{ width: 8, height: 8, borderRadius: "50%", background: C.green }} />
      <span style={{ marginLeft: 8, fontSize: 10, color: C.textMuted, fontFamily: "'JetBrains Mono', monospace" }}>
        {title}
      </span>
      {accent && (
        <span style={{ marginLeft: "auto", fontSize: 9, color: accent, fontFamily: "'JetBrains Mono', monospace" }}>
          ● live
        </span>
      )}
    </div>
  )
}

// Cursor blink
export function Cursor({ visible }: { visible: boolean }) {
  return (
    <span
      style={{
        display: "inline-block",
        width: 7,
        height: 14,
        background: visible ? C.green : "transparent",
        marginLeft: 2,
        verticalAlign: "middle",
        borderRadius: 1,
      }}
    />
  )
}

// Fake terminal line
export function TermLine({ prompt, text, color }: { prompt?: string; text: string; color?: string }) {
  return (
    <div style={{ fontSize: 12, fontFamily: "'JetBrains Mono', monospace", lineHeight: 1.6 }}>
      {prompt && <span style={{ color: C.textMuted }}>{prompt} </span>}
      <span style={{ color: color || C.text }}>{text}</span>
    </div>
  )
}
