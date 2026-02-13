import type { ToolUIProps } from "./index"
import { Badge } from "@/components/ui/badge"
import { LayoutGrid } from "lucide-react"

const TOOL_LABELS: Record<string, string> = {
  goals_view: "view goals",
  goals_add: "add goal",
  goals_update: "update goal",
  goals_propose: "propose goals",
}

export function GoalsTool({ name, input, output, isError }: ToolUIProps) {
  let parsed: any = {}
  try { parsed = JSON.parse(input) } catch {}

  const label = TOOL_LABELS[name] || name.replace("goals_", "")
  const title = parsed.title || ""
  const status = parsed.status || ""
  const id = parsed.id || ""

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-xs">
        <LayoutGrid className="w-3.5 h-3.5 text-violet-500" />
        <Badge variant="outline" className="text-[9px] h-4">{label}</Badge>
        {id && <code className="text-violet-500 text-[11px]">#{id}</code>}
        {status && <Badge variant="outline" className="text-[9px] h-4">{status}</Badge>}
      </div>
      {title && <div className="text-[11px] text-muted-foreground">{title}</div>}
      {output && (
        <pre className={`p-2 text-[11px] font-mono whitespace-pre-wrap rounded-md bg-background border border-border ${isError ? 'text-destructive' : 'text-muted-foreground'}`}>
          {output.slice(0, 1000)}
        </pre>
      )}
    </div>
  )
}
