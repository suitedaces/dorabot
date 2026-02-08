import { cn } from "@/lib/utils"

type TimelineItem = {
  title: string
  description?: string
  badge?: React.ReactNode
  content?: React.ReactNode
}

export function Timeline({ items, className }: { items: TimelineItem[]; className?: string }) {
  return (
    <div className={cn("relative space-y-4 pl-6", className)}>
      <div className="absolute left-2 top-2 bottom-2 w-px bg-border" />
      {items.map((item, i) => (
        <div key={i} className="relative">
          <div className="absolute -left-6 top-1 w-3 h-3 rounded-full bg-secondary border-2 border-primary" />
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-semibold">{item.title}</span>
            {item.badge}
          </div>
          {item.description && <p className="text-xs text-muted-foreground">{item.description}</p>}
          {item.content}
        </div>
      ))}
    </div>
  )
}
