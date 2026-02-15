"use client"

import { motion, stagger, useAnimate, useInView } from "motion/react"
import { useEffect } from "react"
import { cn } from "@/lib/utils"

export function TypewriterEffect({
  words,
  className,
  cursorClassName,
}: {
  words: { text: string; className?: string }[]
  className?: string
  cursorClassName?: string
}) {
  const [scope, animate] = useAnimate()
  const isInView = useInView(scope, { once: true })

  useEffect(() => {
    if (isInView) {
      animate(
        "span",
        { display: "inline-block", opacity: 1 },
        { duration: 0.1, delay: stagger(0.05), ease: "easeInOut" }
      )
    }
  }, [isInView, animate])

  const renderWords = () => (
    <motion.div ref={scope} className="inline">
      {words.map((word, idx) => (
        <div key={`word-${idx}`} className="inline-block">
          {word.text.split("").map((char, charIdx) => (
            <motion.span
              key={`char-${charIdx}`}
              className={cn("hidden opacity-0", word.className)}
            >
              {char}
            </motion.span>
          ))}
          {idx < words.length - 1 && <span>&nbsp;</span>}
        </div>
      ))}
    </motion.div>
  )

  return (
    <div className={cn("flex items-center", className)}>
      {renderWords()}
      <motion.span
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.8, repeat: Infinity, repeatType: "reverse" }}
        className={cn(
          "inline-block rounded-sm w-[4px] h-8 ml-1 bg-accent",
          cursorClassName
        )}
      />
    </div>
  )
}

export function TypewriterEffectSmooth({
  words,
  className,
  cursorClassName,
}: {
  words: { text: string; className?: string }[]
  className?: string
  cursorClassName?: string
}) {
  const textContent = words.map((w) => w.text).join(" ")

  return (
    <div className={cn("flex items-center", className)}>
      <motion.div
        className="overflow-hidden"
        initial={{ width: "0%" }}
        whileInView={{ width: "fit-content" }}
        viewport={{ once: true }}
        transition={{ duration: 1.5, ease: "linear", delay: 0.2 }}
      >
        <div className="whitespace-nowrap">
          {words.map((word, idx) => (
            <span key={idx} className={cn("font-bold", word.className)}>
              {word.text}
              {idx < words.length - 1 && " "}
            </span>
          ))}
        </div>
      </motion.div>
      <motion.span
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.8, repeat: Infinity, repeatType: "reverse" }}
        className={cn(
          "block rounded-sm w-[4px] h-8 bg-accent",
          cursorClassName
        )}
      />
    </div>
  )
}
