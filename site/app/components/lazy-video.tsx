"use client"

import { useRef, useState, useEffect } from "react"

export function LazyVideo({
  src,
  className,
  ...props
}: {
  src: string
  className?: string
} & React.VideoHTMLAttributes<HTMLVideoElement>) {
  const ref = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true)
          observer.disconnect()
        }
      },
      { rootMargin: "200px" }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return (
    <div ref={ref}>
      {visible ? (
        <video
          src={src}
          autoPlay
          loop
          muted
          playsInline
          preload="metadata"
          className={className}
          {...props}
        />
      ) : (
        <div className={`aspect-video bg-surface-base/30 ${className ?? ""}`} />
      )}
    </div>
  )
}
