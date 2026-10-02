import { ShieldCheck } from 'lucide-react'
import { Link } from 'react-router'

import { cn } from '@/lib/utils'

export function Brand({ to = '/', className }: { to?: string; className?: string }) {
  return (
    <Link
      to={to}
      className={cn(
        'font-display inline-flex shrink-0 items-center gap-2 font-bold tracking-tight whitespace-nowrap',
        className,
      )}
    >
      <ShieldCheck className="text-primary size-5" aria-hidden />
      <span>Women&apos;s Safety</span>
    </Link>
  )
}
