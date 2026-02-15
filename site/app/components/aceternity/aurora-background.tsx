"use client"

import { cn } from "@/lib/utils"

export function AuroraBackground({ children, className }: { children?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("relative flex flex-col items-center justify-center overflow-hidden", className)}>
      <div className="absolute inset-0 overflow-hidden">
        <div
          className="absolute -inset-[10px] opacity-30"
          style={{
            backgroundImage: `radial-gradient(at 27% 37%, oklch(0.625 0.18 250 / 0.15) 0px, transparent 50%),
              radial-gradient(at 97% 21%, oklch(0.6 0.19 145 / 0.1) 0px, transparent 50%),
              radial-gradient(at 52% 99%, oklch(0.6 0.15 310 / 0.1) 0px, transparent 50%)`,
            filter: "blur(60px)",
            animation: "aurora 8s ease-in-out infinite alternate",
          }}
        />
      </div>
      <div className="relative z-10 w-full">{children}</div>
      <style>{`
        @keyframes aurora {
          0% { transform: translate(0, 0) rotate(0deg) scale(1); }
          50% { transform: translate(10px, -10px) rotate(1deg) scale(1.02); }
          100% { transform: translate(-5px, 5px) rotate(-1deg) scale(0.98); }
        }
      `}</style>
    </div>
  )
}
