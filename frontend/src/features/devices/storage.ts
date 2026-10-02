import type { DeviceCredentials } from './protocol'

/*
 * The virtual wearable's secret lives in this browser only, like a real device keeps it in its
 * flash memory. If it is lost (cleared storage, another browser), the app issues a new one.
 */
const key = (userId: string) => `virtual-wearable:${userId}`

export function loadCredentials(userId: string): DeviceCredentials | null {
  try {
    const raw = localStorage.getItem(key(userId))
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<DeviceCredentials>
    return parsed.deviceId && parsed.secret
      ? { deviceId: parsed.deviceId, secret: parsed.secret }
      : null
  } catch {
    return null
  }
}

export function saveCredentials(userId: string, credentials: DeviceCredentials | null) {
  try {
    if (credentials) localStorage.setItem(key(userId), JSON.stringify(credentials))
    else localStorage.removeItem(key(userId))
  } catch {
    // Private mode: the device works until the tab closes, then gets a new secret.
  }
}
