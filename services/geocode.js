// Convierte nombres de lugar ("Memphis, TN, US") en coordenadas lat/lng
// usando Nominatim (OpenStreetMap) - el mismo proveedor que ya usa el mapa
// en el frontend. Los couriers reales (via 17TRACK) solo dan el nombre del
// lugar, no coordenadas, asi que esto es lo que permite seguir dibujando
// la ruta en el mapa con datos de tracking reales.
//
// Nominatim pide como cortesia: maximo ~1 request/seg y un User-Agent que
// identifique la app (https://operations.osmfoundation.org/policies/nominatim/).
// Por eso cacheamos en memoria (un mismo hub aparece en muchos envios) y
// espaciamos las llamadas nuevas.

const cache = new Map();
let lastCallAt = 0;

async function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function geocodeLocation(text) {
  const key = String(text || '').trim().toLowerCase();
  if (!key) return null;
  if (cache.has(key)) return cache.get(key);

  // Espaciamos las llamadas nuevas a Nominatim (no las que pegan en cache).
  const elapsed = Date.now() - lastCallAt;
  if (elapsed < 1100) await wait(1100 - elapsed);
  lastCallAt = Date.now();

  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(key)}`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'SputnikShip/1.0 (tracking de envios personal; hello.chefjoice@gmail.com)' },
    });
    if (!res.ok) throw new Error(`Nominatim respondio ${res.status}`);
    const results = await res.json();
    const point = results && results[0]
      ? { lat: Number(results[0].lat), lng: Number(results[0].lon) }
      : null;
    cache.set(key, point);
    return point;
  } catch (err) {
    console.error(`No se pudo geocodificar "${text}":`, err.message);
    cache.set(key, null);
    return null;
  }
}

module.exports = { geocodeLocation };
