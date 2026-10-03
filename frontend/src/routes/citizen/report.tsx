import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CircleCheck, EyeOff, LoaderCircle, MapPin, Mic, MicOff, PhoneCall } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router'

import { PageHeader } from '@/components/page-header'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  complaintKeys,
  createComplaint,
  triagePreview,
  type Filed,
} from '@/features/complaints/api'
import { SEVERITY, signalLabel } from '@/features/complaints/labels'
import { useDictation } from '@/features/complaints/use-dictation'
import { currentFix, type Fix } from '@/features/sos/geo'
import { paths } from '@/lib/paths'
import { cn } from '@/lib/utils'

const LANGUAGES = [
  { code: 'en-IN', label: 'English' },
  { code: 'hi-IN', label: 'हिन्दी / Hinglish' },
] as const

type When = 'now' | 'earlier'

/** The value a datetime-local input needs for "now", in local time. */
function localNow() {
  const d = new Date()
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset())
  return d.toISOString().slice(0, 16)
}

/** The rules' answer for the text so far, a moment after typing stops. */
function usePreview(text: string) {
  const [debounced, setDebounced] = useState('')
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(text.trim()), 400)
    return () => clearTimeout(timer)
  }, [text])
  return useQuery({
    queryKey: complaintKeys.preview(debounced),
    queryFn: () => triagePreview(debounced),
    enabled: debounced.length >= 8,
    staleTime: Infinity,
  })
}

