const { v4: uuidv4 } = require('uuid');
const webpush = require('web-push');
const { update: storeUpdate } = require('./store');
const { getSpaceUserIds } = require('./space');

// Status changes, delays, and delivery drop an automatic entry into a
// shipment's own chat thread (shared by both routes/shipments.js and the
// scheduler's bulk auto-refresh) - the thread then reads as the
// shipment's whole timeline, not two things to cross-reference.
function pushSystemMessage(shipment, text) {
  shipment.messages ||= [];
  shipment.messages.push({ id: uuidv4(), type: 'system', text, createdAt: new Date().toISOString() });
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

const VAPID_READY = Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
if (VAPID_READY) {
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'mailto:example@example.com',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
}

// Fired right after a device subscribes (routes/push.js), so "Enable
// notifications" gets an immediate, real answer instead of silent hope -
// a subscription can be created client-side and still never actually
// deliver (a stale VAPID key mismatch, a malformed endpoint, etc.).
async function sendTestPush(sub) {
  if (!VAPID_READY) return { ok: false, reason: 'Push notifications are not configured on the server.' };
  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: sub.keys },
      JSON.stringify({ title: 'Sputnik Ship', body: 'Notifications are working - you\'ll get alerts here from now on.' })
    );
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
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
      id: uuidv4(),
      userId: recipientId,
      shipmentId,
      title,
      message,
      level, // info | success | warning
      read: false,
      createdAt: new Date().toISOString(),
    };
    data.notifications.unshift(notification);
    maybeSendWebPush(data, notification);
    if (!first) first = notification;
  }
  // Keep at most 200 notifications total so this doesn't grow without limit.
  data.notifications = data.notifications.slice(0, 200);

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

// Browser push notifications (optional). Disabled by default: only
// runs when VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY are set in .env (see
// README). Fire-and-forget: doesn't block notification creation and
// doesn't require callers of pushNotification() to await it.
function maybeSendWebPush(data, notification) {
  if (!VAPID_READY) return;
  data.pushSubscriptions ||= [];
  const subs = data.pushSubscriptions.filter((s) => s.userId === notification.userId);
  const payload = JSON.stringify({ title: notification.title, body: notification.message });

  subs.forEach((sub) => {
    webpush
      .sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, payload)
      .catch((err) => {
        if (err.statusCode === 404 || err.statusCode === 410) {
          // The subscription expired or the user revoked permission: remove it.
          // This uses its own store.update() (rather than touching the `data`
          // above) because this callback runs after the transaction that
          // called pushNotification() has already finished and persisted.
          storeUpdate((d) => {
            d.pushSubscriptions = (d.pushSubscriptions || []).filter((s) => s.id !== sub.id);
          }).catch(() => {});
        } else {
          console.error('Could not send push notification:', err.message);
        }
      });
  });
}

module.exports = { pushNotification, pushNotificationToUsers, pushSystemMessage, applyCustomsAlert, sendTestPush };
