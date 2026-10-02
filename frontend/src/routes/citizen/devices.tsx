import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Cpu, LoaderCircle, ShieldAlert, Trash2, Watch } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'

import { PageHeader } from '@/components/page-header'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  clearTamper,
  deviceKeys,
  listDevices,
  registerDevice,
  removeDevice,
  type Device,
} from '@/features/devices/api'
import type { DeviceCredentials } from '@/features/devices/protocol'
import { paths } from '@/lib/paths'
import { timeAgo } from '@/lib/time'

export function Component() {
  const queryClient = useQueryClient()
  const devices = useQuery({ queryKey: deviceKeys.all, queryFn: listDevices })
  const [newKey, setNewKey] = useState<DeviceCredentials | null>(null)

  const pairKeychain = useMutation({
    mutationFn: () => registerDevice('Keychain', 'keychain'),
    onSuccess: async (credentials) => {
      setNewKey(credentials)
      await queryClient.invalidateQueries({ queryKey: deviceKeys.all })
    },
  })

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Wearables"
        description="A wearable sends SOS straight to the server, even when your phone is locked or out of reach."
      />

      <Card className="border-primary/30 gap-3">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Watch className="text-primary size-5" aria-hidden />
            No hardware yet? Use the virtual wearable
          </CardTitle>
          <CardDescription>
            It sends the same signed events as the ESP32 keychain: SOS, location, heartbeat, battery
            and tamper. Use it for demos and to fill the app with realistic data.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <Link to={paths.app.simulator}>Open the virtual wearable</Link>
          </Button>
        </CardContent>
      </Card>

      {devices.isPending ? (
        <p className="text-muted-foreground flex items-center gap-2">
          <LoaderCircle className="size-4 animate-spin" aria-hidden /> Loading…
        </p>
      ) : devices.isError ? (
        <Alert variant="destructive">
          <AlertDescription>{devices.error.message}</AlertDescription>
        </Alert>
      ) : devices.data.length > 0 ? (
        <ul className="grid gap-2" aria-label="Paired devices">
          {devices.data.map((device) => (
            <li key={device.id}>
              <DeviceRow device={device} />
            </li>
          ))}
        </ul>
      ) : null}

      {newKey ? (
        <Alert>
          <Cpu aria-hidden />
          <AlertTitle>Flash these into the keychain firmware</AlertTitle>
          <AlertDescription className="grid gap-2">
            <p>The secret is shown only once. Store it in the device, not in a note.</p>
            <pre className="bg-muted overflow-x-auto rounded p-2 font-mono text-xs">
              {`DEVICE_ID=${newKey.deviceId}\nDEVICE_SECRET=${newKey.secret}`}
            </pre>
            <Button size="sm" variant="outline" onClick={() => setNewKey(null)}>
              I've saved it
            </Button>
          </AlertDescription>
        </Alert>
      ) : (
        <details className="text-sm">
          <summary className="cursor-pointer font-medium">Pair a hardware keychain</summary>
          <div className="mt-2 grid gap-2">
            <p className="text-muted-foreground">
              For the ESP32 keychain (Phase 8). Creates the device and shows its key once, to put
              into the firmware.
            </p>
            {pairKeychain.isError ? (
              <p className="text-destructive">{pairKeychain.error.message}</p>
            ) : null}
            <Button
              variant="outline"
              size="sm"
              className="justify-self-start"
              disabled={pairKeychain.isPending}
              onClick={() => pairKeychain.mutate()}
            >
              Create keychain key
            </Button>
          </div>
        </details>
      )}
    </div>
  )
}

function DeviceRow({ device }: { device: Device }) {
  const queryClient = useQueryClient()
  const refresh = () => queryClient.invalidateQueries({ queryKey: deviceKeys.all })
  const remove = useMutation({ mutationFn: () => removeDevice(device.id), onSuccess: refresh })
  const clear = useMutation({ mutationFn: () => clearTamper(device.id), onSuccess: refresh })

  return (
    <Card className="gap-0 py-3">
      <CardContent className="flex flex-wrap items-center gap-3 px-4">
        <Watch className="text-muted-foreground size-5" aria-hidden />
        <div className="grid min-w-0 flex-1">
          <span className="flex items-center gap-2 font-semibold">
            {device.name}
            <Badge variant="secondary">
              {device.kind === 'simulator' ? 'Virtual' : 'Keychain'}
            </Badge>
            {device.status === 'tamper' ? (
              <Badge variant="destructive">
                <ShieldAlert aria-hidden />
                Tamper
              </Badge>
            ) : null}
          </span>
          <span className="text-muted-foreground text-sm">
            {device.battery_pct !== null ? `${device.battery_pct}% battery · ` : ''}
            {device.last_seen_at ? `last seen ${timeAgo(device.last_seen_at)}` : 'not seen yet'}
          </span>
        </div>
        {device.status === 'tamper' ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => clear.mutate()}
            disabled={clear.isPending}
          >
            I've checked it
          </Button>
        ) : null}
        {device.kind === 'simulator' ? (
          <Button asChild size="sm" variant="outline">
            <Link to={paths.app.simulator}>Open</Link>
          </Button>
        ) : null}
        <Button
          size="icon"
          variant="ghost"
          aria-label={`Remove ${device.name}`}
          disabled={remove.isPending}
          onClick={() => {
            if (window.confirm(`Remove ${device.name}? It will stop being able to send SOS.`)) {
              remove.mutate()
            }
          }}
        >
          <Trash2 />
        </Button>
      </CardContent>
    </Card>
  )
}
