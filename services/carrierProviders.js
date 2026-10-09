// Tracking "provider" layer.
//
// The app always calls `getTrackingUpdate(carrier, trackingNumber, shipment)`.
// This function decides, based on TRACKING_MODE, whether to return
// simulated data (so you can test the app without courier accounts) or
// call each courier's real API (once you've loaded credentials in .env).
//
// In live mode each courier is tracked through its own API (DHL, FedEx,
// UPS, USPS), enabled by putting that courier's credentials in the
// environment. A courier without credentials - and air/ocean cargo, which
// has no free unified API - is simply not looked up: the shipment keeps its
// last data and the app offers the courier's own tracking page instead.

const CARRIERS = ['fedex', 'ups', 'dhl', 'usps', 'air_cargo', 'ocean_cargo'];

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
  // account or an actual held parcel. In live mode each courier's provider
  // raises its own customs alert.
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
// LIVE MODE. Couriers only give a place name per event ("Memphis, TN,
// US"), not coordinates: each checkpoint is geocoded (services/geocode.js)
// so the route can still be drawn on the map.
// ---------------------------------------------------------------------
const { geocodeLocation } = require('./geocode');

// Shared by every provider: oldest-first events ({ text, location,
// timestamp }) become the timeline, and the ones whose place geocodes
// become the map route.
async function buildResult(status, statusLabel, events, estimatedDelivery, customsAlert) {
  const geocoded = [];
  for (const ev of events) {
    const label = ev.text || ev.location || 'Checkpoint';
    const point = ev.location ? await geocodeLocation(ev.location) : null;
    geocoded.push({
      label: ev.location ? `${label} · ${ev.location}` : label,
      lat: point?.lat ?? null,
      lng: point?.lng ?? null,
      timestamp: ev.timestamp || new Date().toISOString(),
    });
  }

  // The map needs coordinates: if any couldn't be geocoded, we drop it
  // from the route (but the checkpoint still shows up in the timeline).
  const fullRoute = geocoded.filter((p) => p.lat != null && p.lng != null);
  return {
    status,
    statusLabel,
    checkpointIndex: fullRoute.length - 1,
    fullRoute,
    checkpoints: geocoded.map((p) => ({ label: p.label, timestamp: p.timestamp, status })),
    currentLocation: fullRoute[fullRoute.length - 1] || null,
    estimatedDelivery,
    customsAlert,
  };
}

// ---------------------------------------------------------------------
// DHL direct: Shipment Tracking - Unified (developer.dhl.com/api-reference/
// shipment-tracking). Free, covers Express, eCommerce, Parcel Germany,
// Freight and Global Forwarding. Used for DHL when DHL_API_KEY is set.
// The free tier allows 250 calls a day and
// one every 5 s - calls are spaced here; more needs an upgrade request.
const DHL_BASE = 'https://api-eu.dhl.com/track/shipments';
const DHL_MIN_GAP_MS = 5100;
let dhlLastCall = 0;

function dhlStatus(shipment) {
  const code = shipment.status?.statusCode;
  const text = `${shipment.status?.status || ''} ${shipment.status?.description || ''}`;
  if (code === 'delivered') return 'delivered';
  if (code === 'failure') return 'exception';
  if (code === 'pre-transit' || code === 'unknown' || !code) return 'label_created';
  return /out for delivery|with delivery courier|on vehicle for delivery/i.test(text) ? 'out_for_delivery' : 'in_transit';
}

function dhlPlace(ev) {
  const a = ev.location?.address || {};
  return a.addressLocality || [a.postalCode, a.countryCode].filter(Boolean).join(' ') || null;
}

