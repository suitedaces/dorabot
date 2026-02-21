"use client"

import dynamic from "next/dynamic"

const Features = dynamic(() => import("./sections/Features").then(m => m.Features), { ssr: false })
const Also = dynamic(() => import("./sections/Also").then(m => m.Also), { ssr: false })
const CTA = dynamic(() => import("./sections/CTA").then(m => m.CTA), { ssr: false })
const Footer = dynamic(() => import("./sections/Footer").then(m => m.Footer), { ssr: false })

export function BelowFold() {
  return (
    <>
      <Features />
      <Also />
      <CTA />
      <Footer />
    </>
  )
}
