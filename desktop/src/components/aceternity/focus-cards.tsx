import { useState } from "react"
import { cn } from "@/lib/utils"

export function FocusCards({ children, className }: { children: React.ReactNode; className?: string }) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)

  return (
    <div
      className={cn("flex flex-col gap-2", className)}
      onMouseLeave={() => setHoveredIndex(null)}
    >
      {Array.isArray(children)
        ? children.map((child, i) => (
            <div
              key={i}
              onMouseEnter={() => setHoveredIndex(i)}
              className={cn(
                "transition-all duration-200",
                hoveredIndex !== null && hoveredIndex !== i && "opacity-40 scale-[0.98]"
              )}
            >
              {child}
            </div>
          ))
        : children}
    </div>
  )
}
