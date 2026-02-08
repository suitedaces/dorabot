import type { ToolUIProps } from "./index"
import { Badge } from "@/components/ui/badge"
import { FilePlus } from "lucide-react"

export function WriteTool({ input, output, isError }: ToolUIProps) {
  let parsed: any = {}
  try { parsed = JSON.parse(input) } catch {}

  const filePath = parsed.file_path || ""
  const content = parsed.content || ""

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-xs">
        <FilePlus className="w-3.5 h-3.5 text-success" />
        <span className="text-muted-foreground font-mono truncate">{filePath}</span>
        <Badge variant="outline" className="text-[9px] h-4 text-success border-success/30">
          {output?.includes("created") ? "created" : "updated"}
        </Badge>
      </div>
      {content && (
        <pre className="p-3 text-[11px] font-mono whitespace-pre-wrap text-muted-foreground bg-background border border-border rounded-md max-h-[150px] overflow-auto">
          {content.slice(0, 1000)}{content.length > 1000 ? "\n..." : ""}
        </pre>
      )}
    </div>
  )
}
