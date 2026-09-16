const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { readDB, update } = require('../services/store');
const { requireAuth } = require('../middleware/auth');
const { getTrackingUpdate, CARRIERS } = require('../services/carrierProviders');
const { pushNotification } = require('../services/notify');
const { refreshAllShipments } = require('../services/scheduler');

const router = express.Router();
router.use(requireAuth);

router.get('/', (req, res) => {
  const db = readDB();
  const shipments = db.shipments
    .filter((s) => s.userId === req.user.id)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json(shipments);
});

router.post('/', async (req, res) => {
  const { carrier, trackingNumber, contactId, label } = req.body || {};
  if (!carrier || !CARRIERS.includes(String(carrier).toLowerCase())) {
    return res.status(400).json({ error: `Courier must be one of: ${CARRIERS.join(', ')}` });
  }
  if (!trackingNumber) return res.status(400).json({ error: 'Tracking number is required.' });

  const shipment = {
    id: uuidv4(),
    userId: req.user.id,
    carrier: String(carrier).toLowerCase(),
    trackingNumber: String(trackingNumber).trim(),
    contactId: contactId || null,
    label: label || '',
    status: 'label_created',
    statusLabel: 'Label created',
    checkpointIndex: -1,
    checkpoints: [],
    fullRoute: [],
    currentLocation: null,
    estimatedDelivery: null,
    lastCheckedAt: null,
    archived: false,
    createdAt: new Date().toISOString(),
  };

  await update((data) => {
    data.shipments.push(shipment);
  });

  // Fetch tracking immediately so the shipment doesn't sit empty until
  // the next scheduler cycle (every 30 min by default).
  try {
    const result = await getTrackingUpdate(shipment.carrier, shipment.trackingNumber, shipment);
    await update((data) => {
      const s = data.shipments.find((x) => x.id === shipment.id);
      if (!s) return;
      Object.assign(s, {
        status: result.status,
        statusLabel: result.statusLabel,
        checkpointIndex: result.checkpointIndex,
        fullRoute: result.fullRoute,
        checkpoints: result.checkpoints,
        currentLocation: result.currentLocation,
        estimatedDelivery: result.estimatedDelivery,
        lastCheckedAt: new Date().toISOString(),
      });
      pushNotification(data, {
        userId: s.userId,
        shipmentId: s.id,
        title: `Shipment added: ${s.trackingNumber} (${s.carrier.toUpperCase()})`,
        message: `Initial status: ${result.statusLabel}`,
        level: 'info',
      });
    });
  } catch (err) {
    console.error('Could not fetch initial tracking:', err.message);
  }

  const db = readDB();
  res.status(201).json(db.shipments.find((s) => s.id === shipment.id));
});

router.get('/:id', (req, res) => {
  const db = readDB();
  const shipment = db.shipments.find((s) => s.id === req.params.id && s.userId === req.user.id);
  if (!shipment) return res.status(404).json({ error: 'Shipment not found.' });
  res.json(shipment);
});

// Force a manual refresh of ONE shipment (besides the automatic refresh every 30 min).
router.post('/:id/refresh', async (req, res) => {
  const db = readDB();
  const shipment = db.shipments.find((s) => s.id === req.params.id && s.userId === req.user.id);
  if (!shipment) return res.status(404).json({ error: 'Shipment not found.' });

  try {
    const result = await getTrackingUpdate(shipment.carrier, shipment.trackingNumber, shipment);
    let updated = null;
    await update((data) => {
      const s = data.shipments.find((x) => x.id === shipment.id);
      const statusChanged = result.status !== s.status;
      Object.assign(s, {
        status: result.status,
        statusLabel: result.statusLabel,
        checkpointIndex: result.checkpointIndex,
        fullRoute: result.fullRoute,
        checkpoints: result.checkpoints,
        currentLocation: result.currentLocation,
        estimatedDelivery: result.estimatedDelivery,
        lastCheckedAt: new Date().toISOString(),
      });
      if (statusChanged) {
        pushNotification(data, {
          userId: s.userId,
          shipmentId: s.id,
          title: `Shipment ${s.trackingNumber} (${s.carrier.toUpperCase()})`,
          message: `New status: ${result.statusLabel}`,
          level: result.status === 'delivered' ? 'success' : 'info',
        });
      }
      updated = s;
    });
    res.json(updated);
  } catch (err) {
    res.status(502).json({ error: `Could not update tracking: ${err.message}` });
  }
});

router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  let found = false;
  await update((data) => {
    const before = data.shipments.length;
    data.shipments = data.shipments.filter((s) => !(s.id === id && s.userId === req.user.id));
    found = data.shipments.length < before;
  });
  if (!found) return res.status(404).json({ error: 'Shipment not found.' });
  res.status(204).end();
});

// Manually triggers the refresh cycle for ALL shipments (the same thing
// the scheduler does every 30 min). Useful for testing without waiting.
router.post('/refresh-all/now', async (req, res) => {
  await refreshAllShipments();
  const db = readDB();
  const shipments = db.shipments.filter((s) => s.userId === req.user.id);
  res.json({ ok: true, shipments });
});

module.exports = router;
