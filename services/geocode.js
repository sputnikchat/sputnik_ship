// Converts place names ("Memphis, TN, US") into lat/lng coordinates
// using Nominatim (OpenStreetMap) - the same provider the frontend map
// already uses. Real couriers only give the place name, not
// coordinates, so this is what keeps the route drawable on the map
// with real tracking data.
//
// Nominatim's courtesy policy asks for: max ~1 request/sec and a
// User-Agent identifying the app (https://operations.osmfoundation.org/policies/nominatim/).
// That's why we cache in memory (the same hub shows up across many
// shipments) and space out new calls.

const cache = new Map();
let lastCallAt = 0;

async function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Nominatim refuses or rate-limits a lot of shared cloud IPs (Render's
// included), so a failed lookup falls back to Photon (komoot's free
// geocoder over the same OpenStreetMap data). Only definite answers are
// cached: caching a network error as "no coordinates" used to leave a
// shipment's map empty forever.
const USER_AGENT = 'SputnikShip/1.0 (personal shipment tracker; hello.chefjoice@gmail.com)';

async function nominatim(key) {
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(key)}`;
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error(`Nominatim responded ${res.status}`);
  const results = await res.json();
  return results && results[0] ? { lat: Number(results[0].lat), lng: Number(results[0].lon) } : null;
}

async function photon(key) {
  const url = `https://photon.komoot.io/api/?limit=1&q=${encodeURIComponent(key)}`;
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error(`Photon responded ${res.status}`);
  const coords = (await res.json())?.features?.[0]?.geometry?.coordinates;
  return coords ? { lat: Number(coords[1]), lng: Number(coords[0]) } : null;
}

async function geocodeLocation(text) {
  const key = String(text || '').trim().toLowerCase();
  if (!key) return null;
  if (cache.has(key)) return cache.get(key);

  // Space out new calls (not the ones that hit cache).
  const elapsed = Date.now() - lastCallAt;
  if (elapsed < 1100) await wait(1100 - elapsed);
  lastCallAt = Date.now();

  for (const provider of [nominatim, photon]) {
    try {
      const point = await provider(key);
      if (point) {
        cache.set(key, point);
        return point;
      }
    } catch (err) {
      console.error(`Could not geocode "${text}" with ${provider.name}:`, err.message);
    }
  }
  return null;
}

module.exports = { geocodeLocation };
