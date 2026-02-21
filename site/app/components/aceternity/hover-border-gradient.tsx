import { cn } from "@/lib/utils"

export function HoverBorderGradient({
  children,
  containerClassName,
  className,
  as: Tag = "button",
  ...props
}: {
  children: React.ReactNode
  containerClassName?: string
  className?: string
  as?: React.ElementType
  duration?: number
  clockwise?: boolean
  [key: string]: unknown
}) {
  return (
    <Tag
      className={cn(
        "group relative flex rounded-full content-center bg-bg-card hover:bg-bg-secondary transition duration-500 items-center flex-col flex-nowrap gap-10 h-min justify-center overflow-visible p-px decoration-clone w-fit",
        containerClassName
      )}
      {...props}
    >
      <div className={cn("w-auto z-10 rounded-[inherit] px-6 py-2.5", className)}>{children}</div>
      <div
        className="absolute inset-0 z-0 rounded-[inherit] overflow-hidden"
        style={{ filter: "blur(2px)" }}
      >
        <div className="absolute inset-[-200%] gradient-border-bg" />
      </div>
      <div className="bg-bg-card absolute z-1 flex-none inset-[2px] rounded-[inherit]" />
    </Tag>
  )
}
