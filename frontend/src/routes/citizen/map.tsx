import { useMutation, useQuery } from '@tanstack/react-query'
import { Flag, LoaderCircle, MapPin, Moon, Navigation, Route, Sun } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'

import { PageHeader } from '@/components/page-header'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { LazyMap } from '@/features/map/lazy-map'
import {
  fetchRiskMap,
  reportZone,
  safeMapKeys,
  scoreRoutes,
  startJourney,
  type RiskCell,
  type ZoneKind,
} from '@/features/safe-map/api'
import {
  detourPoints,
  fetchWalkingRoutes,
  minutes,
  pickRoutes,
  sampleLine,
  type LngLat,
  type Scored,
  type WalkingRoute,
} from '@/features/safe-map/routing'
import { explainCell } from '@/features/safe-map/labels'
import { currentFix } from '@/features/sos/geo'
import { useSafePoints } from '@/features/sos/use-safe-points'
import { paths } from '@/lib/paths'
import { cn } from '@/lib/utils'

const isNightNow = () => {
  const hour = Number(
    new Intl.DateTimeFormat('en-IN', { hour: 'numeric', hour12: false, timeZone: 'Asia/Kolkata' })
      .format(new Date())
      .replace(/\D/g, ''),
  )
  return hour >= 19 || hour < 6
}

/** Where to start when location is off: Rajiv Chowk metro, the start of the demo walk. */
const DEMO_START = { lat: 28.6328, lng: 77.2196 }
const PRESETS = [
  { name: 'Janpath market (demo)', lat: 28.617, lng: 77.2197 },
  { name: 'Mandi House metro', lat: 28.6258, lng: 77.2343 },
  { name: 'Patel Chowk metro', lat: 28.6229, lng: 77.2139 },
]

const ZONE_KINDS: { value: ZoneKind; label: string }[] = [
  { value: 'poor_lighting', label: 'Poor lighting' },
  { value: 'isolated', label: 'Isolated or deserted' },
  { value: 'harassment', label: 'Harassment happens here' },
  { value: 'unsafe_crowd', label: 'Unsafe crowd' },
  { value: 'no_transport', label: 'No transport' },
  { value: 'other', label: 'Something else' },
]

type Plan = {
  routes: WalkingRoute[]
  scores: Scored[]
  pick: ReturnType<typeof pickRoutes>
  detoured: boolean
}

/** Routes from the router, scored; if every one crosses a high-risk cell, try detours. */
async function planRoutes(from: LngLat, to: LngLat, cells: RiskCell[], at: Date): Promise<Plan> {
  let routes = await fetchWalkingRoutes(from, to)
  let { routes: scores } = await scoreRoutes(
    routes.map((r) => sampleLine(r.coordinates)),
    at,
  )
  let detoured = false
  if (scores.every((s) => s.high_cells > 0)) {
    const worst = worstCellOn(routes[0].coordinates, cells)
    if (worst) {
      const centre: LngLat = [
        (worst.bounds[0] + worst.bounds[2]) / 2,
        (worst.bounds[1] + worst.bounds[3]) / 2,
      ]
      const extra = await Promise.all(
        detourPoints(from, to, centre).map((via) =>
          fetchWalkingRoutes(from, to, { via })
            .then((r) => r[0])
            .catch(() => null),
        ),
      )
      const added = extra.filter((r): r is WalkingRoute => r !== null)
      if (added.length) {
        routes = [...routes, ...added]
        scores = (
          await scoreRoutes(
            routes.map((r) => sampleLine(r.coordinates)),
            at,
          )
        ).routes
        detoured = true
      }
    }
  }
  return { routes, scores, pick: pickRoutes(routes, scores), detoured }
}

function worstCellOn(line: LngLat[], cells: RiskCell[]) {
  const high = cells.filter((c) => c.level === 'high')
  let worst: RiskCell | null = null
  for (const [lng, lat] of sampleLine(line)) {
    const cell = high.find(
      (c) => c.bounds[0] <= lng && lng < c.bounds[2] && c.bounds[1] <= lat && lat < c.bounds[3],
    )
    if (cell && (!worst || cell.score > worst.score)) worst = cell
  }
  return worst
}

