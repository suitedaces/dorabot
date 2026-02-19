import type { ApprovalUIProps } from "./index"
import Markdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Target } from "lucide-react"

export function TaskApproval({ input }: ApprovalUIProps) {
  const title = input.title as string || ''
  const goalId = input.goalId as string | undefined
  const plan = input.plan as string || ''

  return (
    <div className="space-y-2">
      <div className="text-sm font-medium">{title}</div>
      {goalId && (
        <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
          <Target className="h-3 w-3" />
          goal #{goalId}
        </div>
      )}
      {plan && (
        <ScrollArea className="max-h-[200px] rounded border border-border/50 bg-muted/30 px-3 py-2">
          <div className="prose-chat text-xs">
            <Markdown remarkPlugins={[remarkGfm]}>{plan}</Markdown>
          </div>
        </ScrollArea>
      )}
    </div>
  )
}
