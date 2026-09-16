const express = require('express');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { readDB, update } = require('../services/store');
const { requireAuth } = require('../middleware/auth');
const { getTrackingUpdate, CARRIERS } = require('../services/carrierProviders');
const { pushNotification } = require('../services/notify');
const { refreshAllShipments } = require('../services/scheduler');
const { getSpaceUserIds } = require('../services/space');
const { checkDelay } = require('../services/delayDetector');

const router = express.Router();
router.use(requireAuth);

const CATEGORIES = ['electronics', 'documents', 'gifts', 'clothing', 'food', 'other'];

router.get('/', async (req, res) => {
  const db = await readDB();
  const spaceUserIds = getSpaceUserIds(db, req.user.id);
  const shipments = db.shipments
    .filter((s) => spaceUserIds.includes(s.userId))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json(shipments);
});

router.post('/', async (req, res) => {
  const { carrier, trackingNumber, contactId, label, notes, cost, currency, category, photo } = req.body || {};
  if (!carrier || !CARRIERS.includes(String(carrier).toLowerCase())) {
    return res.status(400).json({ error: `Courier must be one of: ${CARRIERS.join(', ')}` });
  }
  if (!trackingNumber) return res.status(400).json({ error: 'Tracking number is required.' });

  const parsedCost = cost !== undefined && cost !== null && cost !== '' ? Number(cost) : null;
  if (parsedCost !== null && !Number.isFinite(parsedCost)) {
    return res.status(400).json({ error: 'Cost must be a number.' });
  }

  const shipment = {
    id: uuidv4(),
    userId: req.user.id,
    carrier: String(carrier).toLowerCase(),
    trackingNumber: String(trackingNumber).trim(),
    contactId: contactId || null,
    label: label || '',
    notes: notes || '',
    cost: parsedCost,
    currency: parsedCost !== null ? (currency || 'USD').toUpperCase() : null,
    category: CATEGORIES.includes(category) ? category : 'other',
    photo: photo || null,
    status: 'label_created',
    statusLabel: 'Label created',
    checkpointIndex: -1,
    checkpoints: [],
    fullRoute: [],
    currentLocation: null,
    estimatedDelivery: null,
    lastCheckedAt: null,
    shareToken: null,
    delayFlagged: false,
    archived: false,
    messages: [],
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

  const db = await readDB();
  res.status(201).json(db.shipments.find((s) => s.id === shipment.id));
});

router.get('/:id', async (req, res) => {
  const db = await readDB();
  const spaceUserIds = getSpaceUserIds(db, req.user.id);
  const shipment = db.shipments.find((s) => s.id === req.params.id && spaceUserIds.includes(s.userId));
  if (!shipment) return res.status(404).json({ error: 'Shipment not found.' });
  res.json(shipment);
});

// Force a manual refresh of ONE shipment (besides the automatic refresh every 30 min).
router.post('/:id/refresh', async (req, res) => {
  const db = await readDB();
  const spaceUserIds = getSpaceUserIds(db, req.user.id);
  const shipment = db.shipments.find((s) => s.id === req.params.id && spaceUserIds.includes(s.userId));
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
      const delayReason = checkDelay(s);
      if (delayReason) {
        pushNotification(data, {
          userId: s.userId,
          shipmentId: s.id,
          title: `Possible delay: ${s.trackingNumber} (${s.carrier.toUpperCase()})`,
          message: delayReason,
          level: 'warning',
        });
      }
      updated = s;
    });
    res.json(updated);
  } catch (err) {
    res.status(502).json({ error: `Could not update tracking: ${err.message}` });
  }
});

// Returns a public share link for this shipment, creating the token the
// first time it's called and reusing it after (so re-sharing doesn't
// invalidate a link someone already has).
router.post('/:id/share', async (req, res) => {
  const db = await readDB();
  const spaceUserIds = getSpaceUserIds(db, req.user.id);
  const shipment = db.shipments.find((s) => s.id === req.params.id && spaceUserIds.includes(s.userId));
  if (!shipment) return res.status(404).json({ error: 'Shipment not found.' });

  let token = shipment.shareToken;
  if (!token) {
    await update((data) => {
      const s = data.shipments.find((x) => x.id === shipment.id);
      s.shareToken = crypto.randomBytes(9).toString('base64url');
      token = s.shareToken;
    });
  }

  res.json({ shareToken: token, url: `/s/${token}` });
});

// Archiving hides a shipment from the main list without deleting its
// history - reversible, unlike delete.
router.post('/:id/archive', async (req, res) => {
  const db = await readDB();
  const spaceUserIds = getSpaceUserIds(db, req.user.id);
  const shipment = db.shipments.find((s) => s.id === req.params.id && spaceUserIds.includes(s.userId));
  if (!shipment) return res.status(404).json({ error: 'Shipment not found.' });

  let updated = null;
  await update((data) => {
    const s = data.shipments.find((x) => x.id === shipment.id);
    s.archived = !s.archived;
    updated = s;
  });
  res.json(updated);
});

// A per-shipment message thread, shared by everyone in the space (the
// "communicator" feature: co-owners can leave notes for each other on a
// specific shipment, e.g. "left it with the doorman").
router.post('/:id/messages', async (req, res) => {
  const { text } = req.body || {};
  if (!text || !String(text).trim()) return res.status(400).json({ error: 'Message text is required.' });

  const db = await readDB();
  const spaceUserIds = getSpaceUserIds(db, req.user.id);
  const shipment = db.shipments.find((s) => s.id === req.params.id && spaceUserIds.includes(s.userId));
  if (!shipment) return res.status(404).json({ error: 'Shipment not found.' });

  let updated = null;
  await update((data) => {
    const s = data.shipments.find((x) => x.id === shipment.id);
    const author = data.users.find((u) => u.id === req.user.id);
    const msg = {
      id: uuidv4(),
      userId: req.user.id,
      handle: author ? author.handle : 'unknown',
      text: String(text).trim().slice(0, 2000),
      createdAt: new Date().toISOString(),
    };
    s.messages ||= [];
    s.messages.push(msg);
    pushNotification(data, {
      userId: s.userId,
      shipmentId: s.id,
      title: `New message on ${s.label || s.trackingNumber}`,
      message: `@${msg.handle}: ${msg.text}`,
      level: 'info',
      excludeUserId: req.user.id,
    });
    updated = s;
  });
  res.json(updated);
});

router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  const db = await readDB();
  const spaceUserIds = getSpaceUserIds(db, req.user.id);
  let found = false;
  await update((data) => {
    const before = data.shipments.length;
    data.shipments = data.shipments.filter((s) => !(s.id === id && spaceUserIds.includes(s.userId)));
    found = data.shipments.length < before;
  });
  if (!found) return res.status(404).json({ error: 'Shipment not found.' });
  res.status(204).end();
});

// Manually triggers the refresh cycle for ALL shipments (the same thing
// the scheduler does every 30 min). Useful for testing without waiting.
router.post('/refresh-all/now', async (req, res) => {
  await refreshAllShipments();
  const db = await readDB();
  const spaceUserIds = getSpaceUserIds(db, req.user.id);
  const shipments = db.shipments.filter((s) => spaceUserIds.includes(s.userId));
  res.json({ ok: true, shipments });
});

module.exports = router;
