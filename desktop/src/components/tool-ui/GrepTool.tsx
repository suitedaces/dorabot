import type { ToolUIProps } from "./index"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Search } from "lucide-react"

export function GrepTool({ input, output, isError }: ToolUIProps) {
  let parsed: any = {}
  try { parsed = JSON.parse(input) } catch {}

  const pattern = parsed.pattern || ""
  const searchPath = parsed.path || ""

  const lines = output ? output.split("\n").filter(Boolean) : []

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-xs">
        <Search className="w-3.5 h-3.5 text-warning" />
        <code className="text-warning text-[11px]">/{pattern}/</code>
        {searchPath && <span className="text-muted-foreground text-[10px] truncate">{searchPath}</span>}
        {lines.length > 0 && <Badge variant="outline" className="text-[9px] h-4 ml-auto">{lines.length} results</Badge>}
      </div>
      {lines.length > 0 && (
        <ScrollArea className="max-h-[200px] rounded-md bg-background border border-border">
          <pre className="p-2 text-[11px] font-mono whitespace-pre-wrap text-muted-foreground">
            {lines.slice(0, 60).join("\n")}
            {lines.length > 60 ? `\n...and ${lines.length - 60} more lines` : ""}
          </pre>
        </ScrollArea>
      )}
    </div>
  )
}
