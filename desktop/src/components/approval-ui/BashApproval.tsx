import type { ApprovalUIProps } from "./index"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Terminal } from "lucide-react"

export function BashApproval({ input, onModify }: ApprovalUIProps) {
  const command = (input.command as string) || ""

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5">
        <Terminal className="w-3 h-3 text-success" />
        <Label className="text-[10px] text-muted-foreground uppercase">command</Label>
      </div>
      <Textarea
        value={command}
        onChange={e => onModify({ ...input, command: e.target.value })}
        className="font-mono text-[11px] min-h-[60px] bg-[var(--stream-base)] text-success"
        placeholder="command..."
      />
    </div>
  )
}
