import { useEffect, useState } from 'react'

/** The current time, refreshed every `intervalMs`, for "5 minutes ago" labels that stay true. */
export function useNow(intervalMs = 15_000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(timer)
  }, [intervalMs])
  return now
}
