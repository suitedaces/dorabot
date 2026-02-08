import type { ToolUIProps } from "./index"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Globe } from "lucide-react"

export function WebFetchTool({ input, output, isError }: ToolUIProps) {
  let parsed: any = {}
  try { parsed = JSON.parse(input) } catch {}

  const url = parsed.url || ""
  const prompt = parsed.prompt || ""

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-xs">
        <Globe className="w-3.5 h-3.5 text-primary" />
        <a className="text-primary text-[11px] truncate hover:underline" href={url} title={url}>{url}</a>
      </div>
      {prompt && <div className="text-[10px] text-muted-foreground italic">"{prompt}"</div>}
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
