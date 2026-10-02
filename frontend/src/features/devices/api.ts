import type { Tables } from '@/lib/database.types'
import { db, unwrap } from '@/lib/supabase'

import type { DeviceCredentials } from './protocol'

export type Device = Tables<'devices'>
export type DeviceEvent = Tables<'device_events'>

export const deviceKeys = {
  all: ['devices'] as const,
  events: (deviceId: string) => ['devices', deviceId, 'events'] as const,
}

export async function listDevices(): Promise<Device[]> {
  return unwrap(await db().from('devices').select('*').order('created_at'))
}

/** Pairs a device and returns its secret. The secret is never shown again. */
export async function registerDevice(
  name: string,
  kind: 'simulator' | 'keychain',
): Promise<DeviceCredentials> {
  const result = unwrap(await db().rpc('register_device', { p_name: name, p_kind: kind })) as {
    device_id: string
    secret: string
  }
  return { deviceId: result.device_id, secret: result.secret }
}

export async function resetDeviceSecret(deviceId: string): Promise<DeviceCredentials> {
  const result = unwrap(await db().rpc('reset_device_secret', { p_device_id: deviceId })) as {
    device_id: string
    secret: string
  }
  return { deviceId: result.device_id, secret: result.secret }
}

export async function removeDevice(deviceId: string) {
  unwrap(await db().from('devices').delete().eq('id', deviceId))
}

export async function clearTamper(deviceId: string) {
  unwrap(await db().from('devices').update({ status: 'active' }).eq('id', deviceId))
}

export async function recentEvents(deviceId: string): Promise<DeviceEvent[]> {
  return unwrap(
    await db()
      .from('device_events')
      .select('*')
      .eq('device_id', deviceId)
      .order('received_at', { ascending: false })
      .limit(20),
  )
}
