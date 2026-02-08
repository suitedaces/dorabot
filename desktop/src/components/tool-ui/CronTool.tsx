import type { ToolUIProps } from "./index"
import { Badge } from "@/components/ui/badge"
import { Clock } from "lucide-react"

export function CronTool({ name, input, output, isError }: ToolUIProps) {
  let parsed: any = {}
  try { parsed = JSON.parse(input) } catch {}

  const message = parsed.message || parsed.description || ""
  const schedule = parsed.delay || parsed.every || parsed.cron || ""
  const toolLabel = name.replace("schedule_", "").replace("_", " ")

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-xs">
        <Clock className="w-3.5 h-3.5 text-warning" />
        <Badge variant="outline" className="text-[9px] h-4">{toolLabel}</Badge>
        {schedule && <code className="text-warning text-[11px]">{schedule}</code>}
      </div>
      {message && <div className="text-[11px] text-muted-foreground">{message.slice(0, 300)}</div>}
      {output && (
        <pre className={`p-2 text-[11px] font-mono whitespace-pre-wrap rounded-md bg-background border border-border ${isError ? 'text-destructive' : 'text-muted-foreground'}`}>
          {output.slice(0, 1000)}
        </pre>
      )}
    </div>
  )
}
