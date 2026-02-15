"use client"

import { useEffect } from "react"
import { motion, stagger, useAnimate, useInView } from "motion/react"
import { cn } from "@/lib/utils"

export function TextGenerateEffect({
  words,
  className,
  filter = true,
  duration = 0.5,
}: {
  words: string
  className?: string
  filter?: boolean
  duration?: number
}) {
  const [scope, animate] = useAnimate()
  const isInView = useInView(scope, { once: true })
  const wordsArray = words.split(" ")

  useEffect(() => {
    if (isInView) {
      animate(
        "span",
        { opacity: 1, filter: filter ? "blur(0px)" : "none" },
        { duration, delay: stagger(0.02) }
      )
    }
  }, [isInView, animate, filter, duration])

  return (
    <div ref={scope} className={cn(className)}>
      {wordsArray.map((word, idx) => (
        <motion.span
          key={`${word}-${idx}`}
          className="opacity-0"
          style={{ filter: filter ? "blur(4px)" : "none" }}
        >
          {word}{" "}
        </motion.span>
      ))}
    </div>
  )
}
