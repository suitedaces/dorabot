import { useMemo } from "react"
import { motion, AnimatePresence } from "motion/react"
import { FileText, FilePlus, Pencil, FolderSearch, FileSearch } from "lucide-react"
import type { ToolUIProps } from "../tool-ui"
import { safeParse } from "../../lib/safe-parse"
import { computeDiff } from "../../lib/diff"

const TOOL_META: Record<string, { icon: typeof FileText; verb: string; color: string }> = {
  Read:  { icon: FileText,    verb: "reading",    color: "text-primary" },
  Write: { icon: FilePlus,    verb: "writing",    color: "text-success" },
  Edit:  { icon: Pencil,      verb: "editing",    color: "text-warning" },
  Glob:  { icon: FolderSearch, verb: "searching",  color: "text-primary" },
  Grep:  { icon: FileSearch,  verb: "searching",  color: "text-primary" },
}

const DIFF_STYLES = {
  del: { bg: "diff-line-del", text: "text-destructive", gutter: "text-destructive/60", prefix: "\u2212" },
  add: { bg: "diff-line-add", text: "text-success", gutter: "text-success/60", prefix: "+" },
  ctx: { bg: "", text: "text-muted-foreground/60", gutter: "text-muted-foreground/25", prefix: " " },
} as const

function filename(path: string): string {
  return path.split("/").pop() || path
}

function fakeLineNumbers(count: number, start: number = 1): string[] {
  return Array.from({ length: count }, (_, i) => String(start + i))
}

