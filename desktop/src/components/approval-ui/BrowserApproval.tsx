import type { ApprovalUIProps } from "./index"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Monitor } from "lucide-react"

export function BrowserApproval({ input, onModify }: ApprovalUIProps) {
  const action = (input.action as string) || ""
  const url = (input.url as string) || ""
  const text = (input.text as string) || ""

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Monitor className="w-3 h-3 text-primary" />
        <Badge variant="outline" className="text-[9px] h-4">{action}</Badge>
      </div>
      {(action === "open" || url) && (
        <div>
          <Label className="text-[10px] text-muted-foreground uppercase">url</Label>
          <Input
            value={url}
            onChange={e => onModify({ ...input, url: e.target.value })}
            className="font-mono text-[11px] h-7 mt-1"
            placeholder="https://..."
          />
        </div>
      )}
      {text && (
        <div>
          <Label className="text-[10px] text-muted-foreground uppercase">text</Label>
          <Input
            value={text}
            onChange={e => onModify({ ...input, text: e.target.value })}
            className="text-[11px] h-7 mt-1"
          />
        </div>
      )}
    </div>
  )
}