async function dhlProvider(trackingNumber) {
  const wait = dhlLastCall + DHL_MIN_GAP_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  dhlLastCall = Date.now();
  const res = await fetch(`${DHL_BASE}?trackingNumber=${encodeURIComponent(trackingNumber)}`, {
    headers: { 'DHL-API-Key': process.env.DHL_API_KEY, Accept: 'application/json' },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw Object.assign(new Error(`DHL responded ${res.status}`), { status: res.status });
  const shipment = (await res.json())?.shipments?.[0];
  if (!shipment) throw Object.assign(new Error('DHL returned no shipment'), { status: 404 });

  const status = dhlStatus(shipment);
  const events = [...(shipment.events || [])]
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
    .map((ev) => ({ text: ev.description || ev.status, location: dhlPlace(ev), timestamp: ev.timestamp }));
  const latest = shipment.status || {};
  const customsAlert = status === 'exception' && /customs|duty|duties|aduana/i.test(`${latest.status} ${latest.description}`)
    ? { statusCode: 'customs_exception', message: latest.description || latest.status, occurredAt: latest.timestamp || null }
    : null;
  return buildResult(status, STATUS_LABELS[status], events, shipment.estimatedTimeOfDelivery || null, customsAlert);
}

// ---------------------------------------------------------------------
// USPS direct: Tracking 3.2 (developers.usps.com/trackingv3r2). Needs a
// USPS Business Account app: its Consumer Key/Secret go in USPS_CLIENT_ID /
// USPS_CLIENT_SECRET and are traded for an OAuth token, cached until expiry.
const USPS_TOKEN_URL = 'https://apis.usps.com/oauth2/v3/token';
const USPS_TRACK_URL = 'https://apis.usps.com/tracking/v3r2/tracking';

// OAuth client-credentials token, cached per carrier until a minute before
// it expires. USPS takes the credentials as JSON, FedEx as a form, UPS as
// HTTP Basic auth with a form body ({ basic: true }).
const tokens = new Map(); // name -> { value, expiresAt }
async function clientCredentialsToken(name, url, clientId, clientSecret, asForm = false, { basic = false } = {}) {
  const cached = tokens.get(name);
  if (cached && Date.now() < cached.expiresAt - 60000) return cached.value;
  const fields = basic ? { grant_type: 'client_credentials' } : { grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret };
  const headers = { 'Content-Type': asForm || basic ? 'application/x-www-form-urlencoded' : 'application/json' };
  if (basic) headers.Authorization = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`;
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: asForm || basic ? new URLSearchParams(fields) : JSON.stringify(fields),
    signal: AbortSignal.timeout(20000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) throw new Error(`${name} token: HTTP ${res.status} ${data.error || ''}`.trim());
  tokens.set(name, { value: data.access_token, expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000 });
  return data.access_token;
}

function uspsStatus(item) {
  const text = `${item.statusCategory || ''} ${item.status || ''}`.toLowerCase();
  if (/delivery attempt|notice left|alert|exception|undeliverable|return to sender|held/.test(text)) return 'exception';
  if (/delivered/.test(text)) return 'delivered';
  if (/out for delivery|available for pickup/.test(text)) return 'out_for_delivery';
  if (/pre-shipment|label created|shipping label|pending|not yet in system/.test(text) || !text.trim()) return 'label_created';
  return 'in_transit';
}

async function uspsProvider(trackingNumber) {
  const res = await fetch(USPS_TRACK_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await clientCredentialsToken('USPS', USPS_TOKEN_URL, process.env.USPS_CLIENT_ID, process.env.USPS_CLIENT_SECRET)}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify([{ trackingNumber }]),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok && res.status !== 207) throw Object.assign(new Error(`USPS responded ${res.status}`), { status: res.status });
  const item = (await res.json())?.[0];
  if (!item || item.error || !item.trackingNumber) throw new Error('USPS returned no shipment');

  const status = uspsStatus(item);
  const events = [...(item.trackingEvents || [])]
    .map((ev) => ({
      text: ev.eventType,
      location: [ev.eventCity, ev.eventState, ev.eventCountry].filter(Boolean).join(', ') || null,
      timestamp: ev.GMTTimestamp || ev.eventTimestamp,
    }))
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  const eta = item.deliveryDateExpectation || {};
  const customsAlert = status === 'exception' && /customs/i.test(`${item.status} ${item.statusSummary}`)
    ? { statusCode: 'customs_exception', message: item.statusSummary || item.status, occurredAt: events.at(-1)?.timestamp || null }
    : null;
  return buildResult(status, STATUS_LABELS[status], events,
    eta.expectedDeliveryDate || eta.predictedDeliveryDate || eta.guaranteedDeliveryDate || null, customsAlert);
}

// ---------------------------------------------------------------------
// FedEx direct: Track API v1, "Basic Integrated Visibility" - any FedEx
// tracking number, no shipper account needed per lookup. Project API key /
// secret go in FEDEX_CLIENT_ID / FEDEX_CLIENT_SECRET (production keys need a
// FedEx account linked to the project); FEDEX_SANDBOX=1 uses the test host.
const fedexBase = () => (process.env.FEDEX_SANDBOX === '1' ? 'https://apis-sandbox.fedex.com' : 'https://apis.fedex.com');

// latestStatusDetail.derivedCode / code (FedEx track status codes).
const FEDEX_STATUS = {
  OC: 'label_created', IN: 'label_created',
  PU: 'picked_up', PX: 'picked_up',
  IT: 'in_transit', AR: 'in_transit', AF: 'in_transit', DP: 'in_transit', AA: 'in_transit', AC: 'in_transit', AD: 'in_transit', OF: 'in_transit', TR: 'in_transit', CC: 'in_transit', FD: 'in_transit',
  OD: 'out_for_delivery', HL: 'out_for_delivery', HP: 'out_for_delivery',
  DL: 'delivered',
  DE: 'exception', SE: 'exception', CD: 'exception', CA: 'exception', RS: 'exception', DY: 'exception', DD: 'exception',
};

async function fedexProvider(trackingNumber) {
  const token = await clientCredentialsToken('FedEx', `${fedexBase()}/oauth/token`, process.env.FEDEX_CLIENT_ID, process.env.FEDEX_CLIENT_SECRET, true);
  const res = await fetch(`${fedexBase()}/track/v1/trackingnumbers`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'X-locale': 'en_US' },
    body: JSON.stringify({ includeDetailedScans: true, trackingInfo: [{ trackingNumberInfo: { trackingNumber } }] }),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw Object.assign(new Error(`FedEx responded ${res.status}`), { status: res.status });
  const tr = (await res.json())?.output?.completeTrackResults?.[0]?.trackResults?.[0];
  if (!tr || tr.error) throw new Error(`FedEx: ${tr?.error?.code || 'no result'}`);

  const latest = tr.latestStatusDetail || {};
  const status = FEDEX_STATUS[latest.derivedCode] || FEDEX_STATUS[latest.code] || 'in_transit';
  const events = [...(tr.scanEvents || [])]
    .map((ev) => {
      const l = ev.scanLocation || {};
      return {
        text: ev.eventDescription,
        location: [l.city, l.stateOrProvinceCode, l.countryCode].filter(Boolean).join(', ') || null,
        timestamp: ev.date,
      };
    })
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  const eta = (tr.dateAndTimes || []).find((d) => d.type === 'ESTIMATED_DELIVERY')?.dateTime
    || tr.estimatedDeliveryTimeWindow?.window?.ends || null;
  const customsAlert = latest.code === 'CD' || (status === 'exception' && /customs|clearance/i.test(latest.description || ''))
    ? { statusCode: 'customs_exception', message: latest.description || 'Customs clearance delay', occurredAt: events.at(-1)?.timestamp || null }
    : null;
  return buildResult(status, latest.statusByLocale || STATUS_LABELS[status], events, eta, customsAlert);
}

// ---------------------------------------------------------------------
// UPS direct: Tracking API v1 (developer.ups.com). App Client ID / Secret
// go in UPS_CLIENT_ID / UPS_CLIENT_SECRET (OAuth via HTTP Basic);
// UPS_SANDBOX=1 uses the CIE test host.
const upsBase = () => (process.env.UPS_SANDBOX === '1' ? 'https://wwwcie.ups.com' : 'https://onlinetools.ups.com');

// "20261008" + "143000" -> "2026-10-08T14:30:00" (UPS local time, no zone)
function upsTime(date, time = '000000') {
  if (!/^\d{8}$/.test(date || '')) return null;
  const t = /^\d{6}$/.test(time || '') ? time : '000000';
  return `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T${t.slice(0, 2)}:${t.slice(2, 4)}:${t.slice(4, 6)}`;
}

function upsStatus(status = {}) {
  const text = `${status.description || ''}`;
  if (status.type === 'D') return 'delivered';
  if (status.type === 'X' || /returned to sender|exception/i.test(text)) return 'exception';
  if (status.type === 'M' || status.type === 'MV') return 'label_created';
  if (status.type === 'P') return 'picked_up';
  return /out for delivery/i.test(text) ? 'out_for_delivery' : 'in_transit';
}

async function upsProvider(trackingNumber) {
  const token = await clientCredentialsToken('UPS', `${upsBase()}/security/v1/oauth/token`,
    process.env.UPS_CLIENT_ID, process.env.UPS_CLIENT_SECRET, true, { basic: true });
  const res = await fetch(`${upsBase()}/api/track/v1/details/${encodeURIComponent(trackingNumber)}?locale=en_US&returnSignature=false`, {
    headers: { Authorization: `Bearer ${token}`, transId: String(Date.now()), transactionSrc: 'sputnikship', Accept: 'application/json' },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw Object.assign(new Error(`UPS responded ${res.status}`), { status: res.status });
  const shipment = (await res.json())?.trackResponse?.shipment?.[0];
  const pkg = shipment?.package?.[0];
  if (!pkg) throw new Error(`UPS: ${shipment?.warnings?.[0]?.message || 'no package'}`);

  const activity = pkg.activity || [];
  const status = upsStatus(activity[0]?.status || pkg.currentStatus);
  const events = activity
    .map((a) => {
      const ad = a.location?.address || {};
      return {
        text: a.status?.description,
        location: [ad.city, ad.stateProvince, ad.countryCode].filter(Boolean).join(', ') || null,
        timestamp: upsTime(a.date, a.time),
      };
    })
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  const eta = (pkg.deliveryDate || []).find((d) => d.type === 'SDD' || d.type === 'RDD');
  const latest = activity[0]?.status || {};
  const customsAlert = status === 'exception' && /customs|clearance|brokerage/i.test(latest.description || '')
    ? { statusCode: 'customs_exception', message: latest.description, occurredAt: events.at(-1)?.timestamp || null }
    : null;
  return buildResult(status, STATUS_LABELS[status], events, eta ? upsTime(eta.date) : null, customsAlert);
}

// Each courier's own API, enabled only when its credentials are set. No
// aggregator fallback (Ship24 was dropped 2026-10): a courier without a
// provider here, or without credentials, isn't looked up at all.
const liveProviders = {
  dhl: { configured: () => !!process.env.DHL_API_KEY, track: dhlProvider },
  fedex: { configured: () => !!(process.env.FEDEX_CLIENT_ID && process.env.FEDEX_CLIENT_SECRET), track: fedexProvider },
  ups: { configured: () => !!(process.env.UPS_CLIENT_ID && process.env.UPS_CLIENT_SECRET), track: upsProvider },
  usps: { configured: () => !!(process.env.USPS_CLIENT_ID && process.env.USPS_CLIENT_SECRET), track: uspsProvider },
};

const isLive = () => (process.env.TRACKING_MODE || 'mock').toLowerCase() === 'live';

// Whether this courier can be looked up right now (always true in mock mode).
function canTrack(carrier) {
  if (!isLive()) return true;
  return !!liveProviders[carrier]?.configured();
}

// Callers check canTrack() first; an unconfigured courier here is a bug.
async function getTrackingUpdate(carrier, trackingNumber, shipment) {
  if (!isLive()) return mockTrackingUpdate(carrier, trackingNumber, shipment);
  if (!canTrack(carrier)) throw new Error(`No live tracking configured for ${carrier}`);
  return liveProviders[carrier].track(trackingNumber);
}

module.exports = { getTrackingUpdate, canTrack, CARRIERS, STATUS_FLOW, STATUS_LABELS };
