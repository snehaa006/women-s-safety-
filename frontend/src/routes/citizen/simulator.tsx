import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Battery,
  BatteryLow,
  CircleCheck,
  CircleX,
  HeartPulse,
  LoaderCircle,
  MapPin,
  Play,
  ShieldAlert,
  Square,
  Watch,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'

import { PageHeader } from '@/components/page-header'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { useAuth } from '@/features/auth/auth-context'
import {
  deviceKeys,
  listDevices,
  registerDevice,
  resetDeviceSecret,
  type Device,
} from '@/features/devices/api'
import { DEMO_ROUTE } from '@/features/devices/demo-route'
import {
  sendDeviceEvent,
  type DeviceCredentials,
  type DeviceEventFields,
  type DeviceEventType,
} from '@/features/devices/protocol'
import { loadCredentials, saveCredentials } from '@/features/devices/storage'
import { LazyMap } from '@/features/map/lazy-map'
import { currentFix } from '@/features/sos/geo'
import { useHold } from '@/features/sos/use-hold'
import { paths } from '@/lib/paths'
import { supabaseKey, supabaseUrl } from '@/lib/supabase'
import { formatTime, timeAgo } from '@/lib/time'
import { cn } from '@/lib/utils'

const LONG_PRESS_MS = 3000
const WALK_TICK_MS = 3000
const HEARTBEAT_MS = 60_000
const DOUBLE_CLICK_MS = 400

type LogEntry = {
  id: number
  at: number
  type: DeviceEventType
  detail: string
  ok: boolean
  message: string
  incidentId: string | null
}

