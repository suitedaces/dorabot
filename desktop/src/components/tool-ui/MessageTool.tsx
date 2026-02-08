import type { ToolUIProps } from "./index"
import { Badge } from "@/components/ui/badge"
import { MessageSquare } from "lucide-react"

export function MessageTool({ input, output, isError }: ToolUIProps) {
  let parsed: any = {}
  try { parsed = JSON.parse(input) } catch {}

  const channel = parsed.channel || "unknown"
  const target = parsed.target || ""
  const message = parsed.message || ""
  const action = parsed.action || "send"

  const channelIcon = channel === "whatsapp" ? "W" : channel === "telegram" ? "T" : ">"

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-xs">
        <MessageSquare className="w-3.5 h-3.5 text-success" />
        <Badge variant="outline" className="text-[9px] h-4 font-bold">{channelIcon}</Badge>
        <span className="text-muted-foreground truncate">{target}</span>
        <Badge variant={isError ? "destructive" : "outline"} className="text-[9px] h-4 ml-auto">
          {action === "send" ? (isError ? "failed" : "sent") : action}
        </Badge>
      </div>
      {message && (
        <div className="rounded-md bg-primary/5 border border-primary/10 px-3 py-2 text-[11px] text-foreground">
          {message.slice(0, 500)}
        </div>
      )}
    </div>
  )
}