export function FileStream({ name, input, output, isError, streaming }: ToolUIProps) {
  const parsed = safeParse(input)

  const meta = TOOL_META[name] || TOOL_META.Read
  const Icon = meta.icon
  const filePath = parsed.file_path || parsed.pattern || parsed.path || ""
  const done = !streaming && output != null
  const isEdit = name === "Edit"
  const isWrite = name === "Write"
  const oldStr = parsed.old_string || ""
  const newStr = parsed.new_string || ""
  const writeContent = parsed.content || ""
  const command = parsed.command || parsed.query || ""
  const isGlob = name === "Glob"
  const isGrep = name === "Grep"

  return (
    <div className="rounded-lg overflow-hidden border border-border/60 bg-[var(--stream-deep)] font-mono">
      {/* tab bar */}
      <div className="flex items-center bg-[var(--stream-mid)] border-b border-border/30">
        <div className="flex items-center gap-1.5 px-3 py-1.5 bg-[var(--stream-deep)] border-r border-border/30 border-b-0 relative">
          <Icon className={`w-3 h-3 ${meta.color}`} />
          <span className="text-[10px] text-foreground/80 max-w-[180px] truncate">
            {filePath ? filename(filePath) : (isGlob || isGrep ? (command || "...") : "untitled")}
          </span>
          {streaming && (
            <motion.div
              className="absolute bottom-0 left-0 right-0 h-[2px] bg-primary/50"
              animate={{ opacity: [0.3, 0.8, 0.3] }}
              transition={{ duration: 1, repeat: Infinity }}
            />
          )}
        </div>
        <span className="flex-1" />
        {done && (
          <motion.span
            className={`text-[9px] px-2 py-0.5 mr-2 rounded ${
              isError ? 'text-destructive/80' : 'text-success/80'
            }`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
          >
            {isError ? "error" : meta.verb.replace("ing", "ed").replace("eing", "ed")}
          </motion.span>
        )}
      </div>

      {/* file path breadcrumb */}
      {filePath && (
        <div className="px-3 py-1 bg-[var(--stream-base)] border-b border-border/20">
          <span className="text-[9px] text-muted-foreground/50 truncate block">{filePath}</span>
        </div>
      )}

      {/* edit unified diff */}
      {isEdit && (oldStr || newStr) && <EditDiff oldStr={oldStr} newStr={newStr} streaming={streaming} />}

      {/* search pattern for Glob/Grep */}
      {(isGlob || isGrep) && command && !isEdit && (
        <div className="px-3 py-2 border-b border-border/20">
          <div className="flex items-center gap-2 px-2 py-1 rounded bg-[var(--stream-mid)] border border-border/20">
            <span className="text-[9px] text-muted-foreground/50">pattern:</span>
            <span className="text-[11px] text-primary/80">{command}</span>
            {streaming && (
              <motion.span
                className="inline-block w-[2px] h-3 bg-primary/60 ml-0.5"
                animate={{ opacity: [1, 0] }}
                transition={{ duration: 0.5, repeat: Infinity }}
              />
            )}
          </div>
        </div>
      )}

      {/* write content preview */}
      {isWrite && writeContent && (
        <motion.div
          className="px-2 py-2 max-h-[140px] overflow-auto"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
        >
          {writeContent.split("\n").map((line: string, i: number) => (
            <div key={i} className="flex gap-2 text-[10px] leading-5">
              <span className="text-success/30 w-4 text-right select-none shrink-0">{i + 1}</span>
              <span className="text-foreground/70 whitespace-pre-wrap break-all">
                {line}
                {streaming && i === writeContent.split("\n").length - 1 && (
                  <motion.span
                    className="inline-block w-[2px] h-3 bg-success/60 ml-0.5 align-middle"
                    animate={{ opacity: [1, 0] }}
                    transition={{ duration: 0.5, repeat: Infinity }}
                  />
                )}
              </span>
            </div>
          ))}
        </motion.div>
      )}

      {/* streaming skeleton lines (shown while waiting for output) */}
      {streaming && !output && !isEdit && !writeContent && (
        <div className="px-2 py-2 space-y-0.5">
          {fakeLineNumbers(5).map((n, i) => (
            <motion.div
              key={i}
              className="flex gap-2 items-center"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: i * 0.08 }}
            >
              <span className="text-[9px] text-muted-foreground/20 w-4 text-right select-none">{n}</span>
              <motion.div
                className="h-2.5 rounded-sm bg-muted-foreground/8"
                style={{ width: `${30 + Math.random() * 50}%` }}
                animate={{ opacity: [0.3, 0.6, 0.3] }}
                transition={{ duration: 1.5, repeat: Infinity, delay: i * 0.1 }}
              />
            </motion.div>
          ))}
        </div>
      )}

      {/* output */}
      <AnimatePresence>
        {output && (
          <motion.div
            className="max-h-[200px] overflow-auto"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.2 }}
          >
            <pre className={`px-3 py-2 text-[10px] leading-relaxed whitespace-pre-wrap ${
              isError ? 'text-destructive' : 'text-muted-foreground'
            }`}>
              {output.slice(0, 3000)}
            </pre>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function EditDiff({ oldStr, newStr, streaming }: { oldStr: string; newStr: string; streaming?: boolean }) {
  const lines = useMemo(() => computeDiff(oldStr, newStr), [oldStr, newStr])

  let oldNum = 0, newNum = 0
  return (
    <motion.div
      className="px-1 py-1.5 max-h-[200px] overflow-auto"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
    >
      {lines.map((d, i) => {
        if (d.type === "del" || d.type === "ctx") oldNum++
        if (d.type === "add" || d.type === "ctx") newNum++
        const s = DIFF_STYLES[d.type]
        const isLast = i === lines.length - 1
        return (
          <div key={i} className={`flex text-[10px] leading-5 rounded-sm ${s.bg}`}>
            <span className={`w-7 text-right select-none shrink-0 pr-1 ${s.gutter}`}>
              {d.type !== "add" ? oldNum : ""}
            </span>
            <span className={`w-7 text-right select-none shrink-0 pr-1 border-r border-border/15 mr-1 ${s.gutter}`}>
              {d.type !== "del" ? newNum : ""}
            </span>
            <span className={`w-3 select-none shrink-0 text-center ${s.gutter}`}>{s.prefix}</span>
            <span className={`whitespace-pre-wrap break-all px-1 ${s.text}`}>
              {d.line || "\u00A0"}
              {streaming && isLast && d.type === "add" && (
                <motion.span
                  className="inline-block w-[2px] h-3 bg-success/60 ml-0.5 align-middle"
                  animate={{ opacity: [1, 0] }}
                  transition={{ duration: 0.5, repeat: Infinity }}
                />
              )}
            </span>
          </div>
        )
      })}
    </motion.div>
  )
}
