// Capa de "proveedores" de tracking.
//
// La app siempre llama a `getTrackingUpdate(carrier, trackingNumber, shipment)`.
// Esta funcion decide, segun TRACKING_MODE, si devuelve datos simulados
// (para poder probar la app sin cuentas de courier) o si llama a la API
// real de cada courier (una vez que cargues las credenciales en .env).
//
// Para conectar una API real, completa la funcion correspondiente en
// `liveProviders` (fedex, ups, dhl, usps). Cada una ya tiene un comentario
// con el flujo general y el link a la documentacion oficial.

const CARRIERS = ['fedex', 'ups', 'dhl', 'usps'];

const STATUS_FLOW = [
  'label_created',
  'picked_up',
  'in_transit',
  'out_for_delivery',
  'delivered',
];

const STATUS_LABELS = {
  label_created: 'Etiqueta creada',
  picked_up: 'Retirado por el courier',
  in_transit: 'En transito',
  out_for_delivery: 'En reparto',
  delivered: 'Entregado',
  exception: 'Incidencia',
};

// ---------------------------------------------------------------------
// MODO MOCK: simula el avance de un envio a traves de checkpoints con
// coordenadas, para poder probar contactos + notificaciones + mapa sin
// depender de ninguna cuenta de courier todavia.
// ---------------------------------------------------------------------
function seededRandom(seed) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (Math.imul(31, h) + seed.charCodeAt(i)) | 0;
  }
  return function () {
    h = (Math.imul(h, 1664525) + 1013904223) | 0;
    return ((h >>> 0) % 1000) / 1000;
  };
}

// Algunas rutas de ejemplo (origen -> destino) para que el mapa se vea bien.
const SAMPLE_ROUTES = [
  [
    { label: 'Origen: Barcelona, ES', lat: 41.3874, lng: 2.1686 },
    { label: 'Centro de distribucion, Madrid, ES', lat: 40.4168, lng: -3.7038 },
    { label: 'Hub internacional, Paris, FR', lat: 48.8566, lng: 2.3522 },
    { label: 'Destino: Lisboa, PT', lat: 38.7223, lng: -9.1393 },
  ],
  [
    { label: 'Origen: Barcelona, ES', lat: 41.3874, lng: 2.1686 },
    { label: 'Centro de distribucion, Valencia, ES', lat: 39.4699, lng: -0.3763 },
    { label: 'Destino: Sevilla, ES', lat: 37.3891, lng: -5.9845 },
  ],
  [
    { label: 'Origen: Barcelona, ES', lat: 41.3874, lng: 2.1686 },
    { label: 'Hub, Frankfurt, DE', lat: 50.1109, lng: 8.6821 },
    { label: 'Hub, Londres, UK', lat: 51.5074, lng: -0.1278 },
    { label: 'Destino: Dublin, IE', lat: 53.3498, lng: -6.2603 },
  ],
];

function mockTrackingUpdate(carrier, trackingNumber, shipment) {
  const rand = seededRandom(carrier + trackingNumber);
  const route = SAMPLE_ROUTES[Math.floor(rand() * SAMPLE_ROUTES.length) % SAMPLE_ROUTES.length];

  // El envio "avanza" un checkpoint cada vez que se refresca, hasta llegar
  // a destino. Guardamos el progreso en el propio shipment (checkpointIndex).
  const prevIndex = typeof shipment.checkpointIndex === 'number' ? shipment.checkpointIndex : -1;
  const nextIndex = Math.min(prevIndex + 1, route.length - 1);

  const statusIndex = Math.min(nextIndex, STATUS_FLOW.length - 1);
  const status = nextIndex >= route.length - 1 ? 'delivered' : STATUS_FLOW[statusIndex];

  const checkpoints = route.slice(0, nextIndex + 1).map((point, i) => ({
    ...point,
    status: i === nextIndex ? status : 'completed',
    timestamp: new Date(Date.now() - (nextIndex - i) * 3 * 60 * 60 * 1000).toISOString(),
  }));

  return {
    status,
    statusLabel: STATUS_LABELS[status] || status,
    checkpointIndex: nextIndex,
    fullRoute: route,
    checkpoints,
    currentLocation: route[nextIndex],
    estimatedDelivery: shipment.estimatedDelivery || new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
  };
}

// ---------------------------------------------------------------------
// MODO LIVE: en vez de integrar cada courier por separado (4 flujos de
// OAuth distintos), usamos 17TRACK (https://api.17track.net) como
// agregador: una sola API key cubre FedEx/UPS/DHL/USPS y +3400 couriers
// mas, detectando el carrier automaticamente por el formato del numero.
//
// Flujo (documentado en https://api.17track.net/en/doc?version=v2.4):
//   1) POST /track/v2.4/register  - una vez por numero de tracking
//   2) POST /track/v2.4/gettrackinfo - en cada refresh, trae el estado actual
//
// Los couriers reales solo dan el nombre del lugar ("Memphis, TN, US"),
// no coordenadas: geocodificamos cada checkpoint con Nominatim
// (services/geocode.js) para poder seguir dibujando la ruta en el mapa.
//
// Nota: el schema exacto de la respuesta de 17TRACK no se pudo verificar
// contra una llamada real (hace falta tu API key para eso). El parseo de
// abajo es defensivo -a propósito- para no romper la app si algun campo
// viene con otro nombre; si algo no calza probalo con TRACKING_MODE=live
// y ajustá `parseTrack17Response()` mirando la respuesta real en los logs.
// ---------------------------------------------------------------------
const { geocodeLocation } = require('./geocode');

