import { useEffect, useState, useCallback } from "react"
import { AnimatePresence, motion } from "motion/react"
import { cn } from "@/lib/utils"

export function FlipWords({ words, duration = 3000, className }: { words: string[]; duration?: number; className?: string }) {
  const [index, setIndex] = useState(0)

  const next = useCallback(() => {
    setIndex(prev => (prev + 1) % words.length)
  }, [words.length])

  useEffect(() => {
    const id = setInterval(next, duration)
    return () => clearInterval(id)
  }, [next, duration])

  return (
    <AnimatePresence mode="wait">
      <motion.span
        key={words[index]}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -10 }}
        transition={{ duration: 0.2 }}
        className={cn("inline-block", className)}
      >
        {words[index]}
      </motion.span>
    </AnimatePresence>
  )
}
