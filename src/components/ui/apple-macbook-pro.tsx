import type { ReactNode } from "react"

import { cn } from "@/lib/utils"

/**
 * MacBook Pro (14", front view), drawn in CSS so it scales with its container.
 * Every dimension is in container query units (cqw) of the full device width,
 * so set the width from outside (`className="w-full max-w-…"`).
 */

const FINISHES = {
  silver: {
    lidEdge: "linear-gradient(180deg, #e3e4e6 0%, #b9babd 100%)",
    hinge: "linear-gradient(180deg, #1a1a1c 0%, #3a3a3d 100%)",
    base: "linear-gradient(180deg, #f1f1f3 0%, #d4d5d8 22%, #a9aaae 100%)",
    baseHighlight: "rgba(255,255,255,0.85)",
    scoop: "linear-gradient(180deg, #9d9ea2 0%, #c4c5c8 100%)",
  },
  "space-black": {
    lidEdge: "linear-gradient(180deg, #4a4b4f 0%, #2a2b2e 100%)",
    hinge: "linear-gradient(180deg, #0c0c0d 0%, #232326 100%)",
    base: "linear-gradient(180deg, #55565a 0%, #36373a 25%, #1d1e20 100%)",
    baseHighlight: "rgba(255,255,255,0.35)",
    scoop: "linear-gradient(180deg, #18181a 0%, #303134 100%)",
  },
} as const

export interface MacBookProProps {
  /** What's on the display. Fills the 16:10.4 screen area. */
  children?: ReactNode
  finish?: keyof typeof FINISHES
  className?: string
}

export function MacBookPro({
  children,
  finish = "silver",
  className,
}: MacBookProProps) {
  const f = FINISHES[finish]

  return (
    <figure
      aria-label="MacBook Pro"
      className={cn("relative m-0 w-full", className)}
      style={{ containerType: "inline-size" }}
    >
      {/* Lid */}
      <div
        className="relative mx-auto w-[94%] rounded-t-[2.4cqw] p-[0.32cqw] pb-0"
        style={{ background: f.lidEdge }}
      >
        <div className="relative rounded-t-[2.1cqw] bg-black px-[1.5cqw] pt-[1.5cqw] pb-[1.9cqw]">
          {/* Screen */}
          <div className="relative aspect-[16/10.4] overflow-hidden rounded-[0.5cqw] bg-black">
            {children}
            {/* Glass sheen */}
            <div
              className="pointer-events-none absolute inset-0"
              style={{
                background:
                  "linear-gradient(115deg, rgba(255,255,255,0.07) 0%, rgba(255,255,255,0) 38%)",
              }}
            />
          </div>

          {/* Notch with camera */}
          <div className="absolute top-[1.4cqw] left-1/2 flex h-[2.15cqw] w-[11cqw] -translate-x-1/2 items-center justify-center rounded-b-[0.9cqw] bg-black">
            <span className="size-[0.62cqw] rounded-full bg-[#14161c] ring-[0.12cqw] ring-[#23262f]" />
          </div>
        </div>
      </div>

      {/* Hinge */}
      <div
        className="relative mx-auto h-[0.75cqw] w-[94%]"
        style={{ background: f.hinge }}
      />

      {/* Base */}
      <div
        className="relative h-[2.3cqw] w-full rounded-b-[2cqw] rounded-t-[0.3cqw]"
        style={{
          background: f.base,
          boxShadow: `inset 0 0.12cqw 0 ${f.baseHighlight}`,
        }}
      >
        {/* Finger scoop */}
        <div
          className="absolute top-0 left-1/2 h-[0.75cqw] w-[13cqw] -translate-x-1/2 rounded-b-[1cqw]"
          style={{ background: f.scoop }}
        />
      </div>

      {/* Contact shadow */}
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-[1.6cqw] left-1/2 -z-10 h-[3cqw] w-[92%] -translate-x-1/2 rounded-[50%] bg-black/70 blur-[1.4cqw]"
      />
    </figure>
  )
}

export default MacBookPro
