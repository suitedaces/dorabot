import { motion, AnimatePresence } from "motion/react"
import { Lock, RotateCw, ArrowLeft, ArrowRight, X, ExternalLink } from "lucide-react"
import type { ToolUIProps } from "../tool-ui"
import { safeParse } from "../../lib/safe-parse"
import { isSafeUrl } from "../../lib/url"
import { ElapsedTime } from "./ElapsedTime"

const ACTION_LABELS: Record<string, string> = {
  open: "navigating", click: "clicking", type: "typing", fill: "filling",
  screenshot: "capturing", snapshot: "reading page", scroll: "scrolling",
  evaluate: "running script", wait: "waiting", hover: "hovering",
  select: "selecting", pdf: "saving pdf", back: "going back",
  forward: "going forward", reload: "reloading", close: "closing",
}

export function BrowserStream({ input, output, imageData, isError, streaming }: ToolUIProps) {
  const parsed = safeParse(input)

  const action = parsed.action || ""
  const text = parsed.text || parsed.value || ""
  const ref = parsed.ref || ""
  const label = ACTION_LABELS[action] || action
  const done = !streaming && output != null

  // extract page url from output [page: ...] tag, fall back to input url.
  // non-greedy char class avoids capturing junk on lines that contain more ']'.
  const pageUrlMatch = output?.match(/\[page: ([^\]]+)\]/)
  const rawUrl = pageUrlMatch?.[1] || parsed.url || ""
  // only trust urls with http(s)/about scheme. anything else (javascript:,
  // file:, data:) is dropped so the address bar can't be used as a handoff
  // to unsafe navigation.
  const url = isSafeUrl(rawUrl) ? rawUrl : ""
  const isHttps = url.startsWith("https:")

  return (
    <div className="rounded-lg overflow-hidden border border-border/60 bg-[var(--stream-mid)]">
      {/* title bar */}
      <div className="flex items-center gap-1.5 px-3 py-1.5 bg-[var(--stream-elevated)] border-b border-border/30">
        <div className="flex gap-1.5">
          <div className="w-2.5 h-2.5 rounded-full bg-destructive/70" />
          <div className="w-2.5 h-2.5 rounded-full bg-warning/70" />
          <div className="w-2.5 h-2.5 rounded-full bg-success/70" />
        </div>
        <div className="flex items-center gap-1.5 ml-3 text-muted-foreground">
          <ArrowLeft className="w-2.5 h-2.5 opacity-40" />
          <ArrowRight className="w-2.5 h-2.5 opacity-40" />
          {streaming && action === "reload" ? (
            <X className="w-2.5 h-2.5" />
          ) : (
            <RotateCw className={`w-2.5 h-2.5 ${streaming ? 'animate-spin opacity-60' : 'opacity-40'}`} />
          )}
        </div>
        <span className="flex-1" />
        <ElapsedTime running={!!streaming} />
      </div>

      {/* address bar — clickable when we know the url, routes to the browser tab */}
      <div className="flex items-center gap-2 px-3 py-1.5 bg-[var(--stream-raised)]">
        {url ? (
          <button
            type="button"
            onClick={() => window.dispatchEvent(new CustomEvent('dorabot:open-browser-tab', { detail: { url } }))}
            title="Open in browser tab"
            className="group flex-1 flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-[var(--stream-base)] border border-border/20 hover:border-primary/50 hover:bg-[var(--stream-elevated)] transition-colors text-left cursor-pointer"
          >
            {isHttps && <Lock className="w-2.5 h-2.5 text-success/70 shrink-0" />}
            <span className="flex-1 text-[11px] font-mono text-foreground/80 truncate">
              {url}
            </span>
            {streaming ? (
              <motion.span
                className="inline-block w-[2px] h-3 bg-primary/80 ml-0.5 shrink-0"
                animate={{ opacity: [1, 0] }}
                transition={{ duration: 0.6, repeat: Infinity }}
              />
            ) : (
              <ExternalLink className="w-2.5 h-2.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
            )}
          </button>
        ) : (
          <div className="flex-1 flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-[var(--stream-base)] border border-border/20">
            <span className="text-[11px] font-mono text-foreground/80 truncate">
              about:blank
            </span>
          </div>
        )}
      </div>

      {/* loading bar */}
      <AnimatePresence>
        {streaming && (
          <motion.div
            className="h-[2px] bg-primary/20 overflow-hidden"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.div
              className="h-full bg-primary"
              initial={{ x: "-100%" }}
              animate={{ x: "100%" }}
              transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
              style={{ width: "40%" }}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* viewport */}
      <div className="relative min-h-[60px]">
        {/* screenshot result */}
        {imageData && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.4 }}
          >
            <img src={imageData} alt="browser" className="w-full" />
          </motion.div>
        )}

        {/* streaming state indicator */}
        {!imageData && (
          <div className="px-3 py-3 space-y-2">
            {/* action badge */}
            {action && (
              <motion.div
                className="flex items-center gap-2"
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
              >
                <motion.div
                  className={`w-1.5 h-1.5 rounded-full ${done ? (isError ? 'bg-destructive' : 'bg-success') : 'bg-primary'}`}
                  animate={streaming ? { scale: [1, 1.4, 1] } : {}}
                  transition={{ duration: 1, repeat: Infinity }}
                />
                <span className="text-[11px] text-muted-foreground">{done ? (isError ? "failed" : "done") : label}</span>
              </motion.div>
            )}

            {/* element ref target */}
            {ref && (
              <motion.div
                className="flex items-center gap-1.5"
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.1 }}
              >
                <div className="w-4 h-4 rounded border border-primary/40 bg-primary/10 flex items-center justify-center">
                  <span className="text-[8px] font-mono text-primary font-bold">{ref}</span>
                </div>
                {text && (
                  <span className="text-[11px] text-foreground/70 font-mono">
                    "{text}"
                    {streaming && (
                      <motion.span
                        className="inline-block w-[2px] h-3 bg-primary/80 ml-0.5 align-middle"
                        animate={{ opacity: [1, 0] }}
                        transition={{ duration: 0.6, repeat: Infinity }}
                      />
                    )}
                  </span>
                )}
              </motion.div>
            )}

            {/* output */}
            {output && !streaming && (
              <motion.pre
                className={`text-[10px] font-mono whitespace-pre-wrap max-h-[120px] overflow-auto ${isError ? 'text-destructive' : 'text-muted-foreground'}`}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
              >
                {output.replace(/\n?\[page: .+\]/, '').slice(0, 2000)}
              </motion.pre>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
