import type { ToolUIProps } from "./index"
import { Check } from "lucide-react"

type Question = {
  question: string
  header?: string
  options?: { label: string; description?: string }[]
}

export function AskUserQuestionTool({ input, output }: ToolUIProps) {
  let questions: Question[] = []
  let answers: Record<string, string> = {}
  try {
    const parsed = JSON.parse(input)
    questions = parsed.questions || []
    answers = parsed.answers || {}
  } catch {}

  const hasAnswers = Object.values(answers).some(Boolean)

  // Compact: just show the answer summary
  if (!hasAnswers && output) {
    return <div className="text-xs py-0.5">{output}</div>
  }

  if (questions.length === 0) {
    return <div className="text-xs text-muted-foreground py-0.5">{output || 'No questions'}</div>
  }

  return (
    <div className="space-y-1.5 py-0.5">
      {questions.map((q, i) => {
        const answer = answers[q.question] || ''
        const header = q.header || `Q${i + 1}`
        return (
          <div key={i}>
            <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">{header}</span>
            {answer ? (
              <div className="flex items-center gap-1.5 text-xs font-medium">
                <Check className="w-3 h-3 text-green-500 shrink-0" />
                {answer}
              </div>
            ) : (
              <div className="text-xs text-muted-foreground">{q.question}</div>
            )}
          </div>
        )
      })}
    </div>
  )
}
