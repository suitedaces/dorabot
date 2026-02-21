"use client"

import { useState, useRef, useCallback, useEffect } from "react"

const PREVIEW_URL = "https://pub-4316e19c5e0c4561879dabd80ec994f7.r2.dev/demo-preview.mp4"
const FULL_VIDEO_URL = "https://pub-4316e19c5e0c4561879dabd80ec994f7.r2.dev/dorabot-demo-annotated.mp4"
const POSTER_URL = "https://pub-4316e19c5e0c4561879dabd80ec994f7.r2.dev/demo-poster.jpg"

export function DemoVideo() {
  const [state, setState] = useState<"poster" | "preview" | "full">("poster")
  const containerRef = useRef<HTMLDivElement>(null)
  const previewRef = useRef<HTMLVideoElement>(null)
  const fullVideoRef = useRef<HTMLVideoElement>(null)

  // Only start loading the preview video once the container is near viewport
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setState("preview")
          observer.disconnect()
        }
      },
      { rootMargin: "200px" }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (state === "preview") previewRef.current?.play()
  }, [state])

  const playFull = useCallback(() => {
    setState("full")
    setTimeout(() => fullVideoRef.current?.play(), 0)
  }, [])

  return (
    <div ref={containerRef} className="mx-auto mt-10 w-full max-w-6xl hero-stagger hero-stagger-7">
      <div className="relative overflow-hidden rounded-xl border border-border bg-surface-base/50 shadow-2xl shadow-black/20" style={{ aspectRatio: "3200/2160" }}>
        {state !== "full" ? (
          <div className="absolute inset-0 cursor-pointer" onClick={playFull}>
            {state === "preview" ? (
              <video
                ref={previewRef}
                loop
                muted
                playsInline
                preload="auto"
                poster={POSTER_URL}
                className="h-full w-full object-cover"
              >
                <source src={PREVIEW_URL} type="video/mp4" />
              </video>
            ) : (
              <img
                src={POSTER_URL}
                alt="dorabot demo"
                className="h-full w-full object-cover"
              />
            )}
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/10 transition-colors hover:bg-black/20">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-white/90 shadow-lg backdrop-blur-sm transition-transform hover:scale-110 sm:h-20 sm:w-20">
                <svg className="h-7 w-7 translate-x-0.5 text-gray-900 sm:h-8 sm:w-8" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M8 5v14l11-7z" />
                </svg>
              </div>
              <span className="rounded-full bg-black/50 px-4 py-1.5 text-sm font-medium text-white backdrop-blur-sm">Click to play</span>
            </div>
          </div>
        ) : (
          <video
            ref={fullVideoRef}
            controls
            playsInline
            className="absolute inset-0 h-full w-full object-cover"
          >
            <source src={FULL_VIDEO_URL} type="video/mp4" />
          </video>
        )}
      </div>
    </div>
  )
}
