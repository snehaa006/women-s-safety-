export type MapViewProps = {
  /** The route travelled so far, as [lng, lat] pairs, oldest first. */
  path: [number, number][]
  /** Where the person is now. Defaults to the last point of `path`. */
  current?: { lat: number; lng: number } | null
  /** A planned route drawn dashed under the path (the virtual wearable's demo walk). */
  routePreview?: [number, number][]
  /** Places drawn as dots: police stations blue, hospitals green. */
  points?: { lat: number; lng: number; name: string; category: string }[]
  /** Keep the map centred on the current position. */
  follow?: boolean
  className?: string
  /** Accessible description of what the map shows. */
  label?: string
}
