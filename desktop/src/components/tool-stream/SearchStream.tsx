import { motion, AnimatePresence } from "motion/react"
import { Search, Globe } from "lucide-react"
import type { ToolUIProps } from "../tool-ui"
import { safeParse } from "../../lib/safe-parse"

function RadarPulse() {
  return (
    <div className="relative w-8 h-8">
      <Globe className="absolute inset-1.5 w-5 h-5 text-primary/60" />
      {[0, 1, 2].map(i => (
        <motion.div
          key={i}
          className="absolute inset-0 rounded-full border border-primary/30"
          initial={{ scale: 0.5, opacity: 0.8 }}
          animate={{ scale: 1.8, opacity: 0 }}
          transition={{ duration: 2, repeat: Infinity, delay: i * 0.6 }}
        />
      ))}
    </div>
  )
}

export function SearchStream({ input, output, isError, streaming }: ToolUIProps) {
  const parsed = safeParse(input)

  const query = parsed.query || ""
  const done = !streaming && output != null

  // parse simple result count from output
  let resultHint = ""
  if (output && !isError) {
    const lines = output.split("\n").filter(l => l.trim())
    resultHint = `${Math.min(lines.length, 10)}+ results`
  }

  return (
    <div className="rounded-lg overflow-hidden border border-border/60 bg-[var(--stream-base)]">
      {/* search bar */}
      <div className="px-3 py-2.5 bg-[var(--stream-raised)]">
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-[var(--stream-deep)] border border-border/30">
          <Search className={`w-3.5 h-3.5 shrink-0 ${streaming ? 'text-primary' : 'text-muted-foreground/60'}`} />
          <span className="text-[12px] text-foreground/80 truncate flex-1">
            {query || "..."}
            {streaming && query && (
              <motion.span
                className="inline-block w-[2px] h-3.5 bg-primary/80 ml-0.5 align-middle"
                animate={{ opacity: [1, 0] }}
                transition={{ duration: 0.5, repeat: Infinity }}
              />
            )}
          </span>
          {streaming && (
            <motion.div
              className="w-3.5 h-3.5 rounded-full border-2 border-primary/50 border-t-primary"
              animate={{ rotate: 360 }}
              transition={{ duration: 0.8, repeat: Infinity, ease: "linear" }}
            />
          )}
        </div>
      </div>

      {/* content area */}
      <div className="px-3 py-3">
        <AnimatePresence mode="wait">
          {streaming && !output ? (
            <motion.div
              key="searching"
              className="flex flex-col items-center gap-3 py-2"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <RadarPulse />
              <motion.span
                className="text-[10px] text-muted-foreground/60"
                animate={{ opacity: [0.4, 0.8, 0.4] }}
                transition={{ duration: 1.5, repeat: Infinity }}
              >
                searching the web...
              </motion.span>
            </motion.div>
          ) : output ? (
            <motion.div
              key="results"
              className="space-y-1"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
            >
              {resultHint && (
                <div className="text-[10px] text-muted-foreground/50 mb-2">{resultHint}</div>
              )}
              <pre className={`text-[11px] font-mono whitespace-pre-wrap max-h-[200px] overflow-auto ${
                isError ? 'text-destructive' : 'text-muted-foreground'
              }`}>
                {output.slice(0, 3000)}
              </pre>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>
    </div>
  )
}
