import { cn } from "@/lib/utils"
import { motion } from "motion/react"
import { Check } from "lucide-react"

type Step = { text: string }

export function MultiStepLoader({ steps, currentStep, className }: { steps: Step[]; currentStep: number; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {steps.map((step, i) => (
        <motion.div
          key={i}
          className={cn(
            "flex items-center gap-2 text-xs px-2 py-1 rounded",
            i < currentStep && "text-success",
            i === currentStep && "text-foreground",
            i > currentStep && "text-muted-foreground"
          )}
          initial={{ opacity: 0, x: -10 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: i * 0.1 }}
        >
          <div className={cn(
            "w-4 h-4 rounded-full flex items-center justify-center text-[8px] border",
            i < currentStep && "bg-success border-success text-success-foreground",
            i === currentStep && "border-primary animate-pulse",
            i > currentStep && "border-muted"
          )}>
            {i < currentStep ? <Check className="w-2.5 h-2.5" /> : i + 1}
          </div>
          {step.text}
        </motion.div>
      ))}
    </div>
  )
}
