import { motion } from "motion/react"
import type { ToolUIProps } from "../tool-ui"
import { BrowserStream } from "./BrowserStream"
import { TerminalStream } from "./TerminalStream"
import { MessageStream } from "./MessageStream"
import { SearchStream } from "./SearchStream"
import { ScreenshotStream } from "./ScreenshotStream"
import { FileStream } from "./FileStream"
import { CronStream } from "./CronStream"
import { GoalsStream } from "./GoalsStream"
import { WebFetchStream } from "./WebFetchStream"
import { TaskStream } from "./TaskStream"
// ProgressStream and QuestionStream no longer used as stream cards

const STREAM_MAP: Record<string, React.ComponentType<ToolUIProps>> = {
  browser: BrowserStream,
  Bash: TerminalStream,
  message: MessageStream,
  WebSearch: SearchStream,
  WebFetch: WebFetchStream,
  screenshot: ScreenshotStream,
  Read: FileStream,
  Write: FileStream,
  Edit: FileStream,
  Glob: FileStream,
  Grep: FileStream,
  Task: TaskStream,
  schedule_reminder: CronStream,
  schedule_recurring: CronStream,
  schedule_cron: CronStream,
  list_reminders: CronStream,
  cancel_reminder: CronStream,
  goals_view: GoalsStream,
  goals_add: GoalsStream,
  goals_update: GoalsStream,
  goals_propose: GoalsStream,
  // TodoWrite and AskUserQuestion handled inline — not as stream cards
}

function StreamProgress() {
  return (
    <div className="absolute bottom-0 left-0 right-0 h-[2px] overflow-hidden z-20 rounded-b-lg">
      <motion.div
        className="h-full bg-gradient-to-r from-transparent via-primary/50 to-transparent"
        style={{ width: "40%" }}
        initial={{ x: "-100%" }}
        animate={{ x: "250%" }}
        transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}
      />
    </div>
  )
}

export function ToolStreamCard(props: ToolUIProps) {
  const Component = STREAM_MAP[props.name]
  if (!Component) return null
  return (
    <div className="relative">
      <Component {...props} />
      {props.streaming && <StreamProgress />}
    </div>
  )
}

export function hasStreamCard(toolName: string): boolean {
  return toolName in STREAM_MAP
}
