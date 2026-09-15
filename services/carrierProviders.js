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
// MODO LIVE: stubs listos para completar con las APIs reales.
// Todas devuelven una promesa con la MISMA forma que mockTrackingUpdate,
// para que el resto de la app no tenga que cambiar nada.
// ---------------------------------------------------------------------
const liveProviders = {
  async fedex(trackingNumber /*, shipment */) {
    // Docs: https://developer.fedex.com/api/en-us/catalog/track/v1.html
    // Flujo tipico:
    //   1) POST /oauth/token con FEDEX_CLIENT_ID / FEDEX_CLIENT_SECRET -> access_token
    //   2) POST /track/v1/trackingnumbers con el trackingNumber y el access_token
    //   3) Mapear la respuesta (scanEvents, ubicaciones, status) a la forma de arriba
    throw new Error(
      'Integracion real de FedEx no configurada todavia. Completa services/carrierProviders.js -> liveProviders.fedex()'
    );
  },
  async ups(trackingNumber /*, shipment */) {
    // Docs: https://developer.ups.com/api/reference?loc=en_US#tag/Track
    // Flujo tipico: OAuth2 client_credentials con UPS_CLIENT_ID/SECRET,
    // luego GET /api/track/v1/details/{trackingNumber}
    throw new Error(
      'Integracion real de UPS no configurada todavia. Completa services/carrierProviders.js -> liveProviders.ups()'
    );
  },
  async dhl(trackingNumber /*, shipment */) {
    // Docs: https://developer.dhl.com/api-reference/shipment-tracking
    // Flujo tipico: GET https://api-eu.dhl.com/track/shipments?trackingNumber=...
    // con el header DHL-API-Key: DHL_API_KEY
    throw new Error(
      'Integracion real de DHL no configurada todavia. Completa services/carrierProviders.js -> liveProviders.dhl()'
    );
  },
  async usps(trackingNumber /*, shipment */) {
    // Docs: https://www.usps.com/business/web-tools-apis/track-and-confirm-api.htm
    // (USPS esta migrando a una API REST con OAuth2, revisar la doc actual)
    throw new Error(
      'Integracion real de USPS no configurada todavia. Completa services/carrierProviders.js -> liveProviders.usps()'
    );
  },
};

async function getTrackingUpdate(carrier, trackingNumber, shipment) {
  const mode = (process.env.TRACKING_MODE || 'mock').toLowerCase();
  if (mode === 'live' && liveProviders[carrier]) {
    return liveProviders[carrier](trackingNumber, shipment);
  }
  return mockTrackingUpdate(carrier, trackingNumber, shipment);
}

module.exports = { getTrackingUpdate, CARRIERS, STATUS_FLOW, STATUS_LABELS };
