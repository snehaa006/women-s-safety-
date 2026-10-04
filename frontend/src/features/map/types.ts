export type MapViewProps = {
  /** The route travelled so far, as [lng, lat] pairs, oldest first. */
  path: [number, number][]
  /** Where the person is now. Defaults to the last point of `path`. */
  current?: { lat: number; lng: number } | null
  /** A planned route drawn dashed under the path (the virtual wearable's demo walk). */
  routePreview?: [number, number][]
  /** Places drawn as dots: police stations blue, hospitals green. */
  points?: { lat: number; lng: number; name: string; category: string }[]
  /** Aggregated risk cells, [west, south, east, north] in degrees. */
  cells?: { bounds: [number, number, number, number]; level: 'low' | 'medium' | 'high' }[]
  /** Route options, drawn under the path; the selected one is drawn on top and thicker. */
  routes?: { coordinates: [number, number][]; color: string; selected?: boolean }[]
  /** A destination pin. */
  destination?: { lat: number; lng: number } | null
  /** Called with the tapped position (used to pick a destination or a place to report). */
  onPick?: (point: { lat: number; lng: number }) => void
  /** Keep the map centred on the current position. */
  follow?: boolean
  className?: string
  /** Accessible description of what the map shows. */
  label?: string
}
