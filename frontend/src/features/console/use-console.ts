import { useQuery, useQueryClient } from '@tanstack/react-query'

import { useAuth } from '@/features/auth/auth-context'
import { fallbackInterval, useLiveChannel } from '@/lib/realtime'

import { consoleKeys, fetchBoard, fetchMemberships } from './api'

/** The district control room: admins and oversight, who belong nowhere, listen here. */
export const CONTROL_ROOM_ID = '00000000-0000-4000-8000-000000000001'

/** The signed-in staff member's profile and organisations. */
export function useStaff() {
  const auth = useAuth()
  const profile = auth.status === 'signed-in' ? auth.profile : null
  const memberships = useQuery({
    queryKey: consoleKeys.memberships(profile?.id ?? ''),
    queryFn: () => fetchMemberships(profile!.id),
    enabled: !!profile,
  })
  return { profile, memberships }
}

/**
 * Live updates for the console. The database pings `org:<id>` for the handling station and every
 * organisation above it, so one topic per membership covers everything the board can show.
 * Returns whether the topic is connected.
 */
export function useOrgChannel(orgId: string | null) {
  const queryClient = useQueryClient()
  return useLiveChannel(orgId ? `org:${orgId}` : null, () => {
    void queryClient.invalidateQueries({ queryKey: ['console'] })
  })
}

/** The organisation whose topic this person listens to. */
export function useListenOrg() {
  const { profile, memberships } = useStaff()
  if (!profile) return null
  // A station member hears their station (pings go up the tree, never down); everyone else, the
  // control room, which hears every station below it.
  const own = memberships.data?.[0]?.org_id
  if (own && profile.role !== 'admin' && profile.role !== 'oversight') return own
  return memberships.isPending ? null : CONTROL_ROOM_ID
}

/** The active incidents this person may see, refreshed live. */
export function useBoard() {
  const live = useOrgChannel(useListenOrg())
  const board = useQuery({
    queryKey: consoleKeys.board,
    queryFn: fetchBoard,
    refetchInterval: fallbackInterval(live),
  })
  return { board, live }
}
