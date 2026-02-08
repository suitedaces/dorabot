import type { ToolUIProps } from "./index"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Bot } from "lucide-react"

export function TaskTool({ input, output, isError, streaming }: ToolUIProps) {
  let parsed: any = {}
  try { parsed = JSON.parse(input) } catch {}

  const agentType = parsed.subagent_type || "agent"
  const description = parsed.description || ""
  const bg = parsed.run_in_background

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-xs">
        <Bot className="w-3.5 h-3.5 text-primary" />
        <Badge variant="outline" className="text-[9px] h-4">{agentType}</Badge>
        <span className="text-muted-foreground truncate">{description}</span>
        {bg && <Badge variant="outline" className="text-[9px] h-4">bg</Badge>}
        {streaming && <Badge className="text-[9px] h-4 animate-pulse">running</Badge>}
      </div>
      {output && (
        <ScrollArea className="max-h-[200px] rounded-md bg-background border border-border">
          <pre className={`p-2 text-[11px] font-mono whitespace-pre-wrap ${isError ? 'text-destructive' : 'text-muted-foreground'}`}>
            {output.slice(0, 3000)}
          </pre>
        </ScrollArea>
      )}
    </div>
  )
}
