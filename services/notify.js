const { v4: uuidv4 } = require('uuid');
const webpush = require('web-push');
const { update: storeUpdate } = require('./store');
const { getSpaceUserIds } = require('./space');

const VAPID_READY = Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
if (VAPID_READY) {
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'mailto:example@example.com',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
}

// Creates a notification in the database (saved inside the same `data`
// object you're already modifying in a store.update(...)). `userId` is
// the shipment's owner, but every co-owner in that user's space gets
// their own independent copy - own read/unread state, own push - since
// "get notified on every change" is the whole point of sharing a space.
function pushNotification(data, { userId, shipmentId, title, message, level = 'info' }) {
  const recipients = getSpaceUserIds(data, userId);
  let first = null;
  for (const recipientId of recipients) {
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
    if (recipientId === userId) first = notification;
  }
  // Keep at most 200 notifications total so this doesn't grow without limit.
  data.notifications = data.notifications.slice(0, 200);

  // Email (if enabled) is a single fixed address in .env, not per-user -
  // send it once regardless of how many co-owners were notified.
  maybeSendEmail(first || { title, message });
  return first;
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

module.exports = { pushNotification };
