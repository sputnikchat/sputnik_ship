const { v4: uuidv4 } = require('uuid');
const express = require('express');
const rateLimit = require('express-rate-limit');
const { update, readDB } = require('../services/store');
const { requireAuth } = require('../middleware/auth');
const { sendTestPush, sendTestToUser, VAPID_PUBLIC } = require('../services/notify');

const router = express.Router();

// No requiere login: el cliente necesita esta key antes de suscribirse.
router.get('/vapid-public-key', (req, res) => {
  res.json({ publicKey: VAPID_PUBLIC || null });
});

router.use(requireAuth);

// Each subscribe makes the server send a real push request, so it gets
// its own small budget - a browser subscribes once per device.
const subscribeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  // The silent launch-time re-sync sends no push, so it doesn't spend this budget.
  skip: (req) => req.query.sync === '1',
  message: { error: 'Too many requests. Please wait a few minutes and try again.' },
});

// The server POSTs to whatever endpoint a subscription names (right away
// for the test push below, and on every later notification). Accepting
// any URL would let a logged-in user point the server at arbitrary
// addresses - internal services, cloud metadata endpoints, someone
// else's site (SSRF). Real browsers only ever hand out endpoints on
// these push services.
const PUSH_SERVICE_HOSTS = [
  'fcm.googleapis.com', // Chrome, Edge, Brave, Opera, Android
  'android.googleapis.com',
  'push.services.mozilla.com', // Firefox (updates.push.services.mozilla.com)
  'push.apple.com', // Safari / iOS (web.push.apple.com)
  'notify.windows.com', // legacy Edge / Windows
];

function isAllowedPushEndpoint(endpoint) {
  if (typeof endpoint !== 'string' || endpoint.length > 1000) return false;
  let url;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.port || url.username || url.password) return false;
  const host = url.hostname.toLowerCase();
  return PUSH_SERVICE_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}

router.post('/subscribe', subscribeLimiter, async (req, res) => {
  const { endpoint, keys } = req.body || {};
  if (!endpoint || !keys || typeof keys.p256dh !== 'string' || typeof keys.auth !== 'string'
    || keys.p256dh.length > 200 || keys.auth.length > 100) {
    return res.status(400).json({ error: 'Invalid subscription.' });
  }
  if (!isAllowedPushEndpoint(endpoint)) {
    return res.status(400).json({ error: 'Unsupported push service.' });
  }

  let saved;
  await update((data) => {
    data.pushSubscriptions ||= [];
    // Replace any previous subscription with the same endpoint (same
    // browser/device re-subscribing, or the same device now logged in to a
    // different account - the push must follow whoever is logged in).
    data.pushSubscriptions = data.pushSubscriptions.filter((s) => s.endpoint !== endpoint);
    saved = {
      id: uuidv4(),
      userId: req.user.id,
      endpoint,
      keys: { p256dh: keys.p256dh, auth: keys.auth },
      userAgent: String(req.get('user-agent') || '').slice(0, 200),
      createdAt: new Date().toISOString(),
    };
    data.pushSubscriptions.push(saved);
  });

  // ?sync=1 is the silent re-registration the app does on every launch
  // (keeps the server's copy in step with the browser's) - no test push.
  if (req.query.sync === '1') return res.status(200).json({ ok: true });

  // Send one real push right away - "subscribed successfully" in the
  // browser doesn't mean delivery actually works.
  const testPush = await sendTestPush(saved);
  res.status(201).json({ ok: true, testPush });
});

// "Send test" button: one real push to each of this user's devices.
router.post('/test', subscribeLimiter, async (req, res) => {
  const data = await readDB();
  const results = await sendTestToUser(data, req.user.id);
  res.json({ devices: results.length, results });
});

// How many devices this user has registered, and whether the last
// delivery to each worked - for debugging "I never get anything".
router.get('/status', async (req, res) => {
  const data = await readDB();
  const subs = (data.pushSubscriptions || []).filter((s) => s.userId === req.user.id);
  res.json({
    configured: Boolean(VAPID_PUBLIC),
    devices: subs.map((s) => ({
      service: (() => { try { return new URL(s.endpoint).hostname; } catch { return 'unknown'; } })(),
      createdAt: s.createdAt,
      lastOkAt: s.lastOkAt || null,
      lastError: s.lastError || null,
    })),
  });
});

router.post('/unsubscribe', async (req, res) => {
  const { endpoint } = req.body || {};
  await update((data) => {
    data.pushSubscriptions ||= [];
    data.pushSubscriptions = data.pushSubscriptions.filter(
      (s) => !(s.endpoint === endpoint && s.userId === req.user.id)
    );
  });
  res.status(204).end();
});

module.exports = router;
