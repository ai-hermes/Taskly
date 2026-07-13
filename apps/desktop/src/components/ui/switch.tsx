import * as React from "react"
import { Switch as SwitchPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

function Switch({
  className,
  size = "default",
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root> & {
  size?: "sm" | "default"
}) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      data-size={size}
      className={cn(
        "peer group/switch relative inline-flex shrink-0 items-center rounded-full border border-transparent p-[2px] transition-[background-color,border-color,box-shadow] duration-150 outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/20 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 data-[size=default]:h-6 data-[size=default]:w-11 data-[size=sm]:h-5 data-[size=sm]:w-9 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 data-disabled:cursor-not-allowed data-disabled:opacity-50",
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="pointer-events-none block rounded-full bg-white shadow-[0_1px_2px_rgba(17,17,17,0.14),0_0_0_1px_rgba(17,17,17,0.05)] ring-0 transition-[transform,background-color,box-shadow] duration-150 group-data-[size=default]/switch:size-5 group-data-[size=sm]/switch:size-4 group-data-[state=checked]/switch:group-data-[size=default]/switch:translate-x-5 group-data-[state=checked]/switch:group-data-[size=sm]/switch:translate-x-4 group-data-[state=unchecked]/switch:translate-x-0 dark:bg-white"
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
