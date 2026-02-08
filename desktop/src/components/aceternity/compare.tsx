import { useState, useRef, useCallback } from "react"
import { cn } from "@/lib/utils"

export function Compare({
  before,
  after,
  className,
}: {
  before: React.ReactNode
  after: React.ReactNode
  className?: string
}) {
  const [sliderPos, setSliderPos] = useState(50)
  const containerRef = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)

  const handleMove = useCallback((clientX: number) => {
    if (!containerRef.current || !dragging.current) return
    const rect = containerRef.current.getBoundingClientRect()
    const x = Math.max(0, Math.min(clientX - rect.left, rect.width))
    setSliderPos((x / rect.width) * 100)
  }, [])

  return (
    <div
      ref={containerRef}
      className={cn("relative select-none overflow-hidden rounded-md border border-border", className)}
      onMouseMove={e => handleMove(e.clientX)}
      onMouseUp={() => { dragging.current = false }}
      onMouseLeave={() => { dragging.current = false }}
    >
      <div className="absolute inset-0">{after}</div>
      <div className="absolute inset-0 overflow-hidden" style={{ width: `${sliderPos}%` }}>
        {before}
      </div>
      <div
        className="absolute top-0 bottom-0 w-0.5 bg-primary cursor-col-resize z-10"
        style={{ left: `${sliderPos}%` }}
        onMouseDown={() => { dragging.current = true }}
      >
        <div className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-6 h-6 rounded-full bg-primary flex items-center justify-center">
          <span className="text-primary-foreground text-[10px]">{"\u21D4"}</span>
        </div>
      </div>
    </div>
  )
}
