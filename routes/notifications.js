const express = require('express');
const { readDB, update } = require('../services/store');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

router.get('/', (req, res) => {
  const db = readDB();
  const notifications = db.notifications.filter((n) => n.userId === req.user.id);
  res.json(notifications);
});

router.post('/:id/read', async (req, res) => {
  const { id } = req.params;
  let found = false;
  await update((data) => {
    const n = data.notifications.find((x) => x.id === id && x.userId === req.user.id);
    if (n) {
      n.read = true;
      found = true;
    }
  });
  if (!found) return res.status(404).json({ error: 'Notificacion no encontrada.' });
  res.status(204).end();
});

router.post('/read-all', async (req, res) => {
  await update((data) => {
    data.notifications.forEach((n) => {
      if (n.userId === req.user.id) n.read = true;
    });
  });
  res.status(204).end();
});

module.exports = router;
