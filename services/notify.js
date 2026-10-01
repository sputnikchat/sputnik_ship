const crypto = require('crypto');
const webpush = require('web-push');
const { update: storeUpdate } = require('./store');
const { getSpaceUserIds } = require('./space');

// Status changes, delays, and delivery drop an automatic entry into a
// shipment's own chat thread (shared by both routes/shipments.js and the
// scheduler's bulk auto-refresh) - the thread then reads as the
// shipment's whole timeline, not two things to cross-reference.
function pushSystemMessage(shipment, text) {
  shipment.messages ||= [];
  shipment.messages.push({ id: crypto.randomUUID(), type: 'system', text, createdAt: new Date().toISOString() });
}

// A customs hold (Fase 4): same system-message mechanism as a status
// change or delay, plus its own push notification type so it can be
// muted independently. Idempotent per distinct alert - shipment.
// customsAlertedAt stores a marker for the last one already raised, so a
// refresh that sees the SAME still-open hold doesn't re-notify every 30
// minutes, but a genuinely new one (different statusCode or a later
// occurrenceDatetime) does.
function applyCustomsAlert(data, shipment, result) {
  const alert = result.customsAlert;
  if (!alert) return;
  const marker = `${alert.statusCode}@${alert.occurredAt || 'unknown'}`;
  if (shipment.customsAlertedAt === marker) return;
  pushSystemMessage(shipment, `Customs: ${alert.message}`);
  pushNotification(data, {
    userId: shipment.userId,
    shipmentId: shipment.id,
    title: `Customs hold: ${shipment.trackingNumber} (${shipment.carrier.toUpperCase()})`,
    message: alert.message,
    level: 'warning',
    type: 'customs',
  });
  shipment.customsAlertedAt = marker;
}