export function Component() {
  const queryClient = useQueryClient()
  const clientId = useRef(crypto.randomUUID())
  const [text, setText] = useState('')
  const [spoken, setSpoken] = useState(false)
  const [lang, setLang] = useState<(typeof LANGUAGES)[number]['code']>('en-IN')
  const [when, setWhen] = useState<When>('now')
  const [occurredAt, setOccurredAt] = useState(localNow)
  const [useLocation, setUseLocation] = useState(true)
  const [fix, setFix] = useState<Fix | null>(null)
  // Asked for once on open; the effect below fills it in.
  const [locating, setLocating] = useState(true)
  const [confidential, setConfidential] = useState(false)
  const [filed, setFiled] = useState<Filed | null>(null)

  const dictation = useDictation((phrase) => {
    setSpoken(true)
    setText((current) => (current ? `${current.trimEnd()} ${phrase}` : phrase))
  })
  const preview = usePreview(text)

  useEffect(() => {
    if (!useLocation || fix) return
    let cancelled = false
    void currentFix(8000).then((result) => {
      if (cancelled) return
      setFix(result)
      setLocating(false)
    })
    return () => {
      cancelled = true
    }
  }, [useLocation, fix])

  const submit = useMutation({
    mutationFn: () =>
      createComplaint({
        clientId: clientId.current,
        description: text.trim(),
        inputMode: spoken ? 'voice' : 'text',
        occurredAt: when === 'now' ? null : new Date(occurredAt).toISOString(),
        location:
          useLocation && fix ? { lat: fix.lat, lng: fix.lng, accuracy: fix.accuracy } : null,
        confidential,
      }),
    onSuccess: (result) => {
      setFiled(result)
      void queryClient.invalidateQueries({ queryKey: complaintKeys.mine })
    },
  })

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    dictation.stop()
    if (text.trim().length >= 3) submit.mutate()
  }

  if (filed) return <Filed filed={filed} />

  const rules = preview.data
  return (
    <div className="grid gap-6">
      <PageHeader
        title="Report an incident"
        description="Speak or type what happened. It goes straight to the police station for where you are."
      />

      <Alert>
        <PhoneCall aria-hidden />
        <AlertTitle>In danger right now?</AlertTitle>
        <AlertDescription>
          Use SOS on the home screen or call 112. A report is for anything that isn't an emergency
          this minute.
        </AlertDescription>
      </Alert>

      <form onSubmit={onSubmit} className="grid gap-5">
        <div className="grid gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Label htmlFor="description">What happened?</Label>
            {dictation.supported ? (
              <div className="flex items-center gap-2">
                <select
                  aria-label="Dictation language"
                  className="border-input bg-background h-9 rounded-md border px-2 text-sm"
                  value={lang}
                  onChange={(e) => setLang(e.target.value as typeof lang)}
                  disabled={dictation.listening}
                >
                  {LANGUAGES.map((l) => (
                    <option key={l.code} value={l.code}>
                      {l.label}
                    </option>
                  ))}
                </select>
                <Button
                  type="button"
                  size="sm"
                  variant={dictation.listening ? 'destructive' : 'outline'}
                  onClick={() => (dictation.listening ? dictation.stop() : dictation.start(lang))}
                >
                  {dictation.listening ? <MicOff aria-hidden /> : <Mic aria-hidden />}
                  {dictation.listening ? 'Stop' : 'Speak'}
                </Button>
              </div>
            ) : null}
          </div>
          <textarea
            id="description"
            required
            minLength={3}
            maxLength={4000}
            rows={6}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="For example: A man has been following me since the metro station."
            className="border-input placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 dark:bg-input/30 w-full rounded-md border bg-transparent px-3 py-2 text-base shadow-xs outline-none focus-visible:ring-[3px] md:text-sm"
          />
          {dictation.listening ? (
            <p className="text-muted-foreground flex items-center gap-2 text-sm" aria-live="polite">
              <span className="bg-sos size-2 animate-pulse rounded-full" aria-hidden />
              Listening… {dictation.interim}
            </p>
          ) : null}
          {dictation.error ? <p className="text-destructive text-sm">{dictation.error}</p> : null}
          {rules ? (
            <p
              className="text-muted-foreground flex flex-wrap items-center gap-2 text-sm"
              aria-live="polite"
            >
              <span
                className={cn(
                  'rounded px-1.5 py-0.5 text-xs font-semibold',
                  SEVERITY[rules.severity].tone,
                )}
              >
                {SEVERITY[rules.severity].short}
              </span>
              Likely: {rules.category_label}
              {rules.signals.length > 0 ? ` · ${rules.signals.map(signalLabel).join(', ')}` : ''}
            </p>
          ) : null}
        </div>

        <fieldset className="grid gap-2">
          <legend className="mb-1 text-sm font-medium">When did it happen?</legend>
          <div className="flex flex-wrap gap-4 text-sm">
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="when"
                checked={when === 'now'}
                onChange={() => setWhen('now')}
              />
              Just now / still happening
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="when"
                checked={when === 'earlier'}
                onChange={() => setWhen('earlier')}
              />
              Earlier
            </label>
          </div>
          {when === 'earlier' ? (
            <Input
              type="datetime-local"
              aria-label="Date and time"
              className="w-fit"
              value={occurredAt}
              max={localNow()}
              onChange={(e) => setOccurredAt(e.target.value)}
            />
          ) : null}
        </fieldset>

        <Card className="gap-0 py-4">
          <CardContent className="grid gap-2 px-4">
            <label className="flex items-center gap-3 text-sm font-medium">
              <input
                type="checkbox"
                checked={useLocation}
                onChange={(e) => {
                  setUseLocation(e.target.checked)
                  if (e.target.checked && !fix) setLocating(true)
                }}
              />
              <MapPin className="text-sos size-4" aria-hidden />
              Include my location
            </label>
            <p className="text-muted-foreground text-sm">
              {!useLocation
                ? 'Your report goes to the district control room, which forwards it.'
                : locating
                  ? 'Finding your position…'
                  : fix
                    ? `${fix.lat.toFixed(5)}, ${fix.lng.toFixed(5)}${fix.accuracy ? ` (within ${fix.accuracy} m)` : ''}. Used to pick the police station.`
                    : "We couldn't get your position. The control room will forward it."}
            </p>
          </CardContent>
        </Card>

        <Card className="gap-0 py-4">
          <CardContent className="grid gap-2 px-4">
            <label className="flex items-center gap-3 text-sm font-medium">
              <input
                type="checkbox"
                checked={confidential}
                onChange={(e) => setConfidential(e.target.checked)}
              />
              <EyeOff className="text-primary size-4" aria-hidden />
              Keep my name private (confidential)
            </label>
            <p className="text-muted-foreground text-sm">
              Officers see a code like "Reporter 7F3K" instead of your name and phone number. You
              can choose to share your name later if they need to contact you.
            </p>
          </CardContent>
        </Card>

        {submit.isError ? (
          <Alert variant="destructive">
            <AlertTitle>Your report wasn't sent</AlertTitle>
            <AlertDescription>{submit.error.message}. Try again.</AlertDescription>
          </Alert>
        ) : null}

        <Button type="submit" size="touch" disabled={submit.isPending || text.trim().length < 3}>
          {submit.isPending ? <LoaderCircle className="animate-spin" aria-hidden /> : null}
          Send report
        </Button>
      </form>
    </div>
  )
}

function Filed({ filed }: { filed: Filed }) {
  return (
    <div className="grid justify-items-center gap-4 py-6 text-center">
      <CircleCheck className="size-14 text-emerald-600" aria-hidden />
      <h1 className="text-2xl font-bold">Report sent</h1>
      <p className="text-muted-foreground max-w-sm">
        Reference <span className="text-foreground font-mono font-semibold">{filed.reference}</span>
        {filed.org_name ? ` · sent to ${filed.org_name}` : ''}.
      </p>
      {filed.severity ? (
        <p className="max-w-sm text-sm">
          Marked{' '}
          <span
            className={cn('rounded px-1.5 py-0.5 font-semibold', SEVERITY[filed.severity].tone)}
          >
            {SEVERITY[filed.severity].label}
          </span>
          . {filed.rationale}
        </p>
      ) : null}
      <div className="flex flex-wrap justify-center gap-2">
        <Button asChild>
          <Link to={paths.app.complaint(filed.complaint_id)}>Follow this report</Link>
        </Button>
        <Button asChild variant="outline">
          <Link to={paths.app.home}>Home</Link>
        </Button>
      </div>
    </div>
  )
}
