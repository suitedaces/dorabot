import type { ApprovalUIProps } from "./index"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Clock } from "lucide-react"

export function CronApproval({ input, onModify }: ApprovalUIProps) {
  const message = (input.message as string) || ""
  const delay = (input.delay as string) || ""
  const every = (input.every as string) || ""
  const cron = (input.cron as string) || ""

  const scheduleField = delay ? "delay" : every ? "every" : cron ? "cron" : "delay"
  const scheduleValue = delay || every || cron || ""

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Clock className="w-3 h-3 text-warning" />
        <div>
          <Label className="text-[10px] text-muted-foreground uppercase">{scheduleField}</Label>
          <Input
            value={scheduleValue}
            onChange={e => onModify({ ...input, [scheduleField]: e.target.value })}
            className="font-mono text-[11px] h-7 mt-1"
            placeholder={scheduleField === "cron" ? "0 9 * * *" : "20m, 2h, 1d"}
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
