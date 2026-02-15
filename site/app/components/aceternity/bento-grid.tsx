import { cn } from "@/lib/utils"

export function BentoGrid({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-3", className)}>
      {children}
    </div>
  )
}

export function BentoGridItem({
  children,
  className,
  colSpan,
}: {
  children: React.ReactNode
  className?: string
  colSpan?: number
}) {
  return (
    <div
      className={cn(
        "rounded-xl border border-border bg-bg-card p-6 transition-colors hover:border-border-hover",
        colSpan === 2 && "md:col-span-2",
        className
      )}
    >
      {children}
    </div>
  )
}
