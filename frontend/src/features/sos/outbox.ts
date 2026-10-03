import { useSyncExternalStore } from 'react'

import { createSos } from './api'
import type { Fix } from './geo'

/** An SOS pressed while the API was unreachable, waiting to be sent. */
export type QueuedSos = {
  clientId: string
  /** When it was really pressed; the server keeps this as the trigger time. */
  occurredAt: string
  fix: Fix | null
  batteryPct: number | null
}

type Sent = { clientId: string; incidentId: string }
type State = { pending: QueuedSos[]; sent: Sent[] }

const DB = 'womens-safety'
const STORE = 'sos-outbox'

// --- Storage: IndexedDB (survives reloads and closing the tab), memory when it isn't there. ---

const memory = new Map<string, QueuedSos>()

function openDb(): Promise<IDBDatabase> | null {
  if (typeof indexedDB === 'undefined') return null
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'clientId' })
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T | null> {
  const opening = openDb()
  if (!opening) return null
  try {
    const db = await opening
    return await new Promise<T>((resolve, reject) => {
      const request = run(db.transaction(STORE, mode).objectStore(STORE))
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  } catch {
    return null // Private mode or blocked storage: the memory copy still works for this session.
  }
}

async function readAll(): Promise<QueuedSos[]> {
  const stored = (await withStore('readonly', (s) => s.getAll() as IDBRequest<QueuedSos[]>)) ?? []
  const byId = new Map(stored.map((item) => [item.clientId, item]))
  for (const item of memory.values()) byId.set(item.clientId, item)
  return [...byId.values()].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt))
}

// --- A small store the screens subscribe to. ---

let state: State = { pending: [], sent: [] }
const listeners = new Set<() => void>()

function setState(next: State) {
  state = next
  listeners.forEach((listener) => listener())
}

export function useOutbox() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => state,
  )
}

/** Loads anything left in the queue from a previous visit. */
export async function loadOutbox() {
  setState({ ...state, pending: await readAll() })
}

export async function enqueueSos(item: QueuedSos) {
  memory.set(item.clientId, item)
  await withStore('readwrite', (s) => s.put(item))
  setState({ ...state, pending: await readAll() })
}

async function remove(clientId: string) {
  memory.delete(clientId)
  await withStore('readwrite', (s) => s.delete(clientId))
}

/** A failure that a retry can fix: no connection, or the server couldn't be reached. */
export function isNetworkError(error: unknown) {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true
  const message = error instanceof Error ? error.message : String(error)
  return /failed to fetch|networkerror|load failed|network request failed|fetch failed/i.test(
    message,
  )
}

/**
 * Sends every queued SOS with its original trigger time. The client id makes this safe to repeat:
 * a retry never creates a second incident. Returns how many are still waiting.
 */
export async function flushOutbox(send: typeof createSos = createSos) {
  const sent: Sent[] = []
  for (const item of await readAll()) {
    try {
      const result = await send(item.clientId, item.fix, item.batteryPct, item.occurredAt)
      await remove(item.clientId)
      sent.push({ clientId: item.clientId, incidentId: result.incident_id })
    } catch (error) {
      // Too old to send (over a day): drop it. Anything else waits for the next try.
      if (/more than a day old/.test(String(error))) await remove(item.clientId)
    }
  }
  const pending = await readAll()
  setState({ pending, sent: [...state.sent, ...sent] })
  return pending.length
}

/** For tests: empty the queue and the store. */
export async function resetOutbox() {
  for (const item of await readAll()) await remove(item.clientId)
  setState({ pending: [], sent: [] })
}
