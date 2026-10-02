import { BellRing, FileLock2, MapPinned } from 'lucide-react'
import { Link } from 'react-router'

import { Button } from '@/components/ui/button'

const points = [
  {
    icon: BellRing,
    title: 'Help in seconds',
    text: 'One press alerts your trusted people and the nearest station, with your live location.',
  },
  {
    icon: MapPinned,
    title: 'Nobody can ignore it',
    text: 'If no one responds in time, the alert climbs to a supervisor, then the district.',
  },
  {
    icon: FileLock2,
    title: 'Evidence that holds',
    text: 'Recordings and files are fingerprinted and logged, so any later change shows.',
  },
]

export function Component() {
  return (
    <div className="grid gap-12">
      <section className="grid max-w-2xl gap-5">
        <h1 className="text-4xl font-extrabold tracking-tight sm:text-5xl">
          Get help fast. Keep every response on the record.
        </h1>
        <p className="text-muted-foreground text-lg">
          A safety app for women, and a console for the people who respond. Every alert, action and
          piece of evidence is time-stamped and recorded.
        </p>
        <div className="flex flex-wrap gap-3">
          <Button asChild size="touch">
            <Link to="/signup">Create an account</Link>
          </Button>
          <Button asChild size="touch" variant="outline">
            <Link to="/login">Sign in</Link>
          </Button>
        </div>
        <p className="text-muted-foreground text-sm">
          Police and security staff: your administrator creates your account.
        </p>
      </section>

      <section className="grid gap-6 sm:grid-cols-3">
        {points.map(({ icon: Icon, title, text }) => (
          <div key={title} className="grid content-start gap-2">
            <Icon className="text-primary size-6" aria-hidden />
            <h2 className="text-lg font-bold">{title}</h2>
            <p className="text-muted-foreground">{text}</p>
          </div>
        ))}
      </section>
    </div>
  )
}
