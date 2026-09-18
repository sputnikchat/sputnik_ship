const express = require('express');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const { v4: uuidv4 } = require('uuid');
const { readDB, update } = require('../services/store');
const { requireAuth } = require('../middleware/auth');
const { getTrackingUpdate, CARRIERS } = require('../services/carrierProviders');
const { pushNotification, pushNotificationToUsers, pushSystemMessage, applyCustomsAlert } = require('../services/notify');
const { refreshAllShipments } = require('../services/scheduler');
const { getSpaceUserIds } = require('../services/space');
const { checkDelay } = require('../services/delayDetector');
const { encryptField, decryptField } = require('../services/encryption');
const { logAudit } = require('../services/audit');
const { stripImageMetadata } = require('../services/imageMeta');

const router = express.Router();
router.use(requireAuth);

const CATEGORIES = ['electronics', 'documents', 'gifts', 'clothing', 'food', 'other'];

// Generous for real use (nobody adds/messages 60 times in 15 minutes by
// hand) but stops a script from creating shipments or chat messages
// without limit - these were the only mutating routes in the app with
// no rate limit at all until now.
const writeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please wait a few minutes and try again.' },
});

// Tighter limit specifically for refreshing tracking: each call fans out
// to the real Ship24 API for every active shipment, so spamming this
// burns through the account's API quota (and could get the app's own
// Ship24 account rate-limited or blocked) far faster than any other
// route in the app.
const refreshLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many refresh requests. Please wait a few minutes and try again.' },
});

// A follower (someone on a different account/space who joined via a share
// link - see POST /follow) gets read access to a shipment plus its chat,
// but never the owner's private fields: notes, cost, the linked contact,
// or the attached photo. Same idea as routes/public.js's field allowlist,
// just with messages/category/archived/delayFlagged added back in since
// those aren't sensitive and following-along wants them.
function sanitizeForFollower(shipment) {
  const { notes, cost, currency, contactId, photo, userId, ...safe } = shipment;
  return { ...safe, viewerRole: 'follower' };
}

// The owner-facing counterpart: photo and cost are stored encrypted (see
// services/encryption.js) and need to come back out in plain form for the
// person who's actually allowed to see them.
function decryptForOwner(shipment) {
  return {
    ...shipment,
    photo: decryptField(shipment.photo),
    cost: shipment.cost === null || shipment.cost === undefined ? shipment.cost : Number(decryptField(shipment.cost)),
    viewerRole: 'owner',
  };
}

router.get('/', async (req, res) => {
  const db = await readDB();
  const spaceUserIds = getSpaceUserIds(db, req.user.id);
  const owned = db.shipments
    .filter((s) => spaceUserIds.includes(s.userId))
    .map(decryptForOwner);
  const followed = db.shipments
    .filter((s) => !spaceUserIds.includes(s.userId) && (s.followers || []).includes(req.user.id))
    .map(sanitizeForFollower);
  const shipments = [...owned, ...followed].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json(shipments);
});