export function Component() {
  const navigate = useNavigate()
  const [period, setPeriod] = useState<'day' | 'night'>(isNightNow() ? 'night' : 'day')
  const [here, setHere] = useState<{ lat: number; lng: number } | null>(null)
  const [locating, setLocating] = useState(true)
  const [mode, setMode] = useState<'route' | 'report'>('route')
  const [destination, setDestination] = useState<{ lat: number; lng: number; name: string } | null>(
    null,
  )
  const [selected, setSelected] = useState<'safest' | 'fastest'>('safest')
  const [reportAt, setReportAt] = useState<{ lat: number; lng: number } | null>(null)
  const [kind, setKind] = useState<ZoneKind>('poor_lighting')
  const [note, setNote] = useState('')

  useEffect(() => {
    let cancelled = false
    void currentFix(5000).then((fix) => {
      if (cancelled) return
      setHere(fix ? { lat: fix.lat, lng: fix.lng } : null)
      setLocating(false)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const risk = useQuery({ queryKey: safeMapKeys.risk(period), queryFn: () => fetchRiskMap(period) })
  const start = here ?? DEMO_START
  const safePoints = useSafePoints(start)

  const plan = useMutation({
    mutationFn: () =>
      planRoutes(
        [start.lng, start.lat],
        [destination!.lng, destination!.lat],
        risk.data?.cells ?? [],
        new Date(),
      ),
    onSuccess: () => setSelected('safest'),
  })

  const go = useMutation({
    mutationFn: () => {
      const choice = plan.data ? plan.data.pick[selected] : null
      return startJourney({
        clientId: crypto.randomUUID(),
        destination: destination!,
        route: choice ? choice.route.coordinates : null,
        label: choice ? selected : 'direct',
        expectedMinutes: choice ? minutes(choice.route.durationS) + 5 : null,
        from: start,
      })
    },
    onSuccess: (result) => navigate(paths.app.journey(result.journey_id)),
  })

  const report = useMutation({
    mutationFn: () => reportZone(reportAt!, kind, period === 'night', note),
    onSuccess: () => {
      setReportAt(null)
      setNote('')
    },
  })

  const pickRoute = plan.data?.pick
  const shown = pickRoute
    ? [
        {
          coordinates: pickRoute.fastest.route.coordinates,
          color: '#6b7280',
          selected: selected === 'fastest',
        },
        ...(pickRoute.same
          ? []
          : [
              {
                coordinates: pickRoute.safest.route.coordinates,
                color: '#0f8a5f',
                selected: selected === 'safest',
              },
            ]),
      ]
    : []
  const topCells = (risk.data?.cells ?? []).filter((c) => c.level === 'high').slice(0, 3)

  return (
    <div className="grid gap-4">
      <PageHeader
        title="Safety map"
        description="Areas people have flagged, by day or night, and the safest way to walk."
      />

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-md border p-0.5" role="group" aria-label="Time of day">
          {(['day', 'night'] as const).map((p) => (
            <button
              key={p}
              type="button"
              aria-pressed={period === p}
              onClick={() => setPeriod(p)}
              className={cn(
                'flex items-center gap-1 rounded px-3 py-1 text-sm',
                period === p ? 'bg-accent font-medium' : 'text-muted-foreground',
              )}
            >
              {p === 'day' ? (
                <Sun className="size-4" aria-hidden />
              ) : (
                <Moon className="size-4" aria-hidden />
              )}
              {p === 'day' ? 'Day' : 'Night'}
            </button>
          ))}
        </div>
        <div className="flex rounded-md border p-0.5" role="group" aria-label="What to do">
          {(['route', 'report'] as const).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={mode === m}
              onClick={() => setMode(m)}
              className={cn(
                'flex items-center gap-1 rounded px-3 py-1 text-sm',
                mode === m ? 'bg-accent font-medium' : 'text-muted-foreground',
              )}
            >
              {m === 'route' ? (
                <Route className="size-4" aria-hidden />
              ) : (
                <Flag className="size-4" aria-hidden />
              )}
              {m === 'route' ? 'Plan a route' : 'Report a place'}
            </button>
          ))}
        </div>
      </div>

      <LazyMap
        path={[]}
        current={start}
        follow={false}
        cells={(risk.data?.cells ?? []).map((c) => ({ bounds: c.bounds, level: c.level }))}
        routes={shown}
        destination={mode === 'report' ? reportAt : destination}
        points={(safePoints.data ?? []).map((p) => ({
          lat: p.lat,
          lng: p.lng,
          name: p.name,
          category: p.category,
        }))}
        onPick={(point) => {
          if (mode === 'report') setReportAt(point)
          else {
            setDestination({ ...point, name: 'Dropped pin' })
            plan.reset()
          }
        }}
        className="h-[45dvh]"
        label={`Safety map, ${period}. Red areas are high risk, amber medium.`}
      />
      <p className="text-muted-foreground text-xs">
        {locating
          ? 'Finding your location…'
          : here
            ? 'Blue dots: police, green: hospitals.'
            : 'Location is off, so routes start at Rajiv Chowk metro.'}{' '}
        Areas show only when at least {risk.data?.min_signals ?? 3} people or reports flagged them;
        no individual report is ever shown.
      </p>
      {risk.isError ? (
        <Alert variant="destructive">
          <AlertDescription>{risk.error.message}</AlertDescription>
        </Alert>
      ) : null}
      {topCells.length ? (
        <ul className="grid gap-1 text-sm" aria-label="Why areas are red">
          {topCells.map((c) => (
            <li key={`${c.x}-${c.y}`} className="flex items-center gap-2">
              <Badge variant="destructive">High</Badge>
              <span className="text-muted-foreground">{explainCell(c)}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {mode === 'route' ? (
        <Card className="gap-3">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Navigation className="text-primary size-5" aria-hidden /> Where to?
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm">
            <div className="flex flex-wrap gap-2">
              {PRESETS.map((p) => (
                <Button
                  key={p.name}
                  size="sm"
                  variant={destination?.name === p.name ? 'default' : 'outline'}
                  onClick={() => {
                    setDestination(p)
                    plan.reset()
                  }}
                >
                  {p.name}
                </Button>
              ))}
            </div>
            <p className="text-muted-foreground">Or tap the map to drop a pin.</p>
            {destination ? (
              <Button className="w-fit" onClick={() => plan.mutate()} disabled={plan.isPending}>
                {plan.isPending ? (
                  <LoaderCircle className="animate-spin" aria-hidden />
                ) : (
                  <Route aria-hidden />
                )}
                Find the safest route to {destination.name}
              </Button>
            ) : null}
            {plan.isError ? (
              <p className="text-destructive">
                {plan.error.message}. You can still start a watched journey without a route.
              </p>
            ) : null}
            {pickRoute ? (
              <RouteChoice
                pick={pickRoute}
                selected={selected}
                onSelect={setSelected}
                detoured={plan.data!.detoured}
              />
            ) : null}
            {destination ? (
              <Button
                variant="sos"
                className="w-fit"
                onClick={() => go.mutate()}
                disabled={go.isPending || plan.isPending}
              >
                <MapPin aria-hidden /> Start a watched journey
              </Button>
            ) : null}
            {go.isError ? <p className="text-destructive">{go.error.message}</p> : null}
            <p className="text-muted-foreground text-xs">
              While a journey is watched, a long stop or leaving the route asks if you're OK; no
              answer, or your phone going silent, alerts your circle. Routes: OpenStreetMap via
              FOSSGIS.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card className="gap-3">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Flag className="text-primary size-5" aria-hidden /> Report a place
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm">
            {reportAt ? (
              <form
                className="grid gap-3"
                onSubmit={(event) => {
                  event.preventDefault()
                  report.mutate()
                }}
              >
                <div className="grid gap-1">
                  <Label htmlFor="zone-kind">What's wrong here?</Label>
                  <select
                    id="zone-kind"
                    className="border-input bg-background h-9 rounded-md border px-2"
                    value={kind}
                    onChange={(event) => setKind(event.target.value as ZoneKind)}
                  >
                    {ZONE_KINDS.map((k) => (
                      <option key={k.value} value={k.value}>
                        {k.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="grid gap-1">
                  <Label htmlFor="zone-note">Note (optional)</Label>
                  <Input
                    id="zone-note"
                    value={note}
                    maxLength={300}
                    onChange={(event) => setNote(event.target.value)}
                  />
                </div>
                <p className="text-muted-foreground">
                  Counts for the {period === 'night' ? 'night' : 'day'} map. It shows only together
                  with others' reports.
                </p>
                <Button type="submit" className="w-fit" disabled={report.isPending}>
                  Send report
                </Button>
              </form>
            ) : (
              <p className="text-muted-foreground">
                Tap the map where you felt unsafe.
                {report.isSuccess ? ' Thank you, your report was saved.' : ''}
              </p>
            )}
            {report.isError ? <p className="text-destructive">{report.error.message}</p> : null}
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function RouteChoice({
  pick,
  selected,
  onSelect,
  detoured,
}: {
  pick: Plan['pick']
  selected: 'safest' | 'fastest'
  onSelect: (choice: 'safest' | 'fastest') => void
  detoured: boolean
}) {
  if (pick.same) {
    return (
      <p>
        The fastest route ({minutes(pick.fastest.route.durationS)} min) is also the safest
        {pick.fastest.score.high_cells ? '' : ': it avoids every high-risk area'}.
      </p>
    )
  }
  const extra = minutes(pick.safest.route.durationS) - minutes(pick.fastest.route.durationS)
  const option = (key: 'safest' | 'fastest') => {
    const o = pick[key]
    return (
      <button
        key={key}
        type="button"
        aria-pressed={selected === key}
        onClick={() => onSelect(key)}
        className={cn(
          'grid gap-0.5 rounded-md border p-3 text-left',
          selected === key && 'border-primary bg-accent/40',
        )}
      >
        <span className="font-medium">
          {key === 'safest' ? 'Safest' : 'Fastest'} · {minutes(o.route.durationS)} min ·{' '}
          {(o.route.distanceM / 1000).toFixed(1)} km
        </span>
        <span className="text-muted-foreground text-xs">
          {o.score.high_cells
            ? `Crosses ${o.score.high_cells} high-risk area${o.score.high_cells === 1 ? '' : 's'}`
            : 'Avoids high-risk areas'}
          {o.score.safe_points.length ? ` · ${o.score.safe_points.length} safe points nearby` : ''}
        </span>
      </button>
    )
  }
  return (
    <div className="grid gap-2">
      <div className="grid gap-2 sm:grid-cols-2">
        {option('safest')}
        {option('fastest')}
      </div>
      <p>
        The safest route takes {extra > 0 ? `${extra} min longer` : 'no longer'}
        {detoured ? ', going around the high-risk area' : ''}.
      </p>
    </div>
  )
}
