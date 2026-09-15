const { v4: uuidv4 } = require('uuid');
const webpush = require('web-push');
const { update: storeUpdate } = require('./store');

const VAPID_READY = Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
if (VAPID_READY) {
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'mailto:example@example.com',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
}

// Crea una notificacion en la base de datos (queda guardada dentro del
// mismo objeto `data` que ya estas modificando en un store.update(...)).
function pushNotification(data, { userId, shipmentId, title, message, level = 'info' }) {
  const notification = {
    id: uuidv4(),
    userId,
    shipmentId,
    title,
    message,
    level, // info | success | warning
    read: false,
    createdAt: new Date().toISOString(),
  };
  data.notifications.unshift(notification);
  // Nos quedamos con como maximo 200 notificaciones para no crecer sin limite
  data.notifications = data.notifications.slice(0, 200);

  maybeSendEmail(notification);
  maybeSendWebPush(data, notification);
  return notification;
}

// Envio de email opcional (desactivado por defecto). Activalo en .env con
// NOTIFY_EMAIL_ENABLED=true y las credenciales SMTP. No es obligatorio:
// las notificaciones siempre quedan disponibles dentro de la app.
async function maybeSendEmail(notification) {
  if (String(process.env.NOTIFY_EMAIL_ENABLED).toLowerCase() !== 'true') return;
  try {
    // nodemailer es opcional: si no esta instalado, no rompemos la app.
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
    console.error('No se pudo enviar el email de notificacion:', err.message);
  }
}

// Notificaciones push del navegador (opcional). Desactivado por defecto:
// solo actua si VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY estan seteadas en .env
// (ver README). Fire-and-forget: no bloquea la creacion de la notificacion
// ni requiere que los callers de pushNotification() hagan await.
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
          // La suscripcion vencio o el usuario revoco el permiso: la sacamos.
          // Se hace en un store.update() propio (no tocando el `data` de
          // arriba) porque este callback corre despues de que la transaccion
          // que llamo a pushNotification() ya termino y persistio en disco.
          storeUpdate((d) => {
            d.pushSubscriptions = (d.pushSubscriptions || []).filter((s) => s.id !== sub.id);
          }).catch(() => {});
        } else {
          console.error('No se pudo enviar la notificacion push:', err.message);
        }
      });
  });
}

module.exports = { pushNotification };
