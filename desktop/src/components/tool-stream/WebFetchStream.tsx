import { motion, AnimatePresence } from "motion/react"
import { Globe, ArrowDown, Link } from "lucide-react"
import type { ToolUIProps } from "../tool-ui"

function DownloadWave() {
  return (
    <div className="flex items-end gap-0.5 h-4">
      {[0, 1, 2, 3, 4].map(i => (
        <motion.div
          key={i}
          className="w-1 rounded-full bg-primary/50"
          animate={{ height: [4, 14, 4] }}
          transition={{ duration: 0.8, repeat: Infinity, delay: i * 0.12 }}
        />
      ))}
    </div>
  )
}

export function WebFetchStream({ input, output, isError, streaming }: ToolUIProps) {
  let parsed: any = {}
  try { parsed = JSON.parse(input) } catch {}

  const url = parsed.url || ""
  const prompt = parsed.prompt || ""
  const done = !streaming && output != null

  let host = ""
  try { host = new URL(url).hostname } catch {}

  return (
    <div className="rounded-lg overflow-hidden border border-border/60 bg-[oklch(0.12_0.005_280)]">
      {/* url bar */}
      <div className="flex items-center gap-2 px-3 py-2 bg-[oklch(0.15_0.005_280)] border-b border-border/30">
        <Globe className={`w-3.5 h-3.5 shrink-0 ${streaming ? 'text-primary' : 'text-muted-foreground/60'}`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 text-[11px]">
            {host && <span className="text-foreground/70 font-medium">{host}</span>}
            {streaming && url && (
              <motion.span
                className="inline-block w-[2px] h-3 bg-primary/80"
                animate={{ opacity: [1, 0] }}
                transition={{ duration: 0.5, repeat: Infinity }}
              />
            )}
          </div>
          {url && host !== url && (
            <div className="text-[9px] text-muted-foreground/40 truncate">{url}</div>
          )}
        </div>
        {streaming && <DownloadWave />}
        {done && (
          <motion.span
            className={`text-[9px] px-1.5 py-0.5 rounded ${
              isError ? 'text-destructive bg-destructive/10' : 'text-success bg-success/10'
            }`}
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
          >
            {isError ? "error" : "fetched"}
          </motion.span>
        )}
      </div>

      {/* prompt */}
      {prompt && (
        <motion.div
          className="px-3 py-1.5 border-b border-border/20 text-[10px] text-muted-foreground/60"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
        >
          <span className="text-primary/50">prompt:</span> {prompt.slice(0, 150)}
        </motion.div>
      )}

      {/* loading state */}
      {streaming && !output && (
        <div className="px-3 py-4 flex flex-col items-center gap-2">
          <motion.div
            className="flex items-center gap-2 text-[10px] text-muted-foreground/50"
            animate={{ opacity: [0.4, 0.8, 0.4] }}
            transition={{ duration: 1.5, repeat: Infinity }}
          >
            <ArrowDown className="w-3 h-3" />
            fetching content...
          </motion.div>
        </div>
      )}

      {/* output */}
      <AnimatePresence>
        {output && (
          <motion.div
            className="max-h-[200px] overflow-auto"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
          >
            <pre className={`px-3 py-2 text-[10px] font-mono whitespace-pre-wrap leading-relaxed ${
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
