import { motion } from "motion/react"
import { Clock, Bell, CalendarClock, Timer } from "lucide-react"
import type { ToolUIProps } from "../tool-ui"

function AnimatedClock({ streaming }: { streaming?: boolean }) {
  return (
    <div className="relative w-10 h-10">
      {/* face */}
      <div className="absolute inset-0 rounded-full border-2 border-warning/30 bg-warning/5" />
      {/* hour marks */}
      {[0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330].map(deg => (
        <div
          key={deg}
          className="absolute w-[1px] h-1.5 bg-warning/30 left-1/2 -ml-[0.5px]"
          style={{ top: 2, transformOrigin: "50% 18px", transform: `rotate(${deg}deg)` }}
        />
      ))}
      {/* minute hand */}
      <motion.div
        className="absolute w-[1.5px] h-3 bg-warning/60 rounded-full left-1/2 -ml-[0.75px]"
        style={{ bottom: "50%", transformOrigin: "50% 100%" }}
        animate={streaming ? { rotate: [0, 360] } : { rotate: 0 }}
        transition={streaming ? { duration: 3, repeat: Infinity, ease: "linear" } : {}}
      />
      {/* hour hand */}
      <motion.div
        className="absolute w-[2px] h-2 bg-warning/80 rounded-full left-1/2 -ml-[1px]"
        style={{ bottom: "50%", transformOrigin: "50% 100%" }}
        animate={streaming ? { rotate: [0, 360] } : { rotate: 0 }}
        transition={streaming ? { duration: 12, repeat: Infinity, ease: "linear" } : {}}
      />
      {/* center dot */}
      <div className="absolute w-1.5 h-1.5 rounded-full bg-warning/80 top-1/2 left-1/2 -mt-[3px] -ml-[3px]" />
    </div>
  )
}

const TOOL_ICONS: Record<string, typeof Clock> = {
  schedule_reminder: Bell,
  schedule_recurring: CalendarClock,
  schedule_cron: Timer,
  list_reminders: Clock,
  cancel_reminder: Clock,
}

export function CronStream({ name, input, output, isError, streaming }: ToolUIProps) {
  let parsed: any = {}
  try { parsed = JSON.parse(input) } catch {}

  const message = parsed.message || parsed.description || ""
  const delay = parsed.delay || ""
  const every = parsed.every || ""
  const cron = parsed.cron || ""
  const schedule = delay || every || cron || ""
  const toolLabel = name.replace("schedule_", "").replace("_", " ")
  const done = !streaming && output != null
  const Icon = TOOL_ICONS[name] || Clock

  return (
    <div className="rounded-lg overflow-hidden border border-border/60 bg-[oklch(0.12_0.005_280)]">
      <div className="flex items-center gap-3 px-3 py-3">
        {/* animated clock */}
        <AnimatedClock streaming={streaming} />

        <div className="flex-1 min-w-0 space-y-1.5">
          {/* type badge */}
          <div className="flex items-center gap-2">
            <Icon className="w-3 h-3 text-warning/70" />
            <span className="text-[10px] text-warning/70 uppercase tracking-wider font-medium">{toolLabel}</span>
            {done && (
              <motion.span
                className={`text-[9px] ml-auto px-1.5 py-0.5 rounded ${
                  isError ? 'text-destructive bg-destructive/10' : 'text-success bg-success/10'
                }`}
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
              >
                {isError ? "failed" : "set"}
              </motion.span>
            )}
          </div>

          {/* schedule */}
          {schedule && (
            <motion.div
              className="flex items-center gap-1.5"
              initial={{ opacity: 0, x: -4 }}
              animate={{ opacity: 1, x: 0 }}
            >
              <code className="text-[11px] text-warning/90 bg-warning/10 px-1.5 py-0.5 rounded border border-warning/15">
                {schedule}
              </code>
              {streaming && (
                <motion.span
                  className="inline-block w-[2px] h-3 bg-warning/60"
                  animate={{ opacity: [1, 0] }}
                  transition={{ duration: 0.5, repeat: Infinity }}
                />
              )}
            </motion.div>
          )}

          {/* message preview */}
          {message && (
            <motion.div
              className="text-[11px] text-muted-foreground/70 truncate"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.15 }}
            >
              "{message.slice(0, 100)}"
            </motion.div>
          )}
        </div>
      </div>

      {/* output */}
      {output && (
        <motion.div
          className="border-t border-border/20 px-3 py-2"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
        >
          <pre className={`text-[10px] font-mono whitespace-pre-wrap ${isError ? 'text-destructive' : 'text-muted-foreground'}`}>
            {output.slice(0, 1000)}
          </pre>
        </motion.div>
      )}
    </div>
  )
}
