import { Navbar } from "./components/sections/Navbar"
import { Hero } from "./components/sections/Hero"
import { Features } from "./components/sections/Features"
import { Also } from "./components/sections/Also"
import { CTA } from "./components/sections/CTA"
import { Footer } from "./components/sections/Footer"

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
