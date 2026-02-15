import { Navbar } from "./components/sections/Navbar"
import { Hero } from "./components/sections/Hero"
import { Install } from "./components/sections/Install"
import { Features } from "./components/sections/Features"
import { Providers } from "./components/sections/Providers"
import { HowItWorks } from "./components/sections/HowItWorks"
import { Architecture } from "./components/sections/Architecture"
import { Security } from "./components/sections/Security"
import { CTA } from "./components/sections/CTA"
import { Footer } from "./components/sections/Footer"

export default function Home() {
  return (
    <div className="min-h-screen bg-bg">
      <Navbar />
      <Hero />
      <Install />
      <Features />
      <Providers />
      <HowItWorks />
      <Architecture />
      <Security />
      <CTA />
      <Footer />
    </div>
  )
}
