import 'maplibre-gl/dist/maplibre-gl.css'

import type { Feature, FeatureCollection, LineString, Point, Polygon } from 'geojson'
import {
  Map as MapLibre,
  Marker,
  NavigationControl,
  setWorkerUrl,
  type GeoJSONSource,
} from 'maplibre-gl'
// MapLibre loads its worker from a URL next to its own module, which a bundle doesn't keep.
// Vite bundles the worker (with the code it imports) and gives us its URL instead.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import { useEffect, useRef, useState } from 'react'

import { cn } from '@/lib/utils'

import type { MapViewProps } from './types'

setWorkerUrl(workerUrl)

// OpenFreeMap: free OpenStreetMap vector tiles, no API key or usage limits.
const STYLE_LIGHT = 'https://tiles.openfreemap.org/styles/liberty'
const STYLE_DARK = 'https://tiles.openfreemap.org/styles/dark'
const NEW_DELHI: [number, number] = [77.209, 28.6139]
const RED = '#d32f45'

function line(coordinates: [number, number][]): Feature<LineString> {
  return { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates } }
}

function dots(points: NonNullable<MapViewProps['points']>): FeatureCollection<Point> {
  return {
    type: 'FeatureCollection',
    features: points.map((p) => ({
      type: 'Feature',
      properties: { name: p.name, category: p.category },
      geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
    })),
  }
}

function cellShapes(cells: NonNullable<MapViewProps['cells']>): FeatureCollection<Polygon> {
  return {
    type: 'FeatureCollection',
    features: cells.map(({ bounds: [w, s, e, n], level }) => ({
      type: 'Feature',
      properties: { level },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [w, s],
            [e, s],
            [e, n],
            [w, n],
            [w, s],
          ],
        ],
      },
    })),
  }
}

function routeLines(routes: NonNullable<MapViewProps['routes']>): FeatureCollection<LineString> {
  return {
    type: 'FeatureCollection',
    // The selected route last, so it draws on top.
    features: [...routes]
      .sort((a, b) => Number(!!a.selected) - Number(!!b.selected))
      .map((r) => ({
        type: 'Feature',
        properties: {
          color: r.color,
          width: r.selected ? 6 : 3,
          opacity: r.selected ? 0.95 : 0.55,
        },
        geometry: { type: 'LineString', coordinates: r.coordinates },
      })),
  }
}

