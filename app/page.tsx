import { createClient } from '@/lib/supabase/server'
import Nav from '@/components/landing/sections/Nav'
import Hero from '@/components/landing/sections/Hero'
import Motivation from '@/components/landing/sections/Motivation'
import Features from '@/components/landing/sections/Features'
import Examples from '@/components/landing/sections/Examples'
import Roadmap from '@/components/landing/sections/Roadmap'
import FinalCTA from '@/components/landing/sections/FinalCTA'
import Footer from '@/components/landing/sections/Footer'

export default async function Landing() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const isSignedIn = !!user

  return (
    <div className="w-full flex-1">
      <Nav isSignedIn={isSignedIn} />
      <Hero isSignedIn={isSignedIn} />
      <Motivation />
      <Features />
      <Examples />
      <Roadmap />
      <FinalCTA isSignedIn={isSignedIn} />
      <Footer />
    </div>
  )
}