const TRACK17_BASE = 'https://api.17track.net/track/v2.4';

const TRACK17_STATUS_MAP = {
  NotFound: 'label_created',
  InfoReceived: 'label_created',
  InTransit: 'in_transit',
  Expired: 'exception',
  AvailableForPickup: 'out_for_delivery',
  OutForDelivery: 'out_for_delivery',
  DeliveryFailure: 'exception',
  Delivered: 'delivered',
  Exception: 'exception',
};

async function track17Request(path, body) {
  const apiKey = process.env.TRACK17_API_KEY;
  if (!apiKey) {
    throw new Error('Falta TRACK17_API_KEY en .env. Registrate en https://api.17track.net para conseguir una.');
  }
  const res = await fetch(`${TRACK17_BASE}/${path}`, {
    method: 'POST',
    headers: { '17token': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`17TRACK ${path} respondio ${res.status}: ${JSON.stringify(data).slice(0, 200)}`);
  }
  return data;
}

async function ensureRegistered(trackingNumber, shipment) {
  if (shipment.track17Registered) return;
  // No mandamos "carrier": 17TRACK autodetecta por el formato del numero,
  // asi cubrimos FedEx/UPS/DHL/USPS (y el resto) con el mismo codigo.
  await track17Request('register', [{ number: trackingNumber }]);
}

async function parseTrack17Response(data, trackingNumber) {
  const entry =
    data?.data?.accepted?.find((x) => x.number === trackingNumber) ||
    data?.data?.accepted?.[0];
  const trackInfo = entry?.track_info;
  if (!trackInfo) {
    // Todavia no hay datos (recien registrado, el courier no reporto nada aun).
    return {
      status: 'label_created',
      statusLabel: STATUS_LABELS.label_created,
      checkpointIndex: -1,
      fullRoute: [],
      checkpoints: [],
      currentLocation: null,
      estimatedDelivery: null,
    };
  }

  const mainStatus = trackInfo.latest_status?.status || 'InfoReceived';
  const status = TRACK17_STATUS_MAP[mainStatus] || 'in_transit';

  const rawEvents = trackInfo.tracking?.providers?.[0]?.events || [];
  const orderedEvents = [...rawEvents].reverse(); // 17TRACK los da mas nuevo -> mas viejo

  const geocoded = [];
  for (const ev of orderedEvents) {
    const label = ev.description || ev.status_description || ev.location || 'Checkpoint';
    const point = ev.location ? await geocodeLocation(ev.location) : null;
    const timestamp = ev.time_iso || ev.time_utc || ev.time_raw?.date || new Date().toISOString();
    geocoded.push({
      label: ev.location ? `${label} · ${ev.location}` : label,
      lat: point?.lat ?? null,
      lng: point?.lng ?? null,
      timestamp,
    });
  }

  // El mapa necesita coordenadas: si alguna no se pudo geocodificar, la
  // sacamos de la ruta (pero el checkpoint sigue listado en el timeline).
  const fullRoute = geocoded.filter((p) => p.lat != null && p.lng != null);
  const checkpoints = geocoded.map((p) => ({
    label: p.label,
    timestamp: p.timestamp,
    status,
  }));

  return {
    status,
    statusLabel: STATUS_LABELS[status] || mainStatus,
    checkpointIndex: fullRoute.length - 1,
    fullRoute,
    checkpoints,
    currentLocation: fullRoute[fullRoute.length - 1] || null,
    estimatedDelivery: trackInfo.time_metrics?.estimated_delivery_date?.from || null,
    track17Registered: true,
  };
}

const liveProviders = {
  async fedex(trackingNumber, shipment) { return track17Provider(trackingNumber, shipment); },
  async ups(trackingNumber, shipment) { return track17Provider(trackingNumber, shipment); },
  async dhl(trackingNumber, shipment) { return track17Provider(trackingNumber, shipment); },
  async usps(trackingNumber, shipment) { return track17Provider(trackingNumber, shipment); },
};

async function track17Provider(trackingNumber, shipment) {
  await ensureRegistered(trackingNumber, shipment);
  const data = await track17Request('gettrackinfo', [{ number: trackingNumber }]);
  const result = await parseTrack17Response(data, trackingNumber);
  result.track17Registered = true;
  return result;
}

async function getTrackingUpdate(carrier, trackingNumber, shipment) {
  const mode = (process.env.TRACKING_MODE || 'mock').toLowerCase();
  if (mode === 'live' && liveProviders[carrier]) {
    return liveProviders[carrier](trackingNumber, shipment);
  }
  return mockTrackingUpdate(carrier, trackingNumber, shipment);
}

module.exports = { getTrackingUpdate, CARRIERS, STATUS_FLOW, STATUS_LABELS };
