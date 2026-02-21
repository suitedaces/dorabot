"use client"

import { useRef, useState, useEffect, type ReactNode } from "react"
import dynamic from "next/dynamic"

const DemoVideo = dynamic(() => import("./demo-video").then(m => m.DemoVideo), { ssr: false })
const Features = dynamic(() => import("./sections/Features").then(m => m.Features), { ssr: false })
const Also = dynamic(() => import("./sections/Also").then(m => m.Also), { ssr: false })
const CTA = dynamic(() => import("./sections/CTA").then(m => m.CTA), { ssr: false })
const Footer = dynamic(() => import("./sections/Footer").then(m => m.Footer), { ssr: false })

function LazySection({ children, minH = "20rem" }: { children: ReactNode; minH?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true)
          observer.disconnect()
        }
      },
      { rootMargin: "300px" }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  if (visible) return <>{children}</>
  return <div ref={ref} style={{ minHeight: minH }} />
}

export function BelowFold() {
  return (
    <>
      <DemoVideo />
      <LazySection minH="60rem"><Features /></LazySection>
      <LazySection><Also /></LazySection>
      <LazySection><CTA /></LazySection>
      <Footer />
    </>
  )
}