router.post('/', writeLimiter, async (req, res) => {
  const { carrier, trackingNumber, contactId, label, notes, cost, currency, category, photo } = req.body || {};
  if (!carrier || !CARRIERS.includes(String(carrier).toLowerCase())) {
    return res.status(400).json({ error: `Courier must be one of: ${CARRIERS.join(', ')}` });
  }
  if (!trackingNumber) return res.status(400).json({ error: 'Tracking number is required.' });

  const parsedCost = cost !== undefined && cost !== null && cost !== '' ? Number(cost) : null;
  if (parsedCost !== null && !Number.isFinite(parsedCost)) {
    return res.status(400).json({ error: 'Cost must be a number.' });
  }
  // photo is rendered back out as an <img src="..."> - reject anything
  // that isn't actually an image data URI up front, rather than relying
  // only on the frontend escaping it at render time.
  if (photo && !/^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/]+=*$/.test(photo)) {
    return res.status(400).json({ error: 'Photo must be a valid image.' });
  }

  const shipment = {
    id: uuidv4(),
    userId: req.user.id,
    carrier: String(carrier).toLowerCase(),
    trackingNumber: String(trackingNumber).trim(),
    contactId: contactId || null,
    label: label || '',
    notes: notes || '',
    cost: parsedCost !== null ? encryptField(String(parsedCost)) : null,
    currency: parsedCost !== null ? (currency || 'USD').toUpperCase() : null,
    category: CATEGORIES.includes(category) ? category : 'other',
    photo: photo ? encryptField(stripImageMetadata(photo)) : null,
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
    customsAlertedAt: null,
    archived: false,
    messages: [],
    followers: [],
    createdAt: new Date().toISOString(),
  };

  await update((data) => {
    data.shipments.push(shipment);
  });

  // Respond right away - the live carrier lookup below can take a few
  // seconds, and there's no reason to make the user stare at a spinner
  // for it. The shipment shows as "Label created" until that finishes
  // (or until the next scheduler cycle / a manual refresh).
  res.status(201).json(decryptForOwner(shipment));

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
      pushSystemMessage(s, `Initial status: ${result.statusLabel}`);
      pushNotification(data, {
        userId: s.userId,
        shipmentId: s.id,
        title: `Shipment added: ${s.trackingNumber} (${s.carrier.toUpperCase()})`,
        message: `Initial status: ${result.statusLabel}`,
        level: 'info',
        type: 'status',
      });
      applyCustomsAlert(data, s, result);
    });
  } catch (err) {
    console.error('Could not fetch initial tracking:', err.message);
  }
});

// Joins someone else's shared shipment (from its /s/:token public link) as
// a follower: read-only access to the tracking info plus the chat, so two
// different accounts - not co-owners, not the same space - can talk about
// one shipment (e.g. a seller and a buyer).
router.post('/follow', async (req, res) => {
  const { shareToken } = req.body || {};
  if (!shareToken) return res.status(400).json({ error: 'Share link is required.' });

  const db = await readDB();
  const shipment = db.shipments.find((s) => s.shareToken === shareToken);
  if (!shipment) return res.status(404).json({ error: 'This share link is no longer valid.' });

  const spaceUserIds = getSpaceUserIds(db, req.user.id);
  if (spaceUserIds.includes(shipment.userId)) {
    return res.status(400).json({ error: 'This is already one of your own shipments.' });
  }

  let updated = null;
  await update((data) => {
    const s = data.shipments.find((x) => x.id === shipment.id);
    s.followers ||= [];
    if (!s.followers.includes(req.user.id)) s.followers.push(req.user.id);
    updated = s;
  });
  await logAudit({ userId: req.user.id, action: 'accept_invite', shipmentId: shipment.id, req });
  res.json(sanitizeForFollower(updated));
});

router.post('/:id/unfollow', async (req, res) => {
  const db = await readDB();
  const shipment = db.shipments.find((s) => s.id === req.params.id);
  if (!shipment) return res.status(404).json({ error: 'Shipment not found.' });

  await update((data) => {
    const s = data.shipments.find((x) => x.id === shipment.id);
    s.followers = (s.followers || []).filter((id) => id !== req.user.id);
  });
  res.status(204).end();
});

router.get('/:id', async (req, res) => {
  const db = await readDB();
  const spaceUserIds = getSpaceUserIds(db, req.user.id);
  const shipment = db.shipments.find((s) => s.id === req.params.id);
  if (!shipment) return res.status(404).json({ error: 'Shipment not found.' });
  if (spaceUserIds.includes(shipment.userId)) {
    // Only the owner side is audited - this is about who saw the private
    // fields (photo, cost), and followers never receive those anyway.
    await logAudit({ userId: req.user.id, action: 'view_shipment', shipmentId: shipment.id, req });
    return res.json(decryptForOwner(shipment));
  }
  if ((shipment.followers || []).includes(req.user.id)) return res.json(sanitizeForFollower(shipment));
  return res.status(404).json({ error: 'Shipment not found.' });
});

