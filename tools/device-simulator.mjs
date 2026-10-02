#!/usr/bin/env node
// Command-line virtual wearable: sends the same HMAC-signed events as the ESP32 keychain will
// (docs/05-device-protocol.md). No dependencies; needs Node 18 or newer.
//
//   DEVICE_ID=... DEVICE_SECRET=... node tools/device-simulator.mjs demo
//
// Get DEVICE_ID and DEVICE_SECRET from the app: Wearables -> Virtual wearable -> "For developers".
// SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY default to frontend/.env.production.

import { createHmac, randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { parseArgs } from 'node:util'

const HELP = `Usage: node tools/device-simulator.mjs <command> [options]

Commands
  sos                 Long press: start an SOS at the current position
  walk                Send location along the demo route (Connaught Place to Janpath, New Delhi)
  demo                sos, then walk the whole route
  heartbeat           Battery and signal report
  battery-low         Low-battery warning
  tamper              Case opened
  gesture             Button clicks (--clicks 1 or 2)

Options
  --lat, --lng        Position (default: start of the demo route, or the walk's current point)
  --battery <pct>     Battery level to report (default 80)
  --steps <n>         Points to walk (default: the whole route)
  --every <seconds>   Seconds between walk updates (default 3)
  --start <n>         Route point to start walking from (default 0)
  --clicks <1|2>      For gesture (default 1)

Environment
  DEVICE_ID, DEVICE_SECRET               from the app (required)
  SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY default to frontend/.env.production`

// Same waypoints as frontend/src/features/devices/demo-route.ts, as [lng, lat].
const WAYPOINTS = [
  [77.2196, 28.6328],
  [77.2208, 28.6315],
  [77.2201, 28.6299],
  [77.2193, 28.6276],
  [77.2188, 28.625],
  [77.2185, 28.6223],
  [77.2188, 28.6198],
  [77.2197, 28.617],
]

function distanceM([aLng, aLat], [bLng, bLat]) {
  const toRad = (deg) => (deg * Math.PI) / 180
  const h =
    Math.sin(toRad(bLat - aLat) / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(toRad(bLng - aLng) / 2) ** 2
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h))
}

function route(stepM = 20) {
  const round6 = (v) => Math.round(v * 1e6) / 1e6
  const points = []
  for (let i = 0; i < WAYPOINTS.length - 1; i++) {
    const [a, b] = [WAYPOINTS[i], WAYPOINTS[i + 1]]
    const steps = Math.max(1, Math.round(distanceM(a, b) / stepM))
    for (let s = 0; s < steps; s++) {
      const t = s / steps
      points.push([round6(a[0] + (b[0] - a[0]) * t), round6(a[1] + (b[1] - a[1]) * t)])
    }
  }
  points.push(WAYPOINTS.at(-1))
  return points
}

function readEnvFile(path) {
  try {
    return Object.fromEntries(
      readFileSync(path, 'utf8')
        .split('\n')
        .map((line) => line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/))
        .filter(Boolean)
        .map(([, key, value]) => [key, value.replace(/^["']|["']$/g, '')]),
    )
  } catch {
    return {}
  }
}

function config() {
  const file = readEnvFile(new URL('../frontend/.env.production', import.meta.url))
  const env = {
    url: process.env.SUPABASE_URL ?? file.VITE_SUPABASE_URL,
    key: process.env.SUPABASE_PUBLISHABLE_KEY ?? file.VITE_SUPABASE_PUBLISHABLE_KEY,
    deviceId: process.env.DEVICE_ID,
    secret: process.env.DEVICE_SECRET,
  }
  const missing = Object.entries({
    SUPABASE_URL: env.url,
    SUPABASE_PUBLISHABLE_KEY: env.key,
    DEVICE_ID: env.deviceId,
    DEVICE_SECRET: env.secret,
  })
    .filter(([, value]) => !value)
    .map(([name]) => name)
  if (missing.length) {
    console.error(`Missing ${missing.join(', ')}.\n\n${HELP}`)
    process.exit(2)
  }
  return env
}

/** Builds, signs and posts one event, exactly as the firmware does. */
async function send(env, type, fields = {}) {
  const body = JSON.stringify({
    type,
    ts: Math.floor(Date.now() / 1000),
    nonce: randomBytes(8).toString('hex'),
    ...fields,
  })
  const signature = createHmac('sha256', env.secret).update(body).digest('hex')
  const response = await fetch(`${env.url.replace(/\/$/, '')}/rest/v1/rpc/device_event`, {
    method: 'POST',
    headers: { apikey: env.key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_device_id: env.deviceId, p_body: body, p_signature: signature }),
  })
  const result = await response.json().catch(() => ({}))
  const where = fields.lat !== undefined ? ` at ${fields.lat}, ${fields.lng}` : ''
  if (!response.ok) {
    console.error(`✗ ${type}${where}: ${result.message ?? `HTTP ${response.status}`}`)
    return null
  }
  const incident = result.incident_id ? ` → SOS ${result.incident_id}` : ''
  console.log(`✓ ${type}${where}${incident}`)
  return result
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function main() {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      lat: { type: 'string' },
      lng: { type: 'string' },
      battery: { type: 'string', default: '80' },
      steps: { type: 'string' },
      every: { type: 'string', default: '3' },
      start: { type: 'string', default: '0' },
      clicks: { type: 'string', default: '1' },
      help: { type: 'boolean', short: 'h' },
    },
  })
  const command = positionals[0]
  if (!command || values.help) {
    console.log(HELP)
    return
  }

  const env = config()
  const points = route()
  const battery = Number(values.battery)
  const start = Math.min(Number(values.start), points.length - 1)
  const here =
    values.lat && values.lng
      ? { lat: Number(values.lat), lng: Number(values.lng) }
      : { lat: points[start][1], lng: points[start][0] }
  const at = (p) => ({ ...p, accuracy_m: 8, battery_pct: battery })

  async function walk(from) {
    const last = values.steps ? Math.min(from + Number(values.steps), points.length - 1) : points.length - 1
    for (let i = from + 1; i <= last; i++) {
      await sleep(Number(values.every) * 1000)
      await send(env, 'location', at({ lat: points[i][1], lng: points[i][0] }))
    }
  }

  switch (command) {
    case 'sos':
      await send(env, 'sos', at(here))
      break
    case 'walk':
      await send(env, 'location', at(here))
      await walk(start)
      break
    case 'demo':
      if (!(await send(env, 'sos', at(here)))) process.exit(1)
      await walk(start)
      break
    case 'heartbeat':
      await send(env, 'heartbeat', { battery_pct: battery, signal_dbm: -71 })
      break
    case 'battery-low':
      await send(env, 'battery_low', { battery_pct: Math.min(battery, 15) })
      break
    case 'tamper':
      await send(env, 'tamper', { ...at(here), reason: 'case_opened' })
      break
    case 'gesture':
      await send(env, 'gesture', { clicks: Number(values.clicks) === 2 ? 2 : 1 })
      break
    default:
      console.error(`Unknown command "${command}".\n\n${HELP}`)
      process.exit(2)
  }
}

await main()
