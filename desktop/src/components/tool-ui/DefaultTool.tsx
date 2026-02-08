import type { ToolUIProps } from "./index"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Wrench } from "lucide-react"

export function DefaultTool({ name, input, output, isError }: ToolUIProps) {
  let formattedInput = input
  try { formattedInput = JSON.stringify(JSON.parse(input), null, 2) } catch {}

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-xs">
        <Wrench className="w-3.5 h-3.5 text-muted-foreground" />
        <span className="text-muted-foreground">{name}</span>
      </div>
      <ScrollArea className="max-h-[150px] rounded-md bg-background border border-border">
        <pre className="p-2 text-[11px] font-mono whitespace-pre-wrap text-muted-foreground">{formattedInput}</pre>
      </ScrollArea>
      {output && (
        <ScrollArea className="max-h-[150px] rounded-md bg-background border border-border">
          <pre className={`p-2 text-[11px] font-mono whitespace-pre-wrap ${isError ? 'text-destructive' : 'text-muted-foreground'}`}>
            {output.slice(0, 2000)}
          </pre>
        </ScrollArea>
      )}
    </div>
  )
}
