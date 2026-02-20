import { cn } from "@/lib/utils"

export function AuroraBackground({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("relative flex flex-col items-center justify-center overflow-hidden", className)}>
      <div className="absolute inset-0 overflow-hidden">
        <div
          className="absolute -inset-[10px] opacity-50"
          style={{
            backgroundImage: `radial-gradient(at 27% 37%, oklch(0.625 0.20 250 / 0.2) 0px, transparent 50%),
              radial-gradient(at 97% 21%, oklch(0.6 0.22 145 / 0.15) 0px, transparent 50%),
              radial-gradient(at 52% 99%, oklch(0.6 0.18 310 / 0.15) 0px, transparent 50%)`,
            filter: "blur(60px)",
          }}
        />
      </div>
      <div className="relative z-10">{children}</div>
    </div>
  )
}
