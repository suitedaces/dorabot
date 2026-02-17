import type { ToolUIProps } from "./index"
import { Badge } from "@/components/ui/badge"
import { LayoutGrid, Map } from "lucide-react"

const TOOL_LABELS: Record<string, string> = {
  plan_view: "view plans",
  plan_add: "add plan",
  plan_update: "update plan",
  plan_start: "start plan",
  roadmap_view: "view roadmap",
  roadmap_add: "add roadmap item",
  roadmap_update: "update roadmap item",
  roadmap_create_plan: "create plan",
}

export function PlanTool({ name, input, output, isError }: ToolUIProps) {
  let parsed: any = {}
  try { parsed = JSON.parse(input) } catch {}

  const label = TOOL_LABELS[name] || name.replace("plan_", "").replace("roadmap_", "")
  const title = parsed.title || ""
  const status = parsed.status || ""
  const id = parsed.id || ""
  const Icon = name.startsWith('roadmap_') ? Map : LayoutGrid

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-xs">
        <Icon className="w-3.5 h-3.5 text-violet-500" />
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
