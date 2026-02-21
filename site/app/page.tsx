import { Navbar } from "./components/sections/Navbar"
import { Hero } from "./components/sections/Hero"
import { BelowFold } from "./components/below-fold"

export default function Home() {
  return (
    <div className="min-h-screen bg-bg">
      <Navbar />
      <Hero />
      <BelowFold />
    </div>
  )
}