// Env values pasted into a hosting dashboard often carry stray spaces or
// newlines, and Apple's push service (iPhone + Safari) rejects the whole
// request (403 BadJwtToken) when the VAPID subject isn't a clean
// "mailto:" or "https:" URL - Chrome is more forgiving, which is how a
// setup can look fine on one browser and silently fail on another.
function cleanEnv(v) {
  return String(v || '').trim().replace(/^['"]|['"]$/g, '');
}
function normalizeSubject(raw) {
  const v = cleanEnv(raw).replace(/\s+/g, '');
  if (/^mailto:[^@\s]+@[^@\s]+\.[^@\s]+$/i.test(v) && !/@(example|localhost)/i.test(v)) return v;
  if (/^https:\/\/[^\s]+$/i.test(v) && !/localhost/i.test(v)) return v;
  if (/^[^@\s:]+@[^@\s]+\.[^@\s]+$/.test(v)) return `mailto:${v}`;
  return 'https://sputnikship.app';
}
const VAPID_PUBLIC = cleanEnv(process.env.VAPID_PUBLIC_KEY);
const VAPID_PRIVATE = cleanEnv(process.env.VAPID_PRIVATE_KEY);
const VAPID_SUBJECT = normalizeSubject(process.env.VAPID_SUBJECT);
let VAPID_READY = false;
if (VAPID_PUBLIC && VAPID_PRIVATE) {
  try {
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
    VAPID_READY = true;
    console.log(`Web push ready (subject: ${VAPID_SUBJECT}).`);
  } catch (err) {
    console.error('Web push NOT configured - invalid VAPID settings:', err.message);
  }
} else {
  console.warn('Web push disabled: VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY missing.');
}

// TTL: keep trying for a day if the phone is offline (default 4 weeks is
// pointless for tracking updates). urgency high: iOS/Android otherwise
// may batch or delay delivery while the phone is idle.
const PUSH_OPTIONS = { TTL: 24 * 60 * 60, urgency: 'high' };

function describePushError(err) {
  const body = typeof err.body === 'string' ? err.body.trim().slice(0, 200) : '';
  return [err.statusCode, body || err.message].filter(Boolean).join(' ');
}

// Remembers the outcome of the last delivery attempt on the subscription
// itself, so a failing device is visible in the database and in
// GET /api/push/status instead of only in server logs.
function recordPushResult(subId, ok, reason) {
  if (!subId) return;
  storeUpdate((d) => {
    const sub = (d.pushSubscriptions || []).find((s) => s.id === subId);
    if (!sub) return;
    if (ok) { sub.lastOkAt = new Date().toISOString(); sub.lastError = null; }
    else { sub.lastError = reason; sub.lastErrorAt = new Date().toISOString(); }
  }).catch(() => {});
}

function removeSubscription(subId) {
  storeUpdate((d) => {
    d.pushSubscriptions = (d.pushSubscriptions || []).filter((s) => s.id !== subId);
  }).catch(() => {});
}

// One real delivery attempt to one subscription. Returns {ok, reason, gone}.
async function deliver(sub, payloadObj) {
  if (!VAPID_READY) return { ok: false, reason: 'Push notifications are not configured on the server.' };
  try {
    await webpush.sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, JSON.stringify(payloadObj), PUSH_OPTIONS);
    recordPushResult(sub.id, true);
    return { ok: true };
  } catch (err) {
    const reason = describePushError(err);
    const gone = err.statusCode === 404 || err.statusCode === 410;
    if (gone) removeSubscription(sub.id);
    else recordPushResult(sub.id, false, reason);
    console.error(`Push to ${hostOf(sub.endpoint)} failed: ${reason}`);
    return { ok: false, reason, gone };
  }
}

function hostOf(endpoint) {
  try { return new URL(endpoint).hostname; } catch { return 'unknown'; }
}

// Fired right after a device subscribes (routes/push.js), so "Enable
// notifications" gets an immediate, real answer instead of silent hope -
// a subscription can be created client-side and still never actually
// deliver (a stale VAPID key mismatch, a malformed endpoint, etc.).
async function sendTestPush(sub) {
  return deliver(sub, {
    title: 'Sputnik Ship',
    body: 'Notifications are working - you\'ll get alerts here from now on.',
    url: '/app',
    tag: 'sputnik-test',
  });
}

// Sends a test push to every device this user has subscribed and reports
// each result - backs the "Send test" button so a broken device is obvious.
async function sendTestToUser(data, userId) {
  const subs = (data.pushSubscriptions || []).filter((s) => s.userId === userId);
  const results = [];
  for (const sub of subs) {
    const r = await sendTestPush(sub);
    results.push({ device: hostOf(sub.endpoint), ...r });
  }
  return results;
}

// Creates one notification per recipient (saved inside the same `data`
// object you're already modifying in a store.update(...)), skipping anyone
// who has turned this `type` off in their own notification preferences.
// `type` is one of 'status' | 'delay' | 'digest' | 'chat' - matches the
// keys in a user's notifyPrefs - or null/omitted for a notification that
// can't be turned off.
function pushNotificationToUsers(data, { userIds, shipmentId, title, message, level = 'info', type = null }) {
  let first = null;
  for (const recipientId of userIds) {
    const recipient = data.users.find((u) => u.id === recipientId);
    if (type && recipient?.notifyPrefs && recipient.notifyPrefs[type] === false) continue;
    const notification = {
      id: crypto.randomUUID(),
      userId: recipientId,
      shipmentId,
      title,
      message,
      level, // info | success | warning
      type, // status | delay | digest | chat | customs | null - kept for debugging/future filtering, not just the prefs check above
      read: false,
      createdAt: new Date().toISOString(),
    };
    data.notifications.unshift(notification);
    maybeSendWebPush(data, notification);
    if (!first) first = notification;
  }
  // Keep at most 200 notifications per user so this doesn't grow without
  // limit. (It used to be 200 in total, so one busy account could push
  // everyone else's unread notifications out of the store.)
  const perUser = new Map();
  data.notifications = data.notifications.filter((n) => {
    const count = (perUser.get(n.userId) || 0) + 1;
    perUser.set(n.userId, count);
    return count <= 200;
  });

  // Email (if enabled) is a single fixed address in .env, not per-user -
  // send it once regardless of how many people were notified.
  maybeSendEmail(first || { title, message });
  return first;
}

// `userId` is the shipment's owner, but every co-owner in that user's
// space gets their own independent copy - own read/unread state, own
// push - since "get notified on every change" is the whole point of
// sharing a space.
function pushNotification(data, { userId, shipmentId, title, message, level = 'info', excludeUserId = null, type = null }) {
  const recipients = getSpaceUserIds(data, userId).filter((id) => id !== excludeUserId);
  return pushNotificationToUsers(data, { userIds: recipients, shipmentId, title, message, level, type });
}

// Optional email delivery (disabled by default). Enable it in .env with
// NOTIFY_EMAIL_ENABLED=true and SMTP credentials. It's optional:
// notifications always stay available inside the app regardless.
async function maybeSendEmail(notification) {
  if (String(process.env.NOTIFY_EMAIL_ENABLED).toLowerCase() !== 'true') return;
  try {
    // nodemailer is optional: if it isn't installed, we don't break the app.
    const nodemailer = require('nodemailer');
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
    await transporter.sendMail({
      from: process.env.NOTIFY_EMAIL_FROM,
      to: process.env.NOTIFY_EMAIL_TO,
      subject: notification.title,
      text: notification.message,
    });
  } catch (err) {
    console.error('Could not send notification email:', err.message);
  }
}

// Browser push notifications. Only runs when VAPID keys are set (see
// README). Fire-and-forget: doesn't block notification creation and
// doesn't require callers of pushNotification() to await it. Results are
// recorded with their own store.update() calls (see deliver()), since this
// runs after the transaction that called pushNotification() has finished.
function maybeSendWebPush(data, notification) {
  if (!VAPID_READY) return;
  data.pushSubscriptions ||= [];
  const subs = data.pushSubscriptions.filter((s) => s.userId === notification.userId);
  const payload = {
    title: notification.title,
    body: notification.message,
    url: notification.shipmentId ? `/app#shipment=${notification.shipmentId}` : '/app',
    tag: notification.shipmentId || notification.id,
  };
  subs.forEach((sub) => { deliver(sub, payload).catch(() => {}); });
}

module.exports = { pushNotification, pushNotificationToUsers, pushSystemMessage, applyCustomsAlert, sendTestPush, sendTestToUser, VAPID_PUBLIC };
