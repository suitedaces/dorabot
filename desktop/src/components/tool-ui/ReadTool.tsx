import type { ToolUIProps } from "./index"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { FileText } from "lucide-react"

export function ReadTool({ input, output, isError }: ToolUIProps) {
  let parsed: any = {}
  try { parsed = JSON.parse(input) } catch {}

  const filePath = parsed.file_path || ""
  const offset = parsed.offset
  const limit = parsed.limit

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-xs">
        <FileText className="w-3.5 h-3.5 text-primary" />
        <span className="text-muted-foreground font-mono truncate">{filePath}</span>
        {offset && <Badge variant="outline" className="text-[9px] h-4">{`L${offset}${limit ? `-${offset + limit}` : ''}`}</Badge>}
      </div>
      {output && (
        <ScrollArea className="max-h-[200px] rounded-md bg-background border border-border">
          <pre className={`p-3 text-[11px] font-mono whitespace-pre-wrap ${isError ? 'text-destructive' : 'text-muted-foreground'}`}>
            {output.slice(0, 3000)}
          </pre>
        </ScrollArea>
      )}
    </div>
  )
}
