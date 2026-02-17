import { motion } from "motion/react"
import { LayoutGrid, Plus, Pencil, Eye, ArrowRightCircle, Map } from "lucide-react"
import type { ToolUIProps } from "../tool-ui"
import { safeParse } from "../../lib/safe-parse"

const COLUMN_COLORS: Record<string, string> = {
  plan: "bg-amber-500",
  now: "bg-amber-500",
  next: "bg-blue-500",
  later: "bg-violet-500",
  in_progress: "bg-violet-500",
  done: "bg-emerald-500",
  failed: "bg-destructive",
}

const TOOL_META: Record<string, { icon: typeof LayoutGrid; verb: string; color: string }> = {
  plan_view: { icon: Eye, verb: "viewing", color: "text-violet-400" },
  plan_add: { icon: Plus, verb: "adding", color: "text-blue-400" },
  plan_update: { icon: Pencil, verb: "updating", color: "text-amber-400" },
  plan_start: { icon: ArrowRightCircle, verb: "starting", color: "text-emerald-400" },
  roadmap_view: { icon: Eye, verb: "viewing", color: "text-violet-400" },
  roadmap_add: { icon: Plus, verb: "adding", color: "text-blue-400" },
  roadmap_update: { icon: Pencil, verb: "updating", color: "text-amber-400" },
  roadmap_create_plan: { icon: Map, verb: "creating plan", color: "text-emerald-400" },
}

function MiniBoard({ streaming }: { streaming?: boolean }) {
  const cols = ["bg-amber-500/40", "bg-blue-500/40", "bg-violet-500/40", "bg-emerald-500/40"]
  return (
    <div className="flex gap-[3px] w-10 h-10 p-1 rounded-md border border-border/30 bg-secondary/30">
      {cols.map((color, i) => (
        <div key={i} className="flex-1 flex flex-col gap-[2px]">
          <div className={`h-[3px] rounded-sm ${color}`} />
          {i < 2 && (
            <motion.div
              className={`h-[5px] rounded-sm ${color} opacity-60`}
              animate={streaming ? { opacity: [0.3, 0.7, 0.3] } : {}}
              transition={streaming ? { duration: 1.5, repeat: Infinity, delay: i * 0.3 } : {}}
            />
          )}
          {i === 0 && (
            <motion.div
              className={`h-[5px] rounded-sm ${color} opacity-40`}
              animate={streaming ? { opacity: [0.2, 0.5, 0.2] } : {}}
              transition={streaming ? { duration: 1.5, repeat: Infinity, delay: 0.6 } : {}}
            />
          )}
        </div>
      ))}
    </div>
  )
}

export function PlanStream({ name, input, output, isError, streaming }: ToolUIProps) {
  const parsed = safeParse(input)
  const meta = TOOL_META[name] || TOOL_META.plan_view
  const Icon = meta.icon
  const done = !streaming && output != null

  // extract useful fields based on tool type
  const title = parsed.title || ""
  const id = parsed.id || ""
  const status = parsed.status || ""
  const tasks = Array.isArray(parsed.tasks) ? parsed.tasks : []

  return (
    <div className="rounded-lg overflow-hidden border border-border/60 bg-[var(--stream-base)]">
      <div className="flex items-center gap-3 px-3 py-3">
        <MiniBoard streaming={streaming} />

        <div className="flex-1 min-w-0 space-y-1.5">
          {/* action badge */}
          <div className="flex items-center gap-2">
            <Icon className={`w-3 h-3 ${meta.color}`} />
            <span className={`text-[10px] uppercase tracking-wider font-medium ${meta.color}`}>
              {meta.verb}
            </span>
            {done && (
              <motion.span
                className={`text-[9px] ml-auto px-1.5 py-0.5 rounded ${
                  isError ? "text-destructive bg-destructive/10" : "text-success bg-success/10"
                }`}
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
              >
                {isError ? "failed" : "done"}
              </motion.span>
            )}
          </div>

          {/* task detail for add/update */}
          {title && (
            <motion.div
              className="flex items-center gap-1.5"
              initial={{ opacity: 0, x: -4 }}
              animate={{ opacity: 1, x: 0 }}
            >
              {id && <code className="text-[10px] text-muted-foreground/50">#{id}</code>}
              <span className="text-[11px] text-foreground/80 truncate">{title}</span>
              {status && (
                <span className="flex items-center gap-1 ml-1">
                  <span className={`w-1.5 h-1.5 rounded-full ${COLUMN_COLORS[status] || "bg-muted-foreground"}`} />
                  <span className="text-[9px] text-muted-foreground">{status.replace("_", " ")}</span>
                </span>
              )}
            </motion.div>
          )}

          {/* batch propose — show task list */}
          {tasks.length > 0 && (
            <div className="space-y-0.5">
              {tasks.slice(0, 6).map((t: any, i: number) => (
                <motion.div
                  key={i}
                  className="flex items-center gap-1.5 text-[10px] text-muted-foreground/70"
                  initial={{ opacity: 0, x: -4 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.08 }}
                >
                  <span className="w-1 h-1 rounded-full bg-amber-500/50 shrink-0" />
                  <span className="truncate">{t.title || t}</span>
                </motion.div>
              ))}
              {tasks.length > 6 && (
                <span className="text-[9px] text-muted-foreground/40 pl-2.5">+{tasks.length - 6} more</span>
              )}
            </div>
          )}

          {/* view filter */}
          {(name === "plan_view" || name === "roadmap_view") && (parsed.status || parsed.lane) && (
            <motion.div
              className="text-[10px] text-muted-foreground/60"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
            >
              filter: {parsed.status || parsed.lane}
            </motion.div>
          )}
        </div>
      </div>

      {/* output */}
      {output && (
        <motion.div
          className="border-t border-border/20 px-3 py-2"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
        >
          <pre className={`text-[10px] font-mono whitespace-pre-wrap ${isError ? "text-destructive" : "text-muted-foreground"}`}>
            {output.slice(0, 1500)}
          </pre>
        </motion.div>
      )}
    </div>
  )
}
