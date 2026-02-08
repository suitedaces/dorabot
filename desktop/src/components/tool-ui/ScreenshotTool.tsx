import type { ToolUIProps } from "./index"
import { Camera } from "lucide-react"

export function ScreenshotTool({ input, output, isError }: ToolUIProps) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-xs">
        <Camera className="w-3.5 h-3.5 text-primary" />
        <span className="text-muted-foreground">screenshot captured</span>
      </div>
      {output && !isError && output.startsWith("data:") && (
        <div className="rounded-md border border-border overflow-hidden">
          <img src={output} alt="Screenshot" className="w-full" />
        </div>
      )}
      {output && !output.startsWith("data:") && (
        <pre className="p-2 text-[11px] font-mono text-muted-foreground">{output.slice(0, 500)}</pre>
      )}
    </div>
  )
}
