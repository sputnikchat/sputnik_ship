const { v4: uuidv4 } = require('uuid');
const express = require('express');
const { update } = require('../services/store');
const { requireAuth } = require('../middleware/auth');
const { sendTestPush } = require('../services/notify');

const router = express.Router();

// No requiere login: el cliente necesita esta key antes de suscribirse.
router.get('/vapid-public-key', (req, res) => {
  res.json({ publicKey: process.env.VAPID_PUBLIC_KEY || null });
});

router.use(requireAuth);

router.post('/subscribe', async (req, res) => {
  const { endpoint, keys } = req.body || {};
  if (!endpoint || !keys || !keys.p256dh || !keys.auth) {
    return res.status(400).json({ error: 'Invalid subscription.' });
  }

  await update((data) => {
    data.pushSubscriptions ||= [];
    // Reemplaza cualquier suscripcion previa con el mismo endpoint
    // (mismo navegador/dispositivo re-suscribiendose).
    data.pushSubscriptions = data.pushSubscriptions.filter((s) => s.endpoint !== endpoint);
    data.pushSubscriptions.push({
      id: uuidv4(),
      userId: req.user.id,
      endpoint,
      keys: { p256dh: keys.p256dh, auth: keys.auth },
      createdAt: new Date().toISOString(),
    });
  });

  // Send one real push right away - "subscribed successfully" in the
  // browser doesn't mean delivery actually works, and silently hoping
  // is exactly how this went unnoticed before.
  const testPush = await sendTestPush({ endpoint, keys });
  res.status(201).json({ ok: true, testPush });
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
