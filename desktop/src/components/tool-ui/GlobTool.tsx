import type { ToolUIProps } from "./index"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { FolderSearch, File, Folder } from "lucide-react"

export function GlobTool({ input, output, isError }: ToolUIProps) {
  let parsed: any = {}
  try { parsed = JSON.parse(input) } catch {}

  const pattern = parsed.pattern || ""
  const searchPath = parsed.path || ""

  const files = output ? output.split("\n").filter(Boolean) : []

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-xs">
        <FolderSearch className="w-3.5 h-3.5 text-primary" />
        <code className="text-primary text-[11px]">{pattern}</code>
        {searchPath && <span className="text-muted-foreground text-[10px] truncate">{searchPath}</span>}
        {files.length > 0 && <Badge variant="outline" className="text-[9px] h-4 ml-auto">{files.length} matches</Badge>}
      </div>
      {files.length > 0 && (
        <ScrollArea className="max-h-[150px] rounded-md bg-background border border-border p-2">
          <div className="space-y-0.5">
            {files.slice(0, 50).map((f, i) => (
              <div key={i} className="flex items-center gap-1.5 text-[11px] font-mono text-muted-foreground">
                {f.includes("/") ? <Folder className="w-3 h-3 text-primary/60 shrink-0" /> : <File className="w-3 h-3 text-muted-foreground/60 shrink-0" />}
                <span className="truncate">{f}</span>
              </div>
            ))}
            {files.length > 50 && <div className="text-[10px] text-muted-foreground">...and {files.length - 50} more</div>}
          </div>
        </ScrollArea>
      )}
    </div>
  )
}
