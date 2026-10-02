import { useQuery } from '@tanstack/react-query'
import { ShieldCheck } from 'lucide-react'
import { useState, type FormEvent } from 'react'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

import { fetchPinStatus, resolveIncident, sosKeys, type ResolveResult } from './api'

const MESSAGES = {
  wrong_pin: "That PIN isn't right. Try again.",
  locked: 'Too many wrong PINs. Try again in 10 minutes. Your SOS stays active.',
} as const

/**
 * "I'm safe". Asks for the SOS PIN when one is set. The duress PIN is accepted here too and looks
 * exactly the same on screen: the SOS quietly stays active for everyone else.
 */
export function ResolveDialog({
  incidentId,
  onResolved,
}: {
  incidentId: string
  onResolved: (result: ResolveResult) => void
}) {
  const [open, setOpen] = useState(false)
  const [pin, setPin] = useState('')
  const [resolution, setResolution] = useState<'safe' | 'false_alarm'>('safe')
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const pins = useQuery({ queryKey: sosKeys.pins, queryFn: fetchPinStatus })
  const needsPin = pins.data?.has_pin ?? true

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setMessage(null)
    try {
      const result = await resolveIncident(incidentId, needsPin ? pin : null, resolution)
      if (result.status === 'resolved') {
        setOpen(false)
        onResolved(result)
      } else {
        setMessage(MESSAGES[result.status])
        setPin('')
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        setPin('')
        setMessage(null)
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="touch" className="w-full">
          <ShieldCheck aria-hidden />
          I'm safe
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>End your SOS?</DialogTitle>
            <DialogDescription>
              {needsPin
                ? 'Enter your SOS PIN to tell your circle you are safe.'
                : 'Your circle will see that you are safe. Set a PIN in Settings so nobody else can do this.'}
            </DialogDescription>
          </DialogHeader>

          {needsPin ? (
            <div className="grid gap-2">
              <Label htmlFor="sos-pin">SOS PIN</Label>
              <Input
                id="sos-pin"
                type="password"
                inputMode="numeric"
                autoComplete="off"
                pattern="[0-9]*"
                maxLength={6}
                value={pin}
                onChange={(event) => setPin(event.target.value.replace(/\D/g, ''))}
                className="h-12 text-center font-mono text-2xl tracking-[0.5em]"
                autoFocus
              />
            </div>
          ) : null}

          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-medium">What happened?</legend>
            {(
              [
                ['safe', "I'm safe now"],
                ['false_alarm', 'It was a false alarm'],
              ] as const
            ).map(([value, label]) => (
              <label key={value} className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="resolution"
                  value={value}
                  checked={resolution === value}
                  onChange={() => setResolution(value)}
                  className="accent-primary size-4"
                />
                {label}
              </label>
            ))}
          </fieldset>

          {message ? (
            <Alert variant="destructive">
              <AlertDescription>{message}</AlertDescription>
            </Alert>
          ) : null}

          <DialogFooter>
            <Button type="submit" size="touch" disabled={busy || (needsPin && pin.length < 4)}>
              {busy ? 'Checking…' : 'End SOS'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
