/** A position fix in the shape the API takes. */
export type Fix = {
  lat: number
  lng: number
  accuracy: number | null
  speed: number | null
  heading: number | null
  at: number
}

export function toFix(position: GeolocationPosition): Fix {
  const { latitude, longitude, accuracy, speed, heading } = position.coords
  return {
    lat: round6(latitude),
    lng: round6(longitude),
    accuracy: Number.isFinite(accuracy) ? Math.round(accuracy) : null,
    speed: speed !== null && Number.isFinite(speed) && speed >= 0 ? speed : null,
    heading: heading !== null && Number.isFinite(heading) && heading >= 0 ? heading % 360 : null,
    at: position.timestamp,
  }
}

export function round6(value: number) {
  return Math.round(value * 1e6) / 1e6
}

/**
 * One position fix, or null if it takes too long or is refused. An SOS never waits longer than
 * `timeoutMs` for GPS: it is sent without a location, and the live stream fills it in.
 */
export function currentFix(timeoutMs = 3000): Promise<Fix | null> {
  if (!('geolocation' in navigator)) return Promise.resolve(null)
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), timeoutMs)
    navigator.geolocation.getCurrentPosition(
      (position) => {
        clearTimeout(timer)
        resolve(toFix(position))
      },
      () => {
        clearTimeout(timer)
        resolve(null)
      },
      { enableHighAccuracy: true, maximumAge: 30_000, timeout: timeoutMs },
    )
  })
}

type BatteryManager = { level: number }

/** Battery level in percent where the browser shares it (Chrome, Edge, Android), else null. */
export async function batteryPct(): Promise<number | null> {
  const nav = navigator as Navigator & { getBattery?: () => Promise<BatteryManager> }
  try {
    const battery = await nav.getBattery?.()
    return battery ? Math.round(battery.level * 100) : null
  } catch {
    return null
  }
}

/** Distance in metres between two points (haversine). */
export function distanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const r = 6_371_000
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * r * Math.asin(Math.sqrt(h))
}
