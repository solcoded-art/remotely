import { ArrowRight } from "lucide-react"

import { Logo } from "@/components/logo"
import { MetalButton } from "@/components/ui/metal-button"

const links = [
  { label: "Docs", href: "/docs/getting-started/" },
  { label: "Login", href: "/login" },
]

/** Public site header (web only; the signed-in app uses AppShell). */
export function Header() {
  return (
    <header className="sticky top-0 z-50 w-full border-b border-border/50 bg-background/70 backdrop-blur-md">
      <div className="mx-auto flex min-h-16 max-w-6xl flex-wrap items-center justify-between gap-x-2 gap-y-1 px-4 py-2.5 sm:px-6">
        <a
          aria-label="Remotely home"
          className="shrink-0 rounded-md text-foreground"
          href="/"
        >
          <Logo className="h-7 w-auto" />
        </a>

        <nav aria-label="Main" className="ml-auto flex flex-wrap items-center justify-end gap-1 sm:gap-2">
          {links.map((link) => (
            <a
              className={`min-h-11 shrink-0 items-center rounded-md px-2 text-sm font-medium whitespace-nowrap text-muted-foreground transition-colors [overflow-wrap:normal] hover:text-foreground sm:px-3 ${
                // On phones the hero's "Read the docs" button covers Docs.
                link.label === "Docs" ? "hidden sm:inline-flex" : "inline-flex"
              }`}
              href={link.href}
              key={link.href}
            >
              {link.label}
            </a>
          ))}

          <MetalButton
            asChild
            className="h-11 gap-2 px-4 text-sm"
            metalFxClassName="ml-1"
            theme="dark"
            variant="outline"
          >
            <a href="/signup">
              Get started
              <ArrowRight aria-hidden="true" />
            </a>
          </MetalButton>
        </nav>
      </div>
    </header>
  )
}
