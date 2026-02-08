import type { ToolUIProps } from "./index"
import { Badge } from "@/components/ui/badge"
import { Pencil } from "lucide-react"

export function EditTool({ input, output, isError }: ToolUIProps) {
  let parsed: any = {}
  try { parsed = JSON.parse(input) } catch {}

  const filePath = parsed.file_path || ""
  const oldStr = parsed.old_string || ""
  const newStr = parsed.new_string || ""

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-xs">
        <Pencil className="w-3.5 h-3.5 text-warning" />
        <span className="text-muted-foreground font-mono truncate">{filePath}</span>
        {parsed.replace_all && <Badge variant="outline" className="text-[9px] h-4">replace all</Badge>}
      </div>
      <div className="grid grid-cols-2 gap-1 text-[11px] font-mono">
        <div className="rounded-md bg-destructive/10 border border-destructive/20 p-2 overflow-auto max-h-[120px]">
          <div className="text-[9px] text-destructive/60 mb-1 uppercase">old</div>
          <pre className="whitespace-pre-wrap text-destructive/80">{oldStr.slice(0, 500)}</pre>
        </div>
        <div className="rounded-md bg-success/10 border border-success/20 p-2 overflow-auto max-h-[120px]">
          <div className="text-[9px] text-success/60 mb-1 uppercase">new</div>
          <pre className="whitespace-pre-wrap text-success/80">{newStr.slice(0, 500)}</pre>
        </div>
      </div>
    </div>
  )
}