export default function MapView({
  path,
  current,
  routePreview,
  points,
  cells,
  routes,
  destination,
  onPick,
  follow = true,
  className,
  label,
}: MapViewProps) {
  const container = useRef<HTMLDivElement>(null)
  const map = useRef<MapLibre | null>(null)
  const marker = useRef<Marker | null>(null)
  const destMarker = useRef<Marker | null>(null)
  const pick = useRef(onPick)
  useEffect(() => {
    pick.current = onPick
  })
  const ready = useRef(false)
  const apply = useRef<() => void>(() => {})
  const [failed, setFailed] = useState(false)

  const last = path.at(-1)
  const latest = current ?? (last ? { lng: last[0], lat: last[1] } : null)

  useEffect(() => {
    if (!container.current) return
    const dark = document.documentElement.classList.contains('dark')
    let instance: MapLibre
    try {
      instance = new MapLibre({
        container: container.current,
        style: dark ? STYLE_DARK : STYLE_LIGHT,
        center: NEW_DELHI,
        zoom: 11,
        attributionControl: { compact: true },
      })
    } catch {
      queueMicrotask(() => setFailed(true)) // No WebGL.
      return
    }
    instance.addControl(new NavigationControl({ showCompass: false }), 'top-right')
    instance.on('click', (event) =>
      pick.current?.({ lat: event.lngLat.lat, lng: event.lngLat.lng }),
    )
    instance.on('load', () => {
      instance.addSource('cells', { type: 'geojson', data: cellShapes([]) })
      instance.addLayer({
        id: 'cells',
        type: 'fill',
        source: 'cells',
        paint: {
          'fill-color': ['match', ['get', 'level'], 'high', RED, 'medium', '#e8a317', '#9ca3af'],
          'fill-opacity': 0.35,
        },
      })
      instance.addSource('alternatives', { type: 'geojson', data: routeLines([]) })
      instance.addLayer({
        id: 'alternatives',
        type: 'line',
        source: 'alternatives',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': ['get', 'color'],
          'line-width': ['get', 'width'],
          'line-opacity': ['get', 'opacity'],
        },
      })
      instance.addSource('route', { type: 'geojson', data: line([]) })
      instance.addLayer({
        id: 'route',
        type: 'line',
        source: 'route',
        paint: { 'line-color': '#6b7280', 'line-width': 3, 'line-dasharray': [2, 2] },
      })
      instance.addSource('points', { type: 'geojson', data: dots([]) })
      instance.addLayer({
        id: 'points',
        type: 'circle',
        source: 'points',
        paint: {
          'circle-radius': 7,
          'circle-color': [
            'match',
            ['get', 'category'],
            'police',
            '#2547b8',
            'hospital',
            '#0f8a5f',
            'sos',
            RED,
            '#6b7280',
          ],
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 2,
        },
      })
      instance.addSource('path', { type: 'geojson', data: line([]) })
      instance.addLayer({
        id: 'path',
        type: 'line',
        source: 'path',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': RED, 'line-width': 5, 'line-opacity': 0.85 },
      })
      ready.current = true
      apply.current()
    })
    map.current = instance
    return () => {
      ready.current = false
      marker.current = null
      destMarker.current = null
      map.current = null
      instance.remove()
    }
  }, [])

  // Pushes the current props into the map. Kept in a ref so the load handler can run it too.
  const lat = latest?.lat
  const lng = latest?.lng
  useEffect(() => {
    apply.current = () => {
      const instance = map.current
      if (!instance || !ready.current) return
      instance.getSource<GeoJSONSource>('path')?.setData(line(path))
      instance.getSource<GeoJSONSource>('route')?.setData(line(routePreview ?? []))
      instance.getSource<GeoJSONSource>('points')?.setData(dots(points ?? []))
      instance.getSource<GeoJSONSource>('cells')?.setData(cellShapes(cells ?? []))
      instance.getSource<GeoJSONSource>('alternatives')?.setData(routeLines(routes ?? []))
      if (destination) {
        if (!destMarker.current) {
          destMarker.current = new Marker({ color: '#2547b8' })
            .setLngLat([destination.lng, destination.lat])
            .addTo(instance)
        } else {
          destMarker.current.setLngLat([destination.lng, destination.lat])
        }
      } else if (destMarker.current) {
        destMarker.current.remove()
        destMarker.current = null
      }
      if (lat === undefined || lng === undefined) return
      if (!marker.current) {
        const dot = document.createElement('div')
        dot.className = 'size-5 rounded-full border-[3px] border-white shadow-md'
        dot.style.background = RED
        marker.current = new Marker({ element: dot }).setLngLat([lng, lat]).addTo(instance)
        instance.jumpTo({ center: [lng, lat], zoom: 15 })
      } else {
        marker.current.setLngLat([lng, lat])
        if (follow) instance.easeTo({ center: [lng, lat], duration: 600 })
      }
    }
    apply.current()
  }, [path, routePreview, points, cells, routes, destination, lat, lng, follow])

  if (failed) {
    return (
      <div
        className={cn(
          'bg-muted text-muted-foreground grid place-content-center rounded-lg p-4 text-center text-sm',
          className,
        )}
      >
        The map can't load on this device. The location details below still update.
      </div>
    )
  }

  return (
    <div
      ref={container}
      role="img"
      aria-label={label ?? 'Map'}
      className={cn('overflow-hidden rounded-lg border', className)}
    />
  )
}
