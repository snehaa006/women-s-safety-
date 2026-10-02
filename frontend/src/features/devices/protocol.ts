/*
 * The wearable wire protocol (docs/05-device-protocol.md), written so it reads like firmware:
 * build a JSON body, sign it with HMAC-SHA256 using the device secret, POST it with only the
 * publishable key. The virtual wearable uses exactly this, so the real ESP32 can replace it
 * without any server change.
 */

export type DeviceEventType =
  'sos' | 'location' | 'heartbeat' | 'gesture' | 'tamper' | 'battery_low'

export type DeviceCredentials = { deviceId: string; secret: string }

export type DeviceEventFields = {
  lat?: number
  lng?: number
  accuracy_m?: number
  battery_pct?: number
  [extra: string]: string | number | boolean | undefined
}

export type DeviceEventResult = { accepted: true; event_id: number; incident_id: string | null }

export class DeviceApiError extends Error {
  readonly status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

const hex = (bytes: Uint8Array) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')

/** Hex HMAC-SHA256 of `body`, keyed with the secret's text (its 64 hex characters as bytes). */
export async function signBody(secret: string, body: string) {
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  return hex(new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(body))))
}

export function newNonce() {
  return hex(crypto.getRandomValues(new Uint8Array(8)))
}

/** The exact text that gets signed and sent. Fields that are undefined are left out. */
export function eventBody(type: DeviceEventType, fields: DeviceEventFields = {}, now = Date.now()) {
  return JSON.stringify({ type, ts: Math.floor(now / 1000), nonce: newNonce(), ...fields })
}

export async function sendDeviceEvent(
  api: { url: string; publishableKey: string },
  device: DeviceCredentials,
  type: DeviceEventType,
  fields: DeviceEventFields = {},
): Promise<DeviceEventResult> {
  const body = eventBody(type, fields)
  const signature = await signBody(device.secret, body)
  const response = await fetch(`${api.url}/rest/v1/rpc/device_event`, {
    method: 'POST',
    headers: { apikey: api.publishableKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_device_id: device.deviceId, p_body: body, p_signature: signature }),
  })
  const json = (await response.json().catch(() => null)) as { message?: string } | null
  if (!response.ok) {
    throw new DeviceApiError(json?.message ?? `HTTP ${response.status}`, response.status)
  }
  return json as unknown as DeviceEventResult
}
