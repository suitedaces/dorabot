import { useState } from "react"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import {
  Check, X, ChevronRight, ChevronDown,
  Terminal, FilePlus, Pencil, MessageSquare, Monitor, Clock, ListChecks, Wrench,
  type LucideIcon,
} from "lucide-react"
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

const TOOL_ICON: Record<string, LucideIcon> = {
  Bash: Terminal,
  Write: FilePlus,
  Edit: Pencil,
  message: MessageSquare,
  browser: Monitor,
  schedule_reminder: Clock,
  schedule_recurring: Clock,
  schedule_cron: Clock,
  task_start: ListChecks,
}

const FRIENDLY_NAME: Record<string, string> = {
  Bash: 'bash',
  Write: 'write',
  Edit: 'edit',
  message: 'message',
  browser: 'browser',
  schedule_reminder: 'reminder',
  schedule_recurring: 'recurring',
  schedule_cron: 'cron',
  task_start: 'task',
}

function summary(toolName: string, input: Record<string, unknown>): string {
  switch (toolName) {
    case 'Bash': return String(input.command || '').split('\n')[0]
    case 'Write': case 'Edit': case 'Read': return String(input.file_path || '')
    case 'message': return [input.channel, input.target].filter(Boolean).join(' → ')
    case 'browser': return String(input.action || '') + (input.url ? ` ${input.url}` : '')
    case 'task_start': return String(input.title || '')
    case 'schedule_reminder': case 'schedule_recurring': case 'schedule_cron':
      return String(input.message || '').slice(0, 80)
    default: {
      const vals = Object.values(input).filter(v => typeof v === 'string')
      return vals.join(' ').slice(0, 80) || toolName
    }
  }
}

type Approval = {
  requestId: string
  toolName: string
  input: Record<string, unknown>
  timestamp: number
  title?: string
  decisionReason?: string
  blockedPath?: string
  matchedAskRule?: { source?: string; toolName?: string; ruleContent?: string }
}

function ApprovalRow({
  approval,
  expanded,
  onToggle,
  onApprove,
  onDeny,
}: {
  approval: Approval
  expanded: boolean
  onToggle: () => void
  onApprove: (requestId: string, modifiedInput?: Record<string, unknown>) => void
  onDeny: (requestId: string, reason?: string) => void
}) {
  const [modified, setModified] = useState<Record<string, unknown>>(approval.input)
  const [hasEdits, setHasEdits] = useState(false)

  const Form = FORM_MAP[approval.toolName] || DefaultApproval
  const Icon = TOOL_ICON[approval.toolName] || Wrench
  const text = approval.title || summary(approval.toolName, approval.input)

  return (
    <div>
      <div className="flex items-center gap-2 px-3 py-1.5 min-h-[32px]">
        <button
          type="button"
          className="shrink-0 p-0.5 rounded hover:bg-muted/80 transition-colors"
          onClick={onToggle}
        >
          {expanded
            ? <ChevronDown className="w-3 h-3 text-muted-foreground" />
            : <ChevronRight className="w-3 h-3 text-muted-foreground" />
          }
        </button>
        <Icon className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
        <span className="text-[11px] font-mono text-muted-foreground shrink-0">{FRIENDLY_NAME[approval.toolName] || approval.toolName}</span>
        <span className="text-xs truncate flex-1 text-foreground">{text}</span>
        {hasEdits && <span className="text-[9px] text-warning shrink-0">edited</span>}
        <Button
          size="sm"
          variant="ghost"
          className="h-6 w-6 p-0 text-destructive hover:bg-destructive/10 shrink-0"
          onClick={() => onDeny(approval.requestId, "user denied")}
          title="deny"
        >
          <X className="w-3.5 h-3.5" />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-6 w-6 p-0 text-emerald-500 hover:bg-emerald-500/10 shrink-0"
          onClick={() => onApprove(approval.requestId, hasEdits ? modified : undefined)}
          title="allow"
        >
          <Check className="w-3.5 h-3.5" />
        </Button>
      </div>
      {expanded && (
        <div className="px-3 pb-2 pl-[52px]">
          {(approval.decisionReason || approval.blockedPath || approval.matchedAskRule) && (
            <div className="mb-1.5 space-y-0.5">
              {approval.decisionReason && (
                <div className="text-[10px] text-muted-foreground">{approval.decisionReason}</div>
              )}
              {approval.blockedPath && (
                <div className="text-[10px] text-warning font-mono truncate">blocked path: {approval.blockedPath}</div>
              )}
              {approval.matchedAskRule && (
                <div className="text-[9px] font-mono text-muted-foreground/80">
                  <span className="rounded bg-muted/60 px-1 py-px">
                    ask rule{approval.matchedAskRule.source ? ` · ${approval.matchedAskRule.source}` : ''}
                    {approval.matchedAskRule.ruleContent ? ` · ${approval.matchedAskRule.ruleContent}` : ''}
                  </span>
                </div>
              )}
            </div>
          )}
          <div className="rounded-md border border-border/40 bg-muted/20 p-2">
            <Form
              toolName={approval.toolName}
              input={modified}
              onModify={(v) => { setModified(v); setHasEdits(true) }}
            />
          </div>
        </div>
      )}
    </div>
  )
}

type ApprovalListProps = {
  approvals: Approval[]
  onApprove: (requestId: string, modifiedInput?: Record<string, unknown>) => void
  onDeny: (requestId: string, reason?: string) => void
}

export function ApprovalList({ approvals, onApprove, onDeny }: ApprovalListProps) {
  // single item: expand by default. multiple: all collapsed.
  const [expandedId, setExpandedId] = useState<string | null>(
    approvals.length === 1 ? approvals[0].requestId : null
  )

  if (approvals.length === 0) return null

  return (
    <Card className="border-warning/50 bg-card overflow-hidden">
      {/* header — only when multiple */}
      {approvals.length > 1 && (
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border/40">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-warning flex-1">
            {approvals.length} pending
          </span>
          <Button
            size="sm"
            variant="ghost"
            className="h-5 text-[9px] text-emerald-500 hover:bg-emerald-500/10 px-1.5"
            onClick={() => approvals.forEach(a => onApprove(a.requestId))}
          >
            allow all
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-5 text-[9px] text-destructive hover:bg-destructive/10 px-1.5"
            onClick={() => approvals.forEach(a => onDeny(a.requestId, 'user denied'))}
          >
            deny all
          </Button>
        </div>
      )}

      <div className={cn(
        "divide-y divide-border/30",
        approvals.length > 4 && "max-h-[35vh] overflow-y-auto",
      )}>
        {approvals.map(a => (
          <ApprovalRow
            key={a.requestId}
            approval={a}
            expanded={expandedId === a.requestId}
            onToggle={() => setExpandedId(prev => prev === a.requestId ? null : a.requestId)}
            onApprove={onApprove}
            onDeny={onDeny}
          />
        ))}
      </div>
    </Card>
  )
}
