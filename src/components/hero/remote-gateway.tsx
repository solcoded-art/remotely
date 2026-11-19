import { useId } from "react"
import { Lock } from "lucide-react"

import { LogoMark } from "@/components/logo"
import { cn } from "@/lib/utils"

/**
 * Phone ↔ Mac connector, adapted from cult-ui's Gateway SVG illustration:
 * curved lanes merging into a hub, faded grid and gradient tail, rebuilt at
 * hero scale. The lanes run past both edges so they plug straight into the
 * device mockups on either side (which are layered above this SVG). Input flows phone → Mac, the screen streams
 * Mac → phone, and both pass through the session the Mac approved.
 */

// Lanes enter the hub (r=30 at 160,130) at its top and bottom edges.
const INPUT_LANE =
  "M-24 118 H92 C122 118 128 100 160 100 C192 100 198 118 228 118 H344"
const SCREEN_LANE =
  "M344 142 H228 C198 142 192 160 160 160 C128 160 122 142 92 142 H-24"

export function RemoteGateway({ className }: { className?: string }) {
  const id = useId().replace(/:/g, "")
  const ids = {
    grid: `${id}-grid`,
    gridMask: `${id}-grid-mask`,
    gridFade: `${id}-grid-fade`,
    tail: `${id}-tail`,
    ring: `${id}-ring`,
    hubFill: `${id}-hub-fill`,
  }

  return (
    <svg
      aria-hidden
      className={cn("h-auto w-full overflow-visible", className)}
      fill="none"
      viewBox="0 56 320 190"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <pattern height="20" id={ids.grid} patternUnits="userSpaceOnUse" width="20" x="0" y="10">
          <path d="M20 0H0V20" stroke="rgba(255,255,255,0.07)" strokeWidth="0.75" />
        </pattern>
        <radialGradient cx="50%" cy="50%" id={ids.gridFade} r="50%">
          <stop offset="0" stopColor="#fff" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
        <mask id={ids.gridMask}>
          <rect fill={`url(#${ids.gridFade})`} height="260" width="320" />
        </mask>
        <linearGradient gradientUnits="userSpaceOnUse" id={ids.tail} x1="160" x2="160" y1="162" y2="216">
          <stop stopColor="#a5b1ff" stopOpacity="0.7" />
          <stop offset="1" stopColor="#a5b1ff" stopOpacity="0" />
        </linearGradient>
        <linearGradient id={ids.ring} x1="0" x2="1" y1="0" y2="1">
          <stop stopColor="#c7d0ff" />
          <stop offset="0.5" stopColor="#5b6cf0" stopOpacity="0.5" />
          <stop offset="1" stopColor="#c7d0ff" stopOpacity="0.8" />
        </linearGradient>
        <radialGradient cx="50%" cy="35%" id={ids.hubFill} r="65%">
          <stop stopColor="#1a2250" />
          <stop offset="1" stopColor="#0a0e1f" />
        </radialGradient>
      </defs>

      {/* Background grid */}
      <rect fill={`url(#${ids.grid})`} height="260" mask={`url(#${ids.gridMask})`} width="320" />

      {/* Lanes */}
      <path d={INPUT_LANE} stroke="#fbbf24" strokeOpacity="0.35" strokeWidth="1.25" />
      <path d={SCREEN_LANE} stroke="#7f8cff" strokeOpacity="0.45" strokeWidth="1.25" />

      {/* Travelling pulses */}
      <path
        className="motion-safe:animate-gateway-flow drop-shadow-[0_0_4px_#fbbf24]"
        d={INPUT_LANE}
        pathLength={100}
        stroke="#fcd34d"
        strokeDasharray="9 91"
        strokeLinecap="round"
        strokeWidth="2"
      />
      <path
        className="motion-safe:animate-gateway-flow drop-shadow-[0_0_4px_#7f8cff] [animation-delay:-1.3s]"
        d={SCREEN_LANE}
        pathLength={100}
        stroke="#c7d0ff"
        strokeDasharray="14 86"
        strokeLinecap="round"
        strokeWidth="2"
      />

      {/* Lane labels */}
      <text className="fill-amber-200/70 font-mono" fontSize="8.5" letterSpacing="1.2" textAnchor="middle" x="74" y="110">
        INPUT
      </text>
      <text className="fill-brand-200/70 font-mono" fontSize="8.5" letterSpacing="1.2" textAnchor="middle" x="246" y="158">
        SCREEN
      </text>

      {/* Approval tail */}
      <path d="M160 162V214" stroke={`url(#${ids.tail})`} />
      <text className="fill-white/45 font-mono" fontSize="8" letterSpacing="1.4" textAnchor="middle" x="160" y="232">
        APPROVED ON YOUR MAC
      </text>


      {/* Hub */}
      <circle cx="160" cy="130" fill="#5b6cf0" fillOpacity="0.14" r="44" />
      <circle cx="160" cy="130" fill={`url(#${ids.hubFill})`} r="30" stroke={`url(#${ids.ring})`} strokeWidth="1.25" />
      <LogoMark color="#e8ebff" height={26} width={24} x={148} y={117} />

      {/* Lock badge */}
      <circle cx="182" cy="152" fill="#052e1f" r="9" stroke="#34d399" strokeOpacity="0.55" />
      <Lock color="#6ee7b7" height={10} strokeWidth={2.2} width={10} x={177} y={147} />
    </svg>
  )
}