// Force a manual refresh of ONE shipment (besides the automatic refresh every 30 min).
router.post('/:id/refresh', refreshLimiter, async (req, res) => {
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
        pushSystemMessage(s, `Status: ${result.statusLabel}`);
        pushNotification(data, {
          userId: s.userId,
          shipmentId: s.id,
          title: `Shipment ${s.trackingNumber} (${s.carrier.toUpperCase()})`,
          message: `New status: ${result.statusLabel}`,
          level: result.status === 'delivered' ? 'success' : 'info',
          type: 'status',
        });
      }
      const delayReason = checkDelay(s);
      if (delayReason) {
        pushSystemMessage(s, `Possible delay: ${delayReason}`);
        pushNotification(data, {
          userId: s.userId,
          shipmentId: s.id,
          title: `Possible delay: ${s.trackingNumber} (${s.carrier.toUpperCase()})`,
          message: delayReason,
          level: 'warning',
          type: 'delay',
        });
      }
      applyCustomsAlert(data, s, result);
      updated = s;
    });
    res.json(decryptForOwner(updated));
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
  await logAudit({ userId: req.user.id, action: 'create_share_link', shipmentId: shipment.id, req });

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
  res.json(decryptForOwner(updated));
});

// A per-shipment message thread. Open to the owner's whole space AND to
// anyone following the shipment via its share link (see POST /follow) -
// this is the "communicator" feature: two different Sputnik Ship accounts
// can talk about one shipment, e.g. "left it with the doorman".
router.post('/:id/messages', writeLimiter, async (req, res) => {
  const { text, photo } = req.body || {};
  const trimmedText = text ? String(text).trim() : '';
  if (!trimmedText && !photo) return res.status(400).json({ error: 'Write a message or attach a photo.' });
  // Same allowlist as a shipment's own photo field (see POST / above).
  if (photo && !/^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/]+=*$/.test(photo)) {
    return res.status(400).json({ error: 'Photo must be a valid image.' });
  }

  const db = await readDB();
  const spaceUserIds = getSpaceUserIds(db, req.user.id);
  const shipment = db.shipments.find((s) => s.id === req.params.id);
  if (!shipment) return res.status(404).json({ error: 'Shipment not found.' });
  const isOwnerSide = spaceUserIds.includes(shipment.userId);
  const isFollower = (shipment.followers || []).includes(req.user.id);
  if (!isOwnerSide && !isFollower) return res.status(404).json({ error: 'Shipment not found.' });
  if (shipment.status === 'delivered') {
    return res.status(403).json({ error: 'This shipment was delivered - the conversation is closed.' });
  }

  let updated = null;
  await update((data) => {
    const s = data.shipments.find((x) => x.id === shipment.id);
    const author = data.users.find((u) => u.id === req.user.id);
    const msg = {
      id: uuidv4(),
      userId: req.user.id,
      handle: author ? author.handle : 'unknown',
      text: trimmedText.slice(0, 2000),
      photo: photo ? stripImageMetadata(photo) : null,
      createdAt: new Date().toISOString(),
    };
    s.messages ||= [];
    s.messages.push(msg);
    if (photo) pushSystemMessage(s, 'Photo delivered · location and device data stripped.');

    const title = `New message on ${s.label || s.trackingNumber}`;
    const message = `@${msg.handle}: ${photo ? (trimmedText || '📷 Photo') : msg.text}`;
    // The owner's space (everyone but the sender, if the sender is on that side).
    pushNotification(data, {
      userId: s.userId,
      shipmentId: s.id,
      title,
      message,
      level: 'info',
      type: 'chat',
      excludeUserId: req.user.id,
    });
    // Anyone else following along (everyone but the sender, if the sender
    // is a follower) - a separate fan-out since followers aren't part of
    // the owner's space.
    const otherFollowers = (s.followers || []).filter((id) => id !== req.user.id);
    if (otherFollowers.length) {
      pushNotificationToUsers(data, {
        userIds: otherFollowers,
        shipmentId: s.id,
        title,
        message,
        level: 'info',
        type: 'chat',
      });
    }
    updated = s;
  });
  res.json(isOwnerSide ? decryptForOwner(updated) : sanitizeForFollower(updated));
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
router.post('/refresh-all/now', refreshLimiter, async (req, res) => {
  await refreshAllShipments();
  const db = await readDB();
  const spaceUserIds = getSpaceUserIds(db, req.user.id);
  const shipments = db.shipments.filter((s) => spaceUserIds.includes(s.userId)).map(decryptForOwner);
  res.json({ ok: true, shipments });
});

module.exports = router;
