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

async function geocodeLocation(text) {
  const key = String(text || '').trim().toLowerCase();
  if (!key) return null;
  if (cache.has(key)) return cache.get(key);

  // Space out new calls to Nominatim (not the ones that hit cache).
  const elapsed = Date.now() - lastCallAt;
  if (elapsed < 1100) await wait(1100 - elapsed);
  lastCallAt = Date.now();

  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(key)}`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'SputnikShip/1.0 (personal shipment tracker; hello.chefjoice@gmail.com)' },
    });
    if (!res.ok) throw new Error(`Nominatim responded ${res.status}`);
    const results = await res.json();
    const point = results && results[0]
      ? { lat: Number(results[0].lat), lng: Number(results[0].lon) }
      : null;
    cache.set(key, point);
    return point;
  } catch (err) {
    console.error(`Could not geocode "${text}":`, err.message);
    cache.set(key, null);
    return null;
  }
}

module.exports = { geocodeLocation };
