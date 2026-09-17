// Tracking "provider" layer.
//
// The app always calls `getTrackingUpdate(carrier, trackingNumber, shipment)`.
// This function decides, based on TRACKING_MODE, whether to return
// simulated data (so you can test the app without courier accounts) or
// call each courier's real API (once you've loaded credentials in .env).
//
// To connect a real API, fill in the corresponding function in
// `liveProviders` (fedex, ups, dhl, usps). Each one already has a
// comment with the general flow and a link to the official docs.

const CARRIERS = ['fedex', 'ups', 'dhl', 'usps'];

const STATUS_FLOW = [
  'label_created',
  'picked_up',
  'in_transit',
  'out_for_delivery',
  'delivered',
];

const STATUS_LABELS = {
  label_created: 'Label created',
  picked_up: 'Picked up by courier',
  in_transit: 'In transit',
  out_for_delivery: 'Out for delivery',
  delivered: 'Delivered',
  exception: 'Exception',
};

// ---------------------------------------------------------------------
// MOCK MODE: simulates a shipment's progress through checkpoints with
// coordinates, so you can test contacts + notifications + map without
// depending on any courier account yet.
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

// A few sample routes (origin -> destination) so the map looks good.
const SAMPLE_ROUTES = [
  [
    { label: 'Origin: Barcelona, ES', lat: 41.3874, lng: 2.1686 },
    { label: 'Distribution center, Madrid, ES', lat: 40.4168, lng: -3.7038 },
    { label: 'International hub, Paris, FR', lat: 48.8566, lng: 2.3522 },
    { label: 'Destination: Lisbon, PT', lat: 38.7223, lng: -9.1393 },
  ],
  [
    { label: 'Origin: Barcelona, ES', lat: 41.3874, lng: 2.1686 },
    { label: 'Distribution center, Valencia, ES', lat: 39.4699, lng: -0.3763 },
    { label: 'Destination: Seville, ES', lat: 37.3891, lng: -5.9845 },
  ],
  [
    { label: 'Origin: Barcelona, ES', lat: 41.3874, lng: 2.1686 },
    { label: 'Hub, Frankfurt, DE', lat: 50.1109, lng: 8.6821 },
    { label: 'Hub, London, UK', lat: 51.5074, lng: -0.1278 },
    { label: 'Destination: Dublin, IE', lat: 53.3498, lng: -6.2603 },
  ],
];

function mockTrackingUpdate(carrier, trackingNumber, shipment) {
  const rand = seededRandom(carrier + trackingNumber);
  const route = SAMPLE_ROUTES[Math.floor(rand() * SAMPLE_ROUTES.length) % SAMPLE_ROUTES.length];

  // The shipment "advances" one checkpoint every time it's refreshed,
  // until it reaches the destination. Progress is stored on the shipment
  // itself (checkpointIndex).
  const prevIndex = typeof shipment.checkpointIndex === 'number' ? shipment.checkpointIndex : -1;
  const nextIndex = Math.min(prevIndex + 1, route.length - 1);

  const statusIndex = Math.min(nextIndex, STATUS_FLOW.length - 1);
  const status = nextIndex >= route.length - 1 ? 'delivered' : STATUS_FLOW[statusIndex];

  const checkpoints = route.slice(0, nextIndex + 1).map((point, i) => ({
    ...point,
    status: i === nextIndex ? status : 'completed',
    timestamp: new Date(Date.now() - (nextIndex - i) * 3 * 60 * 60 * 1000).toISOString(),
  }));

  // Test hook, mock mode only: a tracking number containing "CUSTOMS"
  // (e.g. CUSTOMS_TEST_001) simulates a customs hold from the second
  // checkpoint onward, so Fase 4 can be exercised without a real courier
  // account or an actual held parcel. Nothing to do with Ship24 - that's
  // handled separately in findCustomsAlert() for TRACKING_MODE=live.
  const customsAlert =
    /customs/i.test(trackingNumber) && nextIndex >= 1
      ? {
          statusCode: 'customs_exception',
          message: 'Simulated: additional documents or payment required to release this shipment from customs.',
          occurredAt: checkpoints[checkpoints.length - 1].timestamp,
        }
      : null;

  return {
    status,
    statusLabel: STATUS_LABELS[status] || status,
    checkpointIndex: nextIndex,
    fullRoute: route,
    checkpoints,
    currentLocation: route[nextIndex],
    estimatedDelivery: shipment.estimatedDelivery || new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
    customsAlert,
  };
}

