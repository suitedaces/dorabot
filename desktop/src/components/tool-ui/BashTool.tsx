import type { ToolUIProps } from "./index"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Terminal } from "lucide-react"

export function BashTool({ input, output, isError, streaming }: ToolUIProps) {
  let parsed: any = {}
  try { parsed = JSON.parse(input) } catch {}

  const command = parsed.command || input.slice(0, 200)
  const timeout = parsed.timeout
  const bg = parsed.run_in_background

  return (
    <div className="rounded-md bg-[oklch(0.13_0_0)] border border-border overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border/50">
        <Terminal className="w-3 h-3 text-success" />
        <span className="text-[10px] text-muted-foreground">terminal</span>
        {bg && <Badge variant="outline" className="text-[9px] h-4">bg</Badge>}
        {timeout && <Badge variant="outline" className="text-[9px] h-4">{timeout}ms</Badge>}
        {output && !streaming && (
          <Badge variant={isError ? "destructive" : "outline"} className="text-[9px] h-4 ml-auto">
            {isError ? "error" : "ok"}
          </Badge>
        )}
      </div>
      <div className="px-3 py-2">
        <div className="flex gap-1.5 text-[11px] font-mono">
          <span className="text-success select-none">$</span>
          <span className="text-foreground">{command}</span>
        </div>
      </div>
      {output && (
        <ScrollArea className="max-h-[200px] border-t border-border/50">
          <pre className={`px-3 py-2 text-[11px] font-mono whitespace-pre-wrap ${isError ? 'text-destructive' : 'text-muted-foreground'}`}>
            {output.slice(0, 3000)}
          </pre>
        </ScrollArea>
      )}
    </div>
  )
}
