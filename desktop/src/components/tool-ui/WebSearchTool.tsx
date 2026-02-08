import type { ToolUIProps } from "./index"
import { ScrollArea } from "@/components/ui/scroll-area"
import { SearchIcon } from "lucide-react"

export function WebSearchTool({ input, output, isError }: ToolUIProps) {
  let parsed: any = {}
  try { parsed = JSON.parse(input) } catch {}

  const query = parsed.query || ""

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-xs">
        <SearchIcon className="w-3.5 h-3.5 text-primary" />
        <span className="text-foreground text-[11px]">"{query}"</span>
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
