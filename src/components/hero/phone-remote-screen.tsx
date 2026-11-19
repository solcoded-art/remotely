import { ChevronLeft, Clipboard, Keyboard, MousePointer2, X } from "lucide-react"

import { MacDesktop } from "@/components/hero/mac-desktop"
import { cn } from "@/lib/utils"

/**
 * The Remotely iPhone app mid-session: a live mirror of the Mac, a trackpad
 * surface and quick controls. Sized for the iPhone mockup's native 700px
 * height; the hero scales the whole device with CSS zoom.
 */
export function PhoneRemoteScreen() {
  return (
    <div className="relative flex h-full flex-col gap-4 bg-[radial-gradient(120%_60%_at_50%_0%,#121a3a_0%,#05070f_70%)] px-4 pt-2 pb-9 text-white">
      {/* Session header */}
      <div className="flex items-center gap-3">
        <span className="flex size-8 items-center justify-center rounded-full bg-white/10">
          <ChevronLeft className="size-4" />
        </span>
        <div className="min-w-0">
          <p className="text-[15px] leading-tight font-semibold">MacBook Pro</p>
          <p className="flex items-center gap-1.5 text-[12px] leading-tight text-white/60">
            <span className="size-1.5 rounded-full bg-emerald-400" />
            Connected · approved on Mac
          </p>
        </div>
      </div>

      {/* Live mirror */}
      <div className="relative aspect-video w-full overflow-hidden rounded-2xl border border-white/12 shadow-[0_12px_30px_rgba(0,0,0,0.45)]">
        <MacDesktop />
        <span className="absolute top-2 left-2 rounded-full bg-black/55 px-2 py-0.5 text-[10px] font-medium text-white/85 backdrop-blur">
          Live
        </span>
      </div>

      {/* Trackpad */}
      <div className="relative flex-1 overflow-hidden rounded-3xl border border-white/10 bg-white/[0.035]">
        <div
          className="absolute inset-0 opacity-60"
          style={{
            backgroundImage:
              "radial-gradient(rgba(255,255,255,0.12) 1px, transparent 1px)",
            backgroundSize: "16px 16px",
            maskImage:
              "radial-gradient(70% 70% at 50% 50%, black, transparent)",
          }}
        />
        <div className="absolute top-[44%] left-[58%] -translate-x-1/2 -translate-y-1/2">
          <span className="absolute -inset-6 rounded-full border border-brand-300/50 motion-safe:animate-touch-ripple" />
          <span className="block size-9 rounded-full bg-brand-300/25 ring-1 ring-brand-200/60 backdrop-blur" />
        </div>
        <p className="absolute inset-x-0 bottom-3 text-center text-[11px] text-white/40">
          Drag to move · tap to click
        </p>
      </div>

      {/* Controls */}
      <div className="grid grid-cols-4 gap-2">
        <Control icon={Keyboard} label="Keys" />
        <Control active icon={MousePointer2} label="Pointer" />
        <Control icon={Clipboard} label="Paste" />
        <Control danger icon={X} label="End" />
      </div>
    </div>
  )
}

function Control({
  icon: Icon,
  label,
  active,
  danger,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  active?: boolean
  danger?: boolean
}) {
  return (
    <div className="flex flex-col items-center gap-1.5">
      <span
        className={cn(
          "flex h-11 w-full items-center justify-center rounded-2xl border",
          active
            ? "border-brand-300/40 bg-brand-500/30 text-brand-200"
            : danger
              ? "border-[#ff5f57]/30 bg-[#ff5f57]/15 text-[#ff8a84]"
              : "border-white/10 bg-white/[0.06] text-white/85"
        )}
      >
        <Icon className="size-[18px]" />
      </span>
      <span className="text-[10px] text-white/55">{label}</span>
    </div>
  )
}
