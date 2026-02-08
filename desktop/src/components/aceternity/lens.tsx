import { useRef, useState } from "react"
import { cn } from "@/lib/utils"

export function Lens({ children, className, zoomFactor = 2 }: { children: React.ReactNode; className?: string; zoomFactor?: number }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [lens, setLens] = useState({ x: 0, y: 0, show: false })

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!containerRef.current) return
    const rect = containerRef.current.getBoundingClientRect()
    setLens({ x: e.clientX - rect.left, y: e.clientY - rect.top, show: true })
  }

  return (
    <div
      ref={containerRef}
      className={cn("relative overflow-hidden", className)}
      onMouseMove={handleMouseMove}
      onMouseLeave={() => setLens(l => ({ ...l, show: false }))}
    >
      {children}
      {lens.show && (
        <div
          className="pointer-events-none absolute w-32 h-32 rounded-full border-2 border-primary/30 overflow-hidden z-10"
          style={{
            left: lens.x - 64,
            top: lens.y - 64,
            boxShadow: "0 0 20px oklch(0 0 0 / 0.5)",
          }}
        >
          <div
            style={{
              transform: `scale(${zoomFactor})`,
              transformOrigin: `${lens.x}px ${lens.y}px`,
              width: containerRef.current?.offsetWidth,
              height: containerRef.current?.offsetHeight,
              position: "absolute",
              left: -(lens.x - 64),
              top: -(lens.y - 64),
            }}
          >
            {children}
          </div>
        </div>
      )}
    </div>
  )
}