export function Component() {
  const auth = useAuth()
  const userId = auth.status === 'signed-in' ? auth.profile.id : ''
  const queryClient = useQueryClient()
  const [credentials, setCredentials] = useState(() => loadCredentials(userId))
  const devices = useQuery({
    queryKey: deviceKeys.all,
    queryFn: listDevices,
    refetchInterval: 10_000,
  })

  const paired = devices.data?.find((d) => d.id === credentials?.deviceId)
  const existing = devices.data?.find((d) => d.kind === 'simulator')

  const pair = useMutation({
    mutationFn: () =>
      existing ? resetDeviceSecret(existing.id) : registerDevice('Virtual keychain', 'simulator'),
    onSuccess: async (next) => {
      saveCredentials(userId, next)
      setCredentials(next)
      await queryClient.invalidateQueries({ queryKey: deviceKeys.all })
    },
  })

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Virtual wearable"
        description="Mock IoT device. It behaves like the keychain: every event is signed with its own device key and sent to the same API the real hardware will use."
        actions={<Badge variant="secondary">Simulator</Badge>}
      />

      {devices.isPending ? (
        <p className="text-muted-foreground flex items-center gap-2">
          <LoaderCircle className="size-4 animate-spin" aria-hidden /> Loading…
        </p>
      ) : devices.isError ? (
        <Alert variant="destructive">
          <AlertDescription>{devices.error.message}</AlertDescription>
        </Alert>
      ) : paired && credentials ? (
        <Simulator device={paired} credentials={credentials} />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Watch className="text-primary size-5" aria-hidden />
              {existing ? 'Reconnect this browser' : 'Pair a virtual wearable'}
            </CardTitle>
            <CardDescription>
              {existing
                ? 'Your virtual wearable exists, but its key is not stored in this browser. Reconnecting issues a new key; the old one stops working.'
                : 'Creates a device in your account with its own secret key, kept in this browser like a real device keeps it in memory.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            {pair.isError ? (
              <Alert variant="destructive">
                <AlertDescription>{pair.error.message}</AlertDescription>
              </Alert>
            ) : null}
            <Button
              className="justify-self-start"
              onClick={() => pair.mutate()}
              disabled={pair.isPending}
            >
              {pair.isPending ? 'Pairing…' : existing ? 'Reconnect' : 'Pair virtual wearable'}
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function Simulator({ device, credentials }: { device: Device; credentials: DeviceCredentials }) {
  const queryClient = useQueryClient()
  const [battery, setBattery] = useState(82)
  const [source, setSource] = useState<'route' | 'gps'>('route')
  const [routeIndex, setRouteIndex] = useState(0)
  const [walking, setWalking] = useState(false)
  const [heartbeat, setHeartbeat] = useState(true)
  const [log, setLog] = useState<LogEntry[]>([])
  const [walked, setWalked] = useState<[number, number][]>([])
  const [incidentId, setIncidentId] = useState<string | null>(null)
  const [sosFlash, setSosFlash] = useState(false)

  // Intervals read the latest settings through this ref instead of restarting on every change.
  const live = useRef({ battery, source, routeIndex })
  useEffect(() => {
    live.current = { battery, source, routeIndex }
  }, [battery, source, routeIndex])
  const nextLogId = useRef(1)

  const position = useCallback(async (): Promise<DeviceEventFields> => {
    if (live.current.source === 'route') {
      const [lng, lat] = DEMO_ROUTE[Math.min(live.current.routeIndex, DEMO_ROUTE.length - 1)]
      return { lat, lng, accuracy_m: 8 }
    }
    const fix = await currentFix(5000)
    return fix ? { lat: fix.lat, lng: fix.lng, accuracy_m: fix.accuracy ?? undefined } : {}
  }, [])

  const send = useCallback(
    async (type: DeviceEventType, extra: DeviceEventFields = {}, detail = '') => {
      const located = type === 'gesture' ? {} : await position()
      const fields = { ...located, battery_pct: live.current.battery, ...extra }
      const entry = {
        id: nextLogId.current++,
        at: Date.now(),
        type,
        detail,
        incidentId: null as string | null,
      }
      try {
        if (!supabaseUrl || !supabaseKey) throw new Error('The app is not connected to Supabase.')
        const result = await sendDeviceEvent(
          { url: supabaseUrl, publishableKey: supabaseKey },
          credentials,
          type,
          fields,
        )
        entry.incidentId = result.incident_id
        const { lat, lng } = fields
        if (typeof lat === 'number' && typeof lng === 'number') {
          setWalked((path) => [...path.slice(-500), [lng, lat]])
        }
        if (result.incident_id) setIncidentId(result.incident_id)
        setLog((items) => [{ ...entry, ok: true, message: 'Accepted' }, ...items].slice(0, 50))
        void queryClient.invalidateQueries({ queryKey: ['incidents'] })
        void queryClient.invalidateQueries({ queryKey: deviceKeys.all })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        setLog((items) => [{ ...entry, ok: false, message }, ...items].slice(0, 50))
      }
    },
    [credentials, position, queryClient],
  )

  const sos = useCallback(() => {
    setSosFlash(true)
    setTimeout(() => setSosFlash(false), 2500)
    void send('sos', {}, 'Long press')
  }, [send])

  // Walking: move along the route (or read GPS) and report every few seconds.
  useEffect(() => {
    if (!walking) return
    const timer = setInterval(() => {
      if (live.current.source === 'route') {
        const next = live.current.routeIndex + 1
        if (next >= DEMO_ROUTE.length) {
          setWalking(false)
          return
        }
        live.current.routeIndex = next
        setRouteIndex(next)
      }
      void send('location', {}, live.current.source === 'route' ? 'Demo walk' : 'GPS')
    }, WALK_TICK_MS)
    return () => clearInterval(timer)
  }, [walking, send])

  useEffect(() => {
    if (!heartbeat) return
    const timer = setInterval(
      () => void send('heartbeat', { signal_dbm: -71 }, 'Automatic'),
      HEARTBEAT_MS,
    )
    return () => clearInterval(timer)
  }, [heartbeat, send])

  // The one physical button: hold 3 s for SOS, 1 click and 2 clicks are gestures.
  const justHeld = useRef(false)
  const clicks = useRef(0)
  const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hold = useHold(LONG_PRESS_MS, () => {
    justHeld.current = true
    sos()
  })
  function onClick() {
    if (justHeld.current) {
      justHeld.current = false
      return
    }
    clicks.current += 1
    if (clickTimer.current) clearTimeout(clickTimer.current)
    clickTimer.current = setTimeout(() => {
      const count = Math.min(clicks.current, 2)
      clicks.current = 0
      void send(
        'gesture',
        { clicks: count },
        count === 1 ? '1 click: fake call (Phase 7)' : '2 clicks: stealth recording (Phase 7)',
      )
    }, DOUBLE_CLICK_MS)
  }

  function runDemo() {
    setSource('route')
    setRouteIndex(0)
    setWalked([])
    live.current = { ...live.current, source: 'route', routeIndex: 0 }
    sos()
    setWalking(true)
  }

  const [lng, lat] = DEMO_ROUTE[Math.min(routeIndex, DEMO_ROUTE.length - 1)]
  const current = source === 'route' ? { lat, lng } : null

  return (
    <div className="grid gap-6">
      {incidentId ? (
        <Alert className="border-sos/40">
          <ShieldAlert className="text-sos" aria-hidden />
          <AlertTitle>The wearable started an SOS</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center gap-2">
            Open it to see what your contacts see, or keep walking to stream location.
            <Button asChild size="sm" variant="sos">
              <Link to={paths.app.sos(incidentId)}>Open SOS</Link>
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-6 md:grid-cols-[minmax(0,15rem)_1fr]">
        <Card className="min-w-0 items-center gap-4 py-6">
          <div
            className="bg-foreground text-background relative grid w-44 justify-items-center gap-4 rounded-[2.5rem] px-6 pt-5 pb-7 shadow-xl"
            aria-label={`${device.name}, battery ${battery}%`}
          >
            <div className="flex w-full items-center justify-between text-xs">
              <span className="flex items-center gap-1.5">
                <span
                  className={cn(
                    'size-2.5 rounded-full',
                    sosFlash ? 'animate-ping bg-red-500' : 'bg-emerald-400',
                  )}
                  aria-hidden
                />
                {sosFlash ? 'SOS' : 'Online'}
              </span>
              <span className="flex items-center gap-1">
                {battery <= 15 ? (
                  <BatteryLow className="size-4" aria-hidden />
                ) : (
                  <Battery className="size-4" aria-hidden />
                )}
                {battery}%
              </span>
            </div>
            <button
              type="button"
              aria-label="Wearable button. Hold 3 seconds for SOS, click once or twice for gestures."
              {...hold.handlers}
              onClick={onClick}
              style={{
                backgroundImage: hold.holding
                  ? `conic-gradient(var(--sos) ${Math.round(hold.progress * 100)}%, transparent 0)`
                  : undefined,
              }}
              className="bg-background/15 focus-visible:ring-ring grid size-24 touch-none place-content-center rounded-full border-4 border-current text-sm font-bold select-none focus-visible:ring-4 focus-visible:outline-none active:scale-95"
            >
              {hold.holding ? 'Hold…' : 'Press'}
            </button>
            <span className="text-[0.65rem] tracking-widest uppercase opacity-70">
              {device.name}
            </span>
          </div>
          <ul className="text-muted-foreground grid gap-1 px-4 text-xs">
            <li>
              <strong className="text-foreground">Hold 3 s:</strong> SOS
            </li>
            <li>
              <strong className="text-foreground">1 click:</strong> fake call (Phase 7)
            </li>
            <li>
              <strong className="text-foreground">2 clicks:</strong> stealth recording (Phase 7)
            </li>
          </ul>
          <p className="text-muted-foreground px-4 text-center text-xs">
            Server sees: {device.status === 'tamper' ? 'tamper alert, ' : ''}
            {device.battery_pct !== null ? `${device.battery_pct}% battery, ` : ''}
            {device.last_seen_at ? `last seen ${timeAgo(device.last_seen_at)}` : 'never seen yet'}
          </p>
        </Card>

        <Card className="min-w-0 gap-4">
          <CardHeader>
            <CardTitle>Controls</CardTitle>
            <CardDescription>
              Mock data for demos and testing. Nothing here needs real hardware.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-5">
            <Button
              size="touch"
              variant="sos"
              className="h-auto min-h-12 py-2 whitespace-normal"
              onClick={runDemo}
              disabled={walking}
            >
              <Play aria-hidden />
              Run demo: SOS, then a walk down Janpath
            </Button>

            <fieldset className="grid gap-2">
              <legend className="mb-1 text-sm font-medium">Location the wearable reports</legend>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="source"
                  checked={source === 'route'}
                  onChange={() => setSource('route')}
                  className="accent-primary size-4"
                />
                Demo walk, Connaught Place, New Delhi ({routeIndex + 1}/{DEMO_ROUTE.length})
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="source"
                  checked={source === 'gps'}
                  onChange={() => setSource('gps')}
                  className="accent-primary size-4"
                />
                This browser's real location
              </label>
            </fieldset>

            <div className="flex flex-wrap gap-2">
              <Button
                variant={walking ? 'secondary' : 'outline'}
                onClick={() => setWalking((w) => !w)}
              >
                {walking ? <Square aria-hidden /> : <MapPin aria-hidden />}
                {walking ? 'Stop walking' : 'Start walking'}
              </Button>
              {source === 'route' ? (
                <Button
                  variant="ghost"
                  onClick={() => {
                    setRouteIndex(0)
                    setWalked([])
                  }}
                >
                  Back to start
                </Button>
              ) : null}
            </div>

            <div className="grid gap-2">
              <Label htmlFor="battery">Battery: {battery}%</Label>
              <input
                id="battery"
                type="range"
                min={0}
                max={100}
                value={battery}
                onChange={(event) => setBattery(Number(event.target.value))}
                className="accent-primary"
              />
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                onClick={() => void send('heartbeat', { signal_dbm: -71 }, 'Manual')}
              >
                <HeartPulse aria-hidden />
                Heartbeat
              </Button>
              <Button
                variant="outline"
                onClick={() => void send('battery_low', {}, `${battery}% left`)}
              >
                <BatteryLow aria-hidden />
                Low battery
              </Button>
              <Button
                variant="outline"
                onClick={() => void send('tamper', { reason: 'case_opened' }, 'Case opened')}
              >
                <ShieldAlert aria-hidden />
                Tamper
              </Button>
            </div>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={heartbeat}
                onChange={(event) => setHeartbeat(event.target.checked)}
                className="accent-primary size-4"
              />
              Send a heartbeat every minute while this page is open
            </label>
          </CardContent>
        </Card>
      </div>

      <LazyMap
        className="h-72"
        path={walked}
        current={current}
        routePreview={source === 'route' ? DEMO_ROUTE : undefined}
        label="Where the virtual wearable is and the demo route"
      />

      <EventLog log={log} />
      <DeveloperPanel credentials={credentials} />
    </div>
  )
}

function EventLog({ log }: { log: LogEntry[] }) {
  return (
    <Card className="gap-3">
      <CardHeader>
        <CardTitle>Events sent</CardTitle>
      </CardHeader>
      <CardContent>
        {log.length === 0 ? (
          <p className="text-muted-foreground text-sm">Nothing sent yet. Press the button.</p>
        ) : (
          <ol className="grid gap-2" aria-live="polite">
            {log.map((entry) => (
              <li key={entry.id} className="flex items-start gap-2 text-sm">
                {entry.ok ? (
                  <CircleCheck
                    className="mt-0.5 size-4 shrink-0 text-emerald-600"
                    aria-label="Accepted"
                  />
                ) : (
                  <CircleX
                    className="text-destructive mt-0.5 size-4 shrink-0"
                    aria-label="Rejected"
                  />
                )}
                <span className="grid flex-1">
                  <span>
                    <span className="font-mono font-semibold">{entry.type}</span>
                    {entry.detail ? ` · ${entry.detail}` : ''}
                    {entry.incidentId ? (
                      <>
                        {' · '}
                        <Link className="underline" to={paths.app.sos(entry.incidentId)}>
                          SOS
                        </Link>
                      </>
                    ) : null}
                  </span>
                  {!entry.ok ? <span className="text-destructive">{entry.message}</span> : null}
                </span>
                <span className="text-muted-foreground shrink-0">{formatTime(entry.at, true)}</span>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  )
}

function DeveloperPanel({ credentials }: { credentials: DeviceCredentials }) {
  const [reveal, setReveal] = useState(false)
  const env = [
    `SUPABASE_URL=${supabaseUrl ?? ''}`,
    `SUPABASE_PUBLISHABLE_KEY=${supabaseKey ?? ''}`,
    `DEVICE_ID=${credentials.deviceId}`,
    `DEVICE_SECRET=${reveal ? credentials.secret : '•'.repeat(16)}`,
  ].join('\n')

  return (
    <details className="bg-card rounded-xl border p-4">
      <summary className="cursor-pointer font-semibold">
        For developers: send events from a script
      </summary>
      <div className="mt-3 grid gap-3 text-sm">
        <p className="text-muted-foreground">
          The same events can come from the command line (or, later, the ESP32 firmware). Put these
          in your environment and run{' '}
          <code className="font-mono">node tools/device-simulator.mjs demo</code>. See
          docs/05-device-protocol.md for the wire format.
        </p>
        <pre className="bg-muted overflow-x-auto rounded-md p-3 font-mono text-xs">{env}</pre>
        <Button
          variant="outline"
          size="sm"
          className="justify-self-start"
          onClick={() => setReveal((r) => !r)}
        >
          {reveal ? 'Hide secret' : 'Show secret'}
        </Button>
        <p className="text-muted-foreground text-xs">
          Anyone with the secret can send events as this device. Reconnecting the wearable issues a
          new one.
        </p>
      </div>
    </details>
  )
}
