import type { ApprovalUIProps } from "./index"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Pencil } from "lucide-react"

export function EditApproval({ input, onModify }: ApprovalUIProps) {
  const filePath = (input.file_path as string) || ""
  const oldString = (input.old_string as string) || ""
  const newString = (input.new_string as string) || ""

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5">
        <Pencil className="w-3 h-3 text-warning" />
        <Input
          value={filePath}
          onChange={e => onModify({ ...input, file_path: e.target.value })}
          className="font-mono text-[11px] h-7"
          placeholder="file path"
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label className="text-[10px] text-destructive/60 uppercase">old (readonly)</Label>
          <Textarea
            value={oldString}
            readOnly
            className="font-mono text-[11px] min-h-[60px] mt-1 bg-destructive/5 text-destructive/80"
          />
        </div>
        <div>
          <Label className="text-[10px] text-success/60 uppercase">new (editable)</Label>
          <Textarea
            value={newString}
            onChange={e => onModify({ ...input, new_string: e.target.value })}
            className="font-mono text-[11px] min-h-[60px] mt-1 bg-success/5 text-success/80"
          />
        </div>
      </div>
    </div>
  )
}
