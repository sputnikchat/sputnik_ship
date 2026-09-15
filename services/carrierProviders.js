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
// OAuth distintos), usamos Ship24 (https://ship24.com) como agregador:
// una sola API key cubre FedEx/UPS/DHL/USPS y +2500 couriers mas,
// detectando el carrier automaticamente por el formato del numero.
//
// Flujo (documentado en https://docs.ship24.com, spec OpenAPI en
// https://docs.ship24.com/assets/openapi/ship24-tracking-api.yaml):
//   POST /public/v1/trackers/track  con { trackingNumber }
//   Este endpoint es idempotente: crea el tracker la primera vez y
//   despues siempre devuelve los resultados actuales - un solo llamado
//   por refresh nos alcanza, sin pasos separados de registro/consulta.
//
// Los couriers reales solo dan el nombre del lugar de cada evento
// ("Memphis, TN, US"), no coordenadas: geocodificamos cada checkpoint
// con Nominatim (services/geocode.js) para poder seguir dibujando la
// ruta en el mapa.
// ---------------------------------------------------------------------
const { geocodeLocation } = require('./geocode');

const SHIP24_BASE = 'https://api.ship24.com/public/v1';

// Los 8 milestones oficiales (docs.ship24.com/status/#statusmilestone,
// via el skill ship24-tracking-statuses instalado en este proyecto).
const SHIP24_MILESTONE_MAP = {
  pending: 'label_created',
  info_received: 'label_created',
  in_transit: 'in_transit',
  available_for_pickup: 'out_for_delivery',
  out_for_delivery: 'out_for_delivery',
  delivered: 'delivered',
  failed_attempt: 'exception',
  exception: 'exception',
};

async function ship24Track(trackingNumber) {
  const apiKey = process.env.SHIP24_API_KEY;
  if (!apiKey) {
    throw new Error('Falta SHIP24_API_KEY en .env. Registrate en https://www.ship24.com/tracking-api para conseguir una.');
  }
  const res = await fetch(`${SHIP24_BASE}/trackers/track`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ trackingNumber }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Ship24 respondio ${res.status}: ${JSON.stringify(data).slice(0, 200)}`);
  }
  return data;
}

async function parseShip24Response(data) {
  const tracking = data?.data?.trackings?.[0];
  if (!tracking) {
    // Recien creado, el courier todavia no reporto nada.
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

  const milestone = tracking.shipment?.statusMilestone || 'info_received';
  const status = SHIP24_MILESTONE_MAP[milestone] || 'in_transit';

  const rawEvents = tracking.events || [];
  const orderedEvents = [...rawEvents].sort(
    (a, b) => new Date(a.occurrenceDatetime) - new Date(b.occurrenceDatetime)
  );

  const geocoded = [];
  for (const ev of orderedEvents) {
    const label = ev.status || ev.location || 'Checkpoint';
    const point = ev.location ? await geocodeLocation(ev.location) : null;
    geocoded.push({
      label: ev.location ? `${label} · ${ev.location}` : label,
      lat: point?.lat ?? null,
      lng: point?.lng ?? null,
      timestamp: ev.occurrenceDatetime || new Date().toISOString(),
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

  const estimatedDelivery =
    tracking.shipment?.delivery?.estimatedDeliveryDate ||
    tracking.shipment?.delivery?.courierEstimatedDeliveryDate?.from ||
    null;

  return {
    status,
    statusLabel: STATUS_LABELS[status] || milestone,
    checkpointIndex: fullRoute.length - 1,
    fullRoute,
    checkpoints,
    currentLocation: fullRoute[fullRoute.length - 1] || null,
    estimatedDelivery,
  };
}

async function ship24Provider(trackingNumber) {
  const data = await ship24Track(trackingNumber);
  return parseShip24Response(data);
}

const liveProviders = {
  async fedex(trackingNumber) { return ship24Provider(trackingNumber); },
  async ups(trackingNumber) { return ship24Provider(trackingNumber); },
  async dhl(trackingNumber) { return ship24Provider(trackingNumber); },
  async usps(trackingNumber) { return ship24Provider(trackingNumber); },
};

async function getTrackingUpdate(carrier, trackingNumber, shipment) {
  const mode = (process.env.TRACKING_MODE || 'mock').toLowerCase();
  if (mode === 'live' && liveProviders[carrier]) {
    return liveProviders[carrier](trackingNumber, shipment);
  }
  return mockTrackingUpdate(carrier, trackingNumber, shipment);
}

module.exports = { getTrackingUpdate, CARRIERS, STATUS_FLOW, STATUS_LABELS };
