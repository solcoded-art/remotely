import { LogoMark } from "@/components/logo"
import { cn } from "@/lib/utils"

/**
 * A stylised macOS desktop mid-session. Every size is in container query
 * units (cqw), so the same markup renders crisply on the Pro Display XDR and
 * as the tiny mirrored preview on the phone.
 */
export function MacDesktop({
  className,
  showCursor = true,
}: {
  className?: string
  showCursor?: boolean
}) {
  return (
    <div
      className={cn(
        "absolute inset-0 overflow-hidden bg-brand-950 text-white select-none",
        className
      )}
      style={{ containerType: "inline-size" }}
    >
      {/* Wallpaper */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(70% 90% at 85% 110%, rgba(91,108,240,0.55), transparent 60%), radial-gradient(60% 70% at 0% 0%, rgba(127,140,255,0.28), transparent 60%), linear-gradient(180deg, #0a1024 0%, #070b18 100%)",
        }}
      />

      {/* Menu bar */}
      <div className="absolute inset-x-0 top-0 flex h-[3.2cqw] items-center justify-between bg-black/35 px-[1.6cqw] text-[1.35cqw] font-medium backdrop-blur-md">
        <div className="flex items-center gap-[1.8cqw]">
          <AppleGlyph className="h-[1.6cqw] w-auto" />
          <span className="font-semibold">Code</span>
          <span className="text-white/70">File</span>
          <span className="text-white/70">Edit</span>
          <span className="text-white/70">View</span>
        </div>
        <div className="flex items-center gap-[1.6cqw] text-white/85">
          <span className="flex items-center gap-[0.6cqw] rounded-[0.6cqw] bg-brand-500/30 px-[0.8cqw] py-[0.2cqw] text-brand-200">
            <LogoMark className="h-[1.4cqw] w-auto" />
            <span className="size-[0.7cqw] rounded-full bg-emerald-400" />
          </span>
          <span>Wed 9:41</span>
        </div>
      </div>

      {/* Editor window */}
      <div className="absolute top-[7cqw] left-[5cqw] flex h-[44cqw] w-[60cqw] flex-col overflow-hidden rounded-[1.2cqw] border border-white/10 bg-[#0c1122]/95 shadow-[0_2cqw_5cqw_rgba(0,0,0,0.5)]">
        <div className="flex h-[3.2cqw] items-center gap-[0.7cqw] border-b border-white/[0.06] px-[1.4cqw]">
          <span className="size-[1cqw] rounded-full bg-[#ff5f57]" />
          <span className="size-[1cqw] rounded-full bg-[#febc2e]" />
          <span className="size-[1cqw] rounded-full bg-[#28c840]" />
          <span className="ml-[2cqw] text-[1.2cqw] text-white/50">
            remotely — session.ts
          </span>
        </div>
        <div className="flex flex-1">
          <div className="flex w-[13cqw] flex-col gap-[1.1cqw] border-r border-white/[0.06] p-[1.4cqw]">
            {[70, 55, 82, 48, 64, 58].map((w, i) => (
              <span
                className={cn(
                  "h-[0.9cqw] rounded-full",
                  i === 2 ? "bg-brand-300/70" : "bg-white/12"
                )}
                key={i}
                style={{ width: `${w}%` }}
              />
            ))}
          </div>
          <div className="flex flex-1 flex-col gap-[1.15cqw] p-[1.8cqw]">
            {CODE_LINES.map((line, i) => (
              <div
                className="flex items-center gap-[0.8cqw]"
                key={i}
                style={{ paddingLeft: `${line.indent * 2.2}cqw` }}
              >
                {line.parts.map((part, j) => (
                  <span
                    className={cn("h-[0.9cqw] rounded-full", part.color)}
                    key={j}
                    style={{ width: `${part.w}cqw` }}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Remote session notification */}
      <div className="absolute top-[7cqw] right-[4cqw] w-[27cqw] rounded-[1.4cqw] border border-white/12 bg-white/[0.08] p-[1.6cqw] shadow-[0_1.5cqw_4cqw_rgba(0,0,0,0.45)] backdrop-blur-xl">
        <div className="flex items-center gap-[1.2cqw]">
          <div className="flex size-[4cqw] items-center justify-center rounded-[1cqw] bg-gradient-to-b from-brand-400 to-brand-500 text-white">
            <LogoMark className="h-[2.2cqw] w-auto" />
          </div>
          <div className="min-w-0">
            <p className="text-[1.45cqw] leading-tight font-semibold">
              iPhone connected
            </p>
            <p className="text-[1.2cqw] leading-tight text-white/60">
              You approved this session
            </p>
          </div>
        </div>
        <div className="mt-[1.4cqw] flex gap-[0.8cqw] text-[1.15cqw] font-medium">
          <span className="flex-1 rounded-[0.7cqw] bg-white/10 py-[0.6cqw] text-center">
            Pause
          </span>
          <span className="flex-1 rounded-[0.7cqw] bg-[#ff5f57]/85 py-[0.6cqw] text-center">
            End session
          </span>
        </div>
      </div>

      {/* Terminal */}
      <div className="absolute right-[4cqw] bottom-[9cqw] w-[27cqw] overflow-hidden rounded-[1.2cqw] border border-white/10 bg-black/60 p-[1.4cqw] font-mono text-[1.1cqw] leading-[1.7] text-white/70 backdrop-blur-md">
        <p>
          <span className="text-emerald-400">➜</span> npm run dev
        </p>
        <p className="text-white/45">ready on localhost:3000</p>
        <p>
          <span className="text-emerald-400">➜</span>{" "}
          <span className="inline-block h-[1.2cqw] w-[0.6cqw] translate-y-[0.2cqw] bg-white/70" />
        </p>
      </div>

      {/* Dock */}
      <div className="absolute bottom-[1.6cqw] left-1/2 flex -translate-x-1/2 items-end gap-[0.9cqw] rounded-[1.6cqw] border border-white/10 bg-white/10 px-[1.1cqw] py-[0.9cqw] backdrop-blur-md">
        {DOCK.map((bg, i) => (
          <span
            className="size-[3.6cqw] rounded-[0.9cqw] shadow-[inset_0_0.1cqw_0_rgba(255,255,255,0.3)]"
            key={i}
            style={{ background: bg }}
          />
        ))}
      </div>

      {/* Remote pointer, driven from the phone */}
      {showCursor ? (
        <div className="absolute top-[22cqw] left-[30cqw] motion-safe:animate-remote-cursor">
          <svg
            className="h-[2.6cqw] w-auto drop-shadow-[0_0.3cqw_0.6cqw_rgba(0,0,0,0.5)]"
            viewBox="0 0 16 22"
          >
            <path
              d="M1 1v17.5l4.6-4.3 3 6.8 3-1.3-3-6.6H15L1 1z"
              fill="#fff"
              stroke="#000"
              strokeLinejoin="round"
              strokeWidth="1.2"
            />
          </svg>
        </div>
      ) : null}
    </div>
  )
}

const CODE_LINES: { indent: number; parts: { w: number; color: string }[] }[] =
  [
    { indent: 0, parts: [{ w: 5, color: "bg-brand-300/80" }, { w: 9, color: "bg-white/40" }, { w: 6, color: "bg-amber-300/70" }] },
    { indent: 0, parts: [{ w: 5, color: "bg-brand-300/80" }, { w: 12, color: "bg-white/40" }] },
    { indent: 0, parts: [] },
    { indent: 0, parts: [{ w: 7, color: "bg-sky-300/70" }, { w: 10, color: "bg-white/50" }, { w: 3, color: "bg-white/25" }] },
    { indent: 1, parts: [{ w: 5, color: "bg-brand-300/80" }, { w: 8, color: "bg-white/40" }, { w: 11, color: "bg-emerald-300/70" }] },
    { indent: 1, parts: [{ w: 4, color: "bg-sky-300/70" }, { w: 14, color: "bg-white/35" }] },
    { indent: 2, parts: [{ w: 9, color: "bg-white/40" }, { w: 7, color: "bg-amber-300/70" }] },
    { indent: 2, parts: [{ w: 6, color: "bg-rose-300/70" }, { w: 10, color: "bg-white/35" }] },
    { indent: 1, parts: [{ w: 3, color: "bg-white/25" }] },
    { indent: 1, parts: [{ w: 6, color: "bg-brand-300/80" }, { w: 12, color: "bg-white/40" }] },
    { indent: 0, parts: [{ w: 2, color: "bg-white/25" }] },
  ]

const DOCK = [
  "linear-gradient(180deg,#7f8cff,#5b6cf0)",
  "linear-gradient(180deg,#3b82f6,#1d4ed8)",
  "linear-gradient(180deg,#1f2937,#0b0f19)",
  "linear-gradient(180deg,#fbbf24,#f59e0b)",
  "linear-gradient(180deg,#34d399,#059669)",
  "linear-gradient(180deg,#f472b6,#db2777)",
]

function AppleGlyph(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg fill="currentColor" viewBox="0 0 17 20" {...props}>
      <path d="M14.1 10.6c0-2.6 2.1-3.8 2.2-3.9-1.2-1.8-3.1-2-3.7-2-1.6-.2-3.1.9-3.9.9s-2.1-.9-3.4-.9C3.5 4.8 1.9 5.8 1 7.4c-1.9 3.2-.5 8 1.3 10.6.9 1.3 1.9 2.7 3.3 2.6 1.3-.1 1.8-.8 3.4-.8s2 .8 3.4.8 2.3-1.3 3.1-2.6c1-1.5 1.4-2.9 1.4-3-.1 0-2.8-1.1-2.8-4.4zM11.6 3c.7-.9 1.2-2 1-3.2-1 0-2.3.7-3 1.6-.7.8-1.2 2-1.1 3.1 1.2.1 2.3-.6 3.1-1.5z" />
    </svg>
  )
}
