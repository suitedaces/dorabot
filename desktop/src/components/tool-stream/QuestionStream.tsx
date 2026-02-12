import { motion } from "motion/react"
import { MessageCircle, CircleDot, CheckSquare } from "lucide-react"
import type { ToolUIProps } from "../tool-ui"
import { safeParse } from "../../lib/safe-parse"

export function QuestionStream({ input, output, isError, streaming }: ToolUIProps) {
  const parsed = safeParse(input)

  const questions: Array<{
    question?: string
    header?: string
    options?: Array<{ label?: string; description?: string }>
    multiSelect?: boolean
  }> = parsed.questions || []

  const done = !streaming && output != null

  return (
    <div className="rounded-lg overflow-hidden border border-border/60 bg-[var(--stream-base)]">
      {/* header */}
      <div className="flex items-center gap-2 px-3 py-2 bg-[var(--stream-raised)] border-b border-border/30">
        <MessageCircle className={`w-3.5 h-3.5 ${streaming ? 'text-primary' : 'text-muted-foreground/60'}`} />
        <span className="text-[10px] text-muted-foreground/60 uppercase tracking-wider">
          {done ? "answered" : streaming ? "asking..." : "question"}
        </span>
        {streaming && !done && (
          <motion.div
            className="ml-auto w-1.5 h-1.5 rounded-full bg-primary"
            animate={{ scale: [1, 1.4, 1], opacity: [0.6, 1, 0.6] }}
            transition={{ duration: 1.2, repeat: Infinity }}
          />
        )}
        {done && (
          <motion.span
            className={`ml-auto text-[9px] px-1.5 py-0.5 rounded ${
              isError ? 'text-destructive bg-destructive/10' : 'text-success bg-success/10'
            }`}
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
          >
            {isError ? "failed" : "answered"}
          </motion.span>
        )}
      </div>

      {/* questions */}
      <div className="px-3 py-2 space-y-3">
        {questions.map((q, qi) => (
          <motion.div
            key={qi}
            className="space-y-1.5"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: qi * 0.1 }}
          >
            {/* question text */}
            {q.question && (
              <div className="text-[11px] text-foreground/80 font-medium">
                {q.header && (
                  <span className="text-[9px] text-primary/60 bg-primary/10 px-1 py-0.5 rounded mr-1.5">{q.header}</span>
                )}
                {q.question}
                {streaming && qi === questions.length - 1 && (
                  <motion.span
                    className="inline-block w-[2px] h-3 bg-primary/80 ml-0.5 align-middle"
                    animate={{ opacity: [1, 0] }}
                    transition={{ duration: 0.5, repeat: Infinity }}
                  />
                )}
              </div>
            )}

            {/* options */}
            {q.options && q.options.length > 0 && (
              <div className="space-y-1 pl-1">
                {q.options.map((opt, oi) => (
                  <motion.div
                    key={oi}
                    className="flex items-start gap-1.5 text-[10px]"
                    initial={{ opacity: 0, x: -6 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: qi * 0.1 + oi * 0.06 }}
                  >
                    {q.multiSelect ? (
                      <CheckSquare className="w-3 h-3 text-muted-foreground/30 shrink-0 mt-0.5" />
                    ) : (
                      <CircleDot className="w-3 h-3 text-muted-foreground/30 shrink-0 mt-0.5" />
                    )}
                    <div>
                      <span className="text-foreground/70">{opt.label}</span>
                      {opt.description && (
                        <span className="text-muted-foreground/40 ml-1">{opt.description}</span>
                      )}
                    </div>
                  </motion.div>
                ))}
              </div>
            )}
          </motion.div>
        ))}

        {/* skeleton while no questions parsed yet */}
        {streaming && questions.length === 0 && (
          <motion.div
            className="flex items-center gap-2 py-2"
            animate={{ opacity: [0.3, 0.7, 0.3] }}
            transition={{ duration: 1.5, repeat: Infinity }}
          >
            <MessageCircle className="w-3.5 h-3.5 text-muted-foreground/20" />
            <div className="h-2.5 rounded bg-muted-foreground/8 w-2/3" />
          </motion.div>
        )}
      </div>

      {/* output */}
      {output && (
        <motion.div
          className="border-t border-border/20 px-3 py-2"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
        >
          <pre className={`text-[10px] font-mono whitespace-pre-wrap max-h-[120px] overflow-auto ${
            isError ? 'text-destructive' : 'text-muted-foreground'
          }`}>
            {output.slice(0, 1000)}
          </pre>
        </motion.div>
      )}
    </div>
  )
}
