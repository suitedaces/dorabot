import { AbsoluteFill, Sequence, useCurrentFrame, useVideoConfig, interpolate } from "remotion"
import { ChatDemo } from "./demos/ChatDemo"
import { BrowserDemo } from "./demos/BrowserDemo"
import { GoalsDemo } from "./demos/GoalsDemo"
import { EmailDemo } from "./demos/EmailDemo"
import { MacDemo } from "./demos/MacDemo"
import { ScheduleDemo } from "./demos/ScheduleDemo"

const SCENE_DURATION = 180 // 6 seconds per scene at 30fps
const FADE_DURATION = 20

const scenes = [
  { component: ChatDemo, label: "Chat on Telegram", icon: ">>" },
  { component: BrowserDemo, label: "Browse the Web", icon: "<>" },
  { component: GoalsDemo, label: "Proactive Goals", icon: "[]" },
  { component: EmailDemo, label: "Send Emails", icon: "@ " },
  { component: MacDemo, label: "Control your Mac", icon: "# " },
  { component: ScheduleDemo, label: "Schedule Tasks", icon: "*/" },
]

// Label overlay that shows which feature is being demoed
function SceneLabel({ label, icon }: { label: string; icon: string }) {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()

  const fadeIn = interpolate(frame, [0, 15], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })
  const slideIn = interpolate(frame, [0, 15], [8, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })

  return (
    <div
      style={{
        position: "absolute",
        top: 16,
        left: 0,
        right: 0,
        display: "flex",
        justifyContent: "center",
        opacity: fadeIn,
        transform: `translateY(${slideIn}px)`,
        zIndex: 20,
      }}
    >
      <div
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          padding: "6px 14px",
          borderRadius: 8,
          background: "rgba(26, 26, 46, 0.8)",
          border: "1px solid rgba(80, 80, 120, 0.4)",
          backdropFilter: "blur(12px)",
        }}
      >
        <span style={{ fontSize: 10, fontWeight: 700, color: "#6c8aff", fontFamily: "'JetBrains Mono', monospace" }}>{icon}</span>
        <span style={{ fontSize: 12, color: "#e5e5e5", fontFamily: "'JetBrains Mono', monospace", fontWeight: 500 }}>{label}</span>
      </div>
    </div>
  )
}

// Fade wrapper for scene transitions
function SceneFade({ children }: { children: React.ReactNode }) {
  const frame = useCurrentFrame()

  const fadeIn = interpolate(frame, [0, FADE_DURATION], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })
  const fadeOut = interpolate(frame, [SCENE_DURATION - FADE_DURATION, SCENE_DURATION], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })
  const opacity = Math.min(fadeIn, fadeOut)

  return (
    <AbsoluteFill style={{ opacity }}>
      {children}
    </AbsoluteFill>
  )
}

// Progress dots at the bottom
function ProgressDots() {
  const frame = useCurrentFrame()
  const totalDuration = scenes.length * SCENE_DURATION
  const currentScene = Math.floor((frame % totalDuration) / SCENE_DURATION)

  return (
    <div
      style={{
        position: "absolute",
        bottom: 16,
        left: 0,
        right: 0,
        display: "flex",
        justifyContent: "center",
        gap: 6,
        zIndex: 20,
      }}
    >
      {scenes.map((_, i) => (
        <div
          key={i}
          style={{
            width: i === currentScene ? 20 : 6,
            height: 6,
            borderRadius: 3,
            background: i === currentScene ? "#6c8aff" : "rgba(80, 80, 120, 0.5)",
            transition: "width 0.3s, background 0.3s",
          }}
        />
      ))}
    </div>
  )
}

export const HeroShowcase = () => {
  return (
    <AbsoluteFill style={{ background: "transparent" }}>
      {scenes.map((scene, i) => {
        const Scene = scene.component
        return (
          <Sequence
            key={i}
            from={i * SCENE_DURATION}
            durationInFrames={SCENE_DURATION}
            layout="none"
          >
            <SceneFade>
              <SceneLabel label={scene.label} icon={scene.icon} />
              <Scene />
            </SceneFade>
          </Sequence>
        )
      })}
      <ProgressDots />
    </AbsoluteFill>
  )
}
