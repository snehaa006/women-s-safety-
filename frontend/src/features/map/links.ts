/** Opens the point in the phone's maps app (Google Maps on Android, the web elsewhere). */
export function mapsLink(lat: number, lng: number) {
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`
}
