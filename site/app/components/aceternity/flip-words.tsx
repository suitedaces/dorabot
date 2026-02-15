"use client"

import { useEffect, useState, useCallback } from "react"
import { AnimatePresence, motion } from "motion/react"
import { cn } from "@/lib/utils"

export function FlipWords({
  words,
  duration = 3000,
  className,
}: {
  words: string[]
  duration?: number
  className?: string
}) {
  const [index, setIndex] = useState(0)

  const next = useCallback(() => {
    setIndex((prev) => (prev + 1) % words.length)
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

// Version that accepts React nodes (for logos + text)
export function FlipNodes({
  items,
  duration = 3000,
  className,
}: {
  items: React.ReactNode[]
  duration?: number
  className?: string
}) {
  const [index, setIndex] = useState(0)

  const next = useCallback(() => {
    setIndex((prev) => (prev + 1) % items.length)
  }, [items.length])

  useEffect(() => {
    const id = setInterval(next, duration)
    return () => clearInterval(id)
  }, [next, duration])

  return (
    <AnimatePresence mode="wait">
      <motion.span
        key={index}
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -14 }}
        transition={{ duration: 0.25 }}
        className={cn("inline-flex items-center gap-3", className)}
      >
        {items[index]}
      </motion.span>
    </AnimatePresence>
  )
}
