import type { ApprovalUIProps } from "./index"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { FilePlus } from "lucide-react"

export function WriteApproval({ input, onModify }: ApprovalUIProps) {
  const filePath = (input.file_path as string) || ""
  const content = (input.content as string) || ""

  return (
    <div className="space-y-2">
      <div>
        <div className="flex items-center gap-1.5 mb-1">
          <FilePlus className="w-3 h-3 text-success" />
          <Label className="text-[10px] text-muted-foreground uppercase">file path</Label>
        </div>
        <Input
          value={filePath}
          onChange={e => onModify({ ...input, file_path: e.target.value })}
          className="font-mono text-[11px] h-7"
        />
      </div>
      <div>
        <Label className="text-[10px] text-muted-foreground uppercase">content</Label>
        <Textarea
          value={content}
          onChange={e => onModify({ ...input, content: e.target.value })}
          className="font-mono text-[11px] min-h-[100px] mt-1"
        />
      </div>
    </div>
  )
}
