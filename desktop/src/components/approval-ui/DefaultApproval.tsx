import { useState } from "react"
import type { ApprovalUIProps } from "./index"
import { Textarea } from "@/components/ui/textarea"
import { Wrench } from "lucide-react"

export function DefaultApproval({ input, onModify }: ApprovalUIProps) {
  const [text, setText] = useState(JSON.stringify(input, null, 2))

  const handleChange = (value: string) => {
    setText(value)
    try {
      const parsed = JSON.parse(value)
      onModify(parsed)
    } catch {}
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5">
        <Wrench className="w-3 h-3 text-muted-foreground" />
        <span className="text-[10px] text-muted-foreground uppercase">input (json)</span>
      </div>
      <Textarea
        value={text}
        onChange={e => handleChange(e.target.value)}
        className="font-mono text-[11px] min-h-[80px]"
      />
    </div>
  )
}
