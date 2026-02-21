import dynamic from "next/dynamic"
import { Navbar } from "./components/sections/Navbar"
import { Hero } from "./components/sections/Hero"

const Features = dynamic(() => import("./components/sections/Features").then(m => m.Features))
const Also = dynamic(() => import("./components/sections/Also").then(m => m.Also))
const CTA = dynamic(() => import("./components/sections/CTA").then(m => m.CTA))
const Footer = dynamic(() => import("./components/sections/Footer").then(m => m.Footer))

export default function Home() {
  return (
    <div className="min-h-screen bg-bg">
      <Navbar />
      <Hero />
      <Features />
      <Also />
      <CTA />
      <Footer />
    </div>
  )
}
