import { useEffect } from "react"
import { motion, stagger, useAnimate } from "motion/react"
import { cn } from "@/lib/utils"

export function TextGenerateEffect({ words, className }: { words: string; className?: string }) {
  const [scope, animate] = useAnimate()
  const wordsArray = words.split(" ")

  useEffect(() => {
    animate("span", { opacity: 1, filter: "blur(0px)" }, { duration: 0.3, delay: stagger(0.02) })
  }, [scope, animate, words])

  return (
    <div ref={scope} className={cn("font-mono text-sm", className)}>
      {wordsArray.map((word, idx) => (
        <motion.span key={`${word}-${idx}`} className="opacity-0" style={{ filter: "blur(4px)" }}>
          {word}{" "}
        </motion.span>
      ))}
    </div>
  )
}
