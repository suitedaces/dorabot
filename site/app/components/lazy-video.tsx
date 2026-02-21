"use client"

import { useRef, useEffect } from "react"

export function LazyVideo({ src, className }: { src: string; className?: string }) {
  const ref = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    const video = ref.current
    if (!video) return

    const isMobile = window.matchMedia("(max-width: 767px)").matches

    if (isMobile) video.controls = true

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          if (isMobile) {
            video.preload = "metadata"
            video.src = src + "#t=0.001"
          } else {
            video.src = src
            video.play()
          }
          observer.disconnect()
        }
      },
      { rootMargin: "300px" }
    )
    observer.observe(video)
    return () => observer.disconnect()
  }, [src])

  return (
    <div className="aspect-video bg-surface-base/30">
      <video ref={ref} loop muted playsInline className={className} />
    </div>
  )
}
