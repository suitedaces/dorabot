import type { ApprovalUIProps } from "./index"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { MessageSquare } from "lucide-react"

export function MessageApproval({ input, onModify }: ApprovalUIProps) {
  const channel = (input.channel as string) || ""
  const target = (input.target as string) || ""
  const message = (input.message as string) || ""

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <MessageSquare className="w-3 h-3 text-success" />
        <div className="flex gap-1.5 flex-1">
          <Input
            value={channel}
            onChange={e => onModify({ ...input, channel: e.target.value })}
            className="font-mono text-[11px] h-7 w-24"
            placeholder="channel"
          />
          <Input
            value={target}
            onChange={e => onModify({ ...input, target: e.target.value })}
            className="font-mono text-[11px] h-7 flex-1"
            placeholder="target"
          />
        </div>
      </div>
      <div>
        <Label className="text-[10px] text-muted-foreground uppercase">message</Label>
        <Textarea
          value={message}
          onChange={e => onModify({ ...input, message: e.target.value })}
          className="text-[11px] min-h-[60px] mt-1"
        />
      </div>
    </div>
  )
}