// ---------------------------------------------------------------------
// LIVE MODE: instead of integrating each courier separately (4 different
// OAuth flows), we use Ship24 (https://ship24.com) as an aggregator: one
// API key covers FedEx/UPS/DHL/USPS and 2500+ more couriers, auto-detecting
// the carrier from the tracking number's format.
//
// Flow (documented at https://docs.ship24.com, OpenAPI spec at
// https://docs.ship24.com/assets/openapi/ship24-tracking-api.yaml):
//   POST /public/v1/trackers/track  with { trackingNumber }
//   This endpoint is idempotent: it creates the tracker on the first
//   call and always returns the current results afterwards - a single
//   call per refresh is enough, no separate register/query steps.
//
// Real couriers only give the place name for each event
// ("Memphis, TN, US"), not coordinates: we geocode each checkpoint with
// Nominatim (services/geocode.js) so we can keep drawing the route on
// the map.
// ---------------------------------------------------------------------
const { geocodeLocation } = require('./geocode');

const SHIP24_BASE = 'https://api.ship24.com/public/v1';

// The 8 official milestones (docs.ship24.com/status/#statusmilestone,
// via the ship24-tracking-statuses skill installed in this project).
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

// The 2 statusCodes the ship24-tracking-statuses skill calls out as
// carrying real business meaning under the `customs` category - a hold
// pending extra documents/payment, or an outright rejection. There's no
// separate "customs" milestone: these ride alongside whatever milestone
// the shipment is otherwise at (usually in_transit or exception).
const CUSTOMS_STATUS_CODES = ['customs_exception', 'customs_rejected'];

// Ship24 doesn't expose a structured "pay duties here" field - only the
// courier's own free-text status line (`ev.status`). If that text happens
// to contain a URL we surface it as-is; we never fabricate one.
function findCustomsAlert(orderedEvents) {
  const customsEvents = orderedEvents.filter((ev) => CUSTOMS_STATUS_CODES.includes(ev.statusCode));
  if (!customsEvents.length) return null;
  const latest = customsEvents[customsEvents.length - 1];
  return {
    statusCode: latest.statusCode,
    message: latest.status || 'The courier flagged a customs issue with this shipment.',
    occurredAt: latest.occurrenceDatetime || null,
  };
}

async function ship24Track(trackingNumber) {
  const apiKey = process.env.SHIP24_API_KEY;
  if (!apiKey) {
    throw new Error('Missing SHIP24_API_KEY in .env. Sign up at https://www.ship24.com/tracking-api to get one.');
  }
  const res = await fetch(`${SHIP24_BASE}/trackers/track`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ trackingNumber }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Ship24 responded ${res.status}: ${JSON.stringify(data).slice(0, 200)}`);
  }
  return data;
}

async function parseShip24Response(data) {
  const tracking = data?.data?.trackings?.[0];
  if (!tracking) {
    // Just created, the courier hasn't reported anything yet.
    return {
      status: 'label_created',
      statusLabel: STATUS_LABELS.label_created,
      checkpointIndex: -1,
      fullRoute: [],
      checkpoints: [],
      currentLocation: null,
      estimatedDelivery: null,
      customsAlert: null,
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

  // The map needs coordinates: if any couldn't be geocoded, we drop it
  // from the route (but the checkpoint still shows up in the timeline).
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
    customsAlert: findCustomsAlert(orderedEvents),
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
