import { useState } from "react"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Spotlight } from "@/components/aceternity/spotlight"
import { Shield, Check, X } from "lucide-react"
import { BashApproval } from "./BashApproval"
import { WriteApproval } from "./WriteApproval"
import { EditApproval } from "./EditApproval"
import { MessageApproval } from "./MessageApproval"
import { BrowserApproval } from "./BrowserApproval"
import { CronApproval } from "./CronApproval"
import { TaskApproval } from "./TaskApproval"
import { DefaultApproval } from "./DefaultApproval"

export type ApprovalUIProps = {
  toolName: string
  input: Record<string, unknown>
  onModify: (modified: Record<string, unknown>) => void
}

const FORM_MAP: Record<string, React.ComponentType<ApprovalUIProps>> = {
  Bash: BashApproval,
  Write: WriteApproval,
  Edit: EditApproval,
  message: MessageApproval,
  browser: BrowserApproval,
  schedule_reminder: CronApproval,
  schedule_recurring: CronApproval,
  schedule_cron: CronApproval,
  task_start: TaskApproval,
}

type Props = {
  requestId: string
  toolName: string
  input: Record<string, unknown>
  timestamp: number
  onApprove: (requestId: string, modifiedInput?: Record<string, unknown>) => void
  onDeny: (requestId: string, reason?: string) => void
}

export function ApprovalUI({ requestId, toolName, input, timestamp, onApprove, onDeny }: Props) {
  const [modified, setModified] = useState<Record<string, unknown>>(input)
  const [hasEdits, setHasEdits] = useState(false)

  const handleModify = (newInput: Record<string, unknown>) => {
    setModified(newInput)
    setHasEdits(true)
  }

  const Form = FORM_MAP[toolName] || DefaultApproval

  return (
    <Spotlight>
      <Card className="border-warning/50 bg-card p-3 space-y-3">
        <div className="flex items-center gap-2">
          <Shield className="w-3.5 h-3.5 text-warning" />
          <span className="text-[11px] font-semibold text-warning uppercase">approval required</span>
          <Badge variant="outline" className="text-[10px] h-4 ml-auto">{toolName}</Badge>
        </div>

        <Form toolName={toolName} input={modified} onModify={handleModify} />

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="default"
            className="h-7 text-xs bg-success hover:bg-success/80 text-success-foreground"
            onClick={() => onApprove(requestId, hasEdits ? modified : undefined)}
          >
            <Check className="w-3 h-3 mr-1" />
            allow
          </Button>
          <Button
            size="sm"
            variant="destructive"
            className="h-7 text-xs"
            onClick={() => onDeny(requestId, "user denied")}
          >
            <X className="w-3 h-3 mr-1" />
            deny
          </Button>
          {hasEdits && <span className="text-[9px] text-warning ml-auto">modified</span>}
          <span className="text-[9px] text-muted-foreground ml-auto">
            {new Date(timestamp).toLocaleTimeString()}
          </span>
        </div>
      </Card>
    </Spotlight>
  )
}
