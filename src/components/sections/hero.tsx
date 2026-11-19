import { memo } from "react"
import { Dithering } from "@paper-design/shaders-react"
import { ArrowRight, BookOpen, Check } from "lucide-react"
import { useReducedMotion } from "motion/react"

import { MacDesktop } from "@/components/hero/mac-desktop"
import { PhoneRemoteScreen } from "@/components/hero/phone-remote-screen"
import { RemoteGateway } from "@/components/hero/remote-gateway"
import { MacBookPro } from "@/components/ui/apple-macbook-pro"
import { IPhone17ProMax } from "@/components/ui/apple-iphone-17-pro"
import { Button } from "@/components/ui/button"
import { MetalButton } from "@/components/ui/metal-button"
import { cn } from "@/lib/utils"

const MemoDithering = memo(Dithering)

const highlights = [
  "Sign in with email, no password",
  "Every session approved on your Mac",
  "Stay signed in for 30 days",
]

export function Hero() {
  return (
    <section
      aria-labelledby="hero-title"
      className="relative isolate overflow-hidden"
    >
      <HeroBackdrop />

      <div className="mx-auto flex max-w-6xl flex-col items-center px-4 pt-12 text-center sm:px-6 sm:pt-16 lg:pt-16">
        {/* Eyebrow */}
        <p className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] py-1 pr-3 pl-2 text-sm text-muted-foreground">
          <span className="relative flex size-2">
            <span className="absolute inset-0 rounded-full bg-emerald-400/60 motion-safe:animate-ping" />
            <span className="relative size-2 rounded-full bg-emerald-400" />
          </span>
          Remote access for your Mac, from your iPhone
        </p>

        <h1
          className="mt-5 text-[2.1rem] leading-[0.95] font-semibold tracking-[-0.04em] text-balance sm:text-[2.625rem] lg:text-[3.15rem]"
          id="hero-title"
        >
          Your whole Mac.
          <br />
          <span className="bg-gradient-to-b from-brand-200 to-brand-400 bg-clip-text text-transparent">
            Right in your pocket.
          </span>
        </h1>

        <p className="mt-5 max-w-md text-sm text-pretty text-muted-foreground">
          Open your editor, apps and files from anywhere. Connect your iPhone,
          approve it once on your Mac, and pick up exactly where you left off.
        </p>

        {/* Inline at every width: an equal two-column grid on phones, natural widths from sm up */}
        <div className="mt-7 grid w-full max-w-sm grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3 sm:flex sm:w-auto sm:max-w-none sm:items-center sm:justify-center">
          <MetalButton
            asChild
            className="h-11 w-full gap-2 px-4 text-sm sm:min-w-44 sm:px-5"
            metalFxClassName="w-full sm:w-fit"
            theme="dark"
            variant="outline"
          >
            <a href="/signup">
              Get started
              <ArrowRight aria-hidden="true" />
            </a>
          </MetalButton>
          <Button
            asChild
            className="h-11 w-full gap-2 border-white/10 bg-white/[0.03] px-4 text-sm text-muted-foreground hover:text-foreground sm:w-auto sm:min-w-44 sm:px-5"
            variant="outline"
          >
            <a href="/docs/getting-started/">
              <BookOpen aria-hidden="true" />
              Read the docs
            </a>
          </Button>
        </div>

        <ul className="mt-5 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-sm text-muted-foreground">
          {highlights.map((item) => (
            <li className="flex items-center gap-1.5" key={item}>
              <Check className="size-3.5 text-brand-300" />
              {item}
            </li>
          ))}
        </ul>
      </div>

      <HeroVisual />
    </section>
  )
}

/** Dithered texture across the top of the hero, fading out before the devices. */
export function HeroBackdrop({ className }: { className?: string } = {}) {
  const reduceMotion = useReducedMotion()

  return (
    <div
      aria-hidden
      className={cn(
        "pointer-events-none absolute inset-x-0 top-0 -z-10 h-[560px] opacity-55 sm:h-[620px]",
        className
      )}
      style={{
        maskImage:
          "radial-gradient(75% 100% at 50% 0%, black 25%, transparent 78%)",
      }}
    >
      <MemoDithering
        colorBack="#00000000"
        colorFront="#5b6cf0"
        scale={0.7}
        shape="warp"
        size={2}
        speed={reduceMotion ? 0 : 0.35}
        style={{ height: "100%", width: "100%" }}
        type="4x4"
      />
    </div>
  )
}

function HeroVisual() {
  return (
    <div className="relative mt-10 sm:mt-12">
      {/* Device stage: decorative, so hidden from assistive tech and focus */}
      <div
        aria-hidden
        className="mx-auto max-w-6xl px-4 pb-16 sm:px-6 sm:pb-24"
        inert
      >
        {/* Desktop: phone → gateway → MacBook. The devices sit above the
            gateway so its lanes tuck in under their frames. */}
        <div className="hidden grid-cols-[auto_minmax(0,1.2fr)_minmax(0,2fr)] items-center gap-0 lg:grid">
          <div className="relative z-10 [zoom:0.66] xl:[zoom:0.72]">
            <IPhone17ProMax appearance="dark" className="p-0" showHomeIndicator>
              <PhoneRemoteScreen />
            </IPhone17ProMax>
          </div>
          <RemoteGateway className="relative z-0" />
          <MacBookPro className="relative z-10">
            <MacDesktop />
          </MacBookPro>
        </div>

        {/* Mobile & tablet: MacBook with the phone tucked in front */}
        <div className="relative lg:hidden">
          <div className="pr-[16%] pb-[6%] sm:pr-[20%]">
            <MacBookPro>
              <MacDesktop showCursor={false} />
            </MacBookPro>
          </div>
          <div className="absolute right-0 bottom-0 [zoom:0.28] sm:[zoom:0.45]">
            <IPhone17ProMax appearance="dark" className="p-0">
              <PhoneRemoteScreen />
            </IPhone17ProMax>
          </div>
        </div>
      </div>

      {/* Fade into the next section */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-32 bg-gradient-to-b from-transparent to-background"
      />
    </div>
  )
}
