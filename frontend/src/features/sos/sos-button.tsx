import { Siren } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/*
 * Phase 0 placeholders. They are visibly disabled and say so: an SOS control that looks live
 * but does nothing would be dangerous. Phase 1 replaces them with the real hold-to-trigger flow.
 */

export function SosHoldButton({ className }: { className?: string }) {
  return (
    <div className={cn('grid justify-items-center gap-3 text-center', className)}>
      <button
        type="button"
        disabled
        aria-describedby="sos-status"
        className="bg-sos text-sos-foreground font-display grid size-44 place-content-center rounded-full text-4xl font-extrabold tracking-wide opacity-45 shadow-lg ring-8 ring-[color-mix(in_oklch,var(--sos)_18%,transparent)] disabled:cursor-not-allowed"
      >
        SOS
        <span className="font-sans text-sm font-normal tracking-normal">Hold 2 seconds</span>
      </button>
      <p id="sos-status" className="text-muted-foreground max-w-xs text-sm">
        Silent SOS goes live in Phase 1. Until then, call <strong>112</strong> in an emergency.
      </p>
    </div>
  )
}

export function SosQuickButton() {
  return (
    <Button
      variant="sos"
      size="sm"
      disabled
      title="Silent SOS goes live in Phase 1. Call 112 in an emergency."
    >
      <Siren aria-hidden />
      SOS
    </Button>
  )
}
