"use client"

import { useRef, useState, useEffect } from "react"

export function LazyVideo({
  src,
  className,
}: {
  src: string
  className?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [load, setLoad] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          // small delay so we don't fire all at once during fast scroll
          const t = setTimeout(() => setLoad(true), 150)
          observer.disconnect()
          return () => clearTimeout(t)
        }
      },
      { rootMargin: "300px" }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return (
    <div ref={ref} className="aspect-video bg-surface-base/30">
      {load && (
        <video
          src={src}
          autoPlay
          loop
          muted
          playsInline
          preload="none"
          className={className}
        />
      )}
    </div>
  )
}
