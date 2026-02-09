import type { ToolUIProps } from "../tool-ui"
import { BrowserStream } from "./BrowserStream"
import { TerminalStream } from "./TerminalStream"
import { MessageStream } from "./MessageStream"
import { SearchStream } from "./SearchStream"
import { ScreenshotStream } from "./ScreenshotStream"
import { FileStream } from "./FileStream"
import { CronStream } from "./CronStream"
import { WebFetchStream } from "./WebFetchStream"
import { TaskStream } from "./TaskStream"

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
}

export function ToolStreamCard(props: ToolUIProps) {
  const Component = STREAM_MAP[props.name]
  if (!Component) return null
  return <Component {...props} />
}

export function hasStreamCard(toolName: string): boolean {
  return toolName in STREAM_MAP
}
