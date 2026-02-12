import { motion } from "motion/react"
import { Check, Circle, Loader2, ListChecks } from "lucide-react"
import type { ToolUIProps } from "../tool-ui"
import { safeParse } from "../../lib/safe-parse"

type Todo = { content: string; status: "pending" | "in_progress" | "completed"; activeForm: string }

export function ProgressStream({ input, output, isError, streaming }: ToolUIProps) {
  const todos: Todo[] = safeParse(input).todos || []

  const done = todos.filter(t => t.status === "completed").length
  const total = todos.length
  const pct = total > 0 ? (done / total) * 100 : 0
  const finished = !streaming && output != null

  return (
    <div className="rounded-lg overflow-hidden border border-border/60 bg-[var(--stream-deep)] font-mono">
      {/* tab bar */}
      <div className="flex items-center bg-[var(--stream-mid)] border-b border-border/30">
        <div className="flex items-center gap-1.5 px-3 py-1.5 bg-[var(--stream-deep)] border-r border-border/30 relative">
          <ListChecks className="w-3 h-3 text-primary" />
          <span className="text-[10px] text-foreground/80">tasks</span>
          <span className="text-[9px] text-muted-foreground/50 ml-1">{done}/{total}</span>
          {streaming && (
            <motion.div
              className="absolute bottom-0 left-0 right-0 h-[2px] bg-primary/50"
              animate={{ opacity: [0.3, 0.8, 0.3] }}
              transition={{ duration: 1, repeat: Infinity }}
            />
          )}
        </div>
        <span className="flex-1" />
        {finished && (
          <motion.span
            className={`text-[9px] px-2 py-0.5 mr-2 rounded ${
              isError ? "text-destructive/80" : "text-success/80"
            }`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
          >
            {isError ? "error" : "updated"}
          </motion.span>
        )}
      </div>

      {/* progress bar */}
      {total > 0 && (
        <div className="px-3 pt-2 pb-1">
          <div className="w-full h-1 bg-muted-foreground/8 rounded-full overflow-hidden">
            <motion.div
              className="h-full bg-primary/60 rounded-full"
              initial={{ width: 0 }}
              animate={{ width: `${pct}%` }}
              transition={{ duration: 0.4 }}
            />
          </div>
        </div>
      )}

      {/* task list */}
      {todos.length > 0 && (
        <div className="px-3 py-2 space-y-0.5">
          {todos.map((t, i) => (
            <motion.div
              key={i}
              className="flex items-center gap-2 text-[10px] leading-5"
              initial={{ opacity: 0, x: -4 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.03 }}
            >
              <span className="w-4 text-right select-none shrink-0 text-muted-foreground/20">{i + 1}</span>
              {t.status === "completed" ? (
                <Check className="w-3 h-3 text-success/70 shrink-0" />
              ) : t.status === "in_progress" ? (
                <Loader2 className="w-3 h-3 text-primary/70 shrink-0 animate-spin" />
              ) : (
                <Circle className="w-2.5 h-2.5 text-muted-foreground/20 shrink-0" />
              )}
              <span className={
                t.status === "completed"
                  ? "text-muted-foreground/40 line-through"
                  : t.status === "in_progress"
                    ? "text-foreground/80"
                    : "text-muted-foreground/50"
              }>
                {t.status === "in_progress" ? t.activeForm : t.content}
              </span>
            </motion.div>
          ))}
        </div>
      )}

      {/* streaming skeleton */}
      {streaming && todos.length === 0 && (
        <div className="px-3 py-2 space-y-1">
          {[0, 1, 2].map(i => (
            <motion.div
              key={i}
              className="flex gap-2 items-center"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: i * 0.08 }}
            >
              <span className="text-[9px] text-muted-foreground/20 w-4 text-right select-none">{i + 1}</span>
              <motion.div
                className="h-2.5 rounded-sm bg-muted-foreground/8"
                style={{ width: `${40 + Math.random() * 40}%` }}
                animate={{ opacity: [0.3, 0.6, 0.3] }}
                transition={{ duration: 1.5, repeat: Infinity, delay: i * 0.1 }}
              />
            </motion.div>
          ))}
        </div>
      )}
    </div>
  )
}
