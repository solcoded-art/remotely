import * as React from "react"
import { HaloInput } from "@/components/ui/halo-input"
import { cn } from "@/lib/utils"

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(function Input({ className, ...props }, ref) {
  return <HaloInput ref={ref} translucent={false} shellClassName="remotely-input" className={cn("remotely-input-control", className)} {...props} />
})
export { Input }
