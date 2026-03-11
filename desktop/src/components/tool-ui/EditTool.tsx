import type { ToolUIProps } from "./index"
import { Badge } from "@/components/ui/badge"
import { Pencil } from "lucide-react"
import { diffLines } from "diff"

type DiffLine = { type: "ctx" | "del" | "add"; line: string }

function computeDiff(oldStr: string, newStr: string): DiffLine[] {
  const changes = diffLines(oldStr, newStr)
  const result: DiffLine[] = []
  for (const change of changes) {
    const lines = change.value.split("\n")
    if (lines[lines.length - 1] === "") lines.pop()
    const type = change.added ? "add" : change.removed ? "del" : "ctx"
    for (const line of lines) result.push({ type, line })
  }
  return result
}

const STYLES = {
  del: { bg: "diff-line-del", text: "text-destructive", gutter: "text-destructive/60", prefix: "\u2212" },
  add: { bg: "diff-line-add", text: "text-success", gutter: "text-success/60", prefix: "+" },
  ctx: { bg: "", text: "text-muted-foreground/60", gutter: "text-muted-foreground/25", prefix: " " },
} as const

export function EditTool({ input }: ToolUIProps) {
  let parsed: any = {}
  try { parsed = JSON.parse(input) } catch {}

  const filePath = parsed.file_path || ""
  const oldStr = parsed.old_string || ""
  const newStr = parsed.new_string || ""
  const lines = computeDiff(oldStr, newStr)

  let oldNum = 0, newNum = 0
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-xs">
        <Pencil className="w-3.5 h-3.5 text-warning" />
        <span className="text-muted-foreground font-mono truncate">{filePath}</span>
        {parsed.replace_all && <Badge variant="outline" className="text-[9px] h-4">replace all</Badge>}
      </div>
      <div className="rounded-md border border-border/40 overflow-auto max-h-[200px] font-mono">
        {lines.map((d, i) => {
          if (d.type === "del" || d.type === "ctx") oldNum++
          if (d.type === "add" || d.type === "ctx") newNum++
          const s = STYLES[d.type]
          return (
            <div key={i} className={`flex text-[10px] leading-5 ${s.bg}`}>
              <span className={`w-7 text-right select-none shrink-0 pr-1 ${s.gutter}`}>
                {d.type !== "add" ? oldNum : ""}
              </span>
              <span className={`w-7 text-right select-none shrink-0 pr-1 border-r border-border/15 mr-1 ${s.gutter}`}>
                {d.type !== "del" ? newNum : ""}
              </span>
              <span className={`w-3 select-none shrink-0 text-center ${s.gutter}`}>{s.prefix}</span>
              <span className={`whitespace-pre-wrap break-all px-1 ${s.text}`}>{d.line || "\u00A0"}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
