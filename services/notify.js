const { v4: uuidv4 } = require('uuid');

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

module.exports = { pushNotification };
