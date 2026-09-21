// Unauthenticated routes for shipment share links (sputnikship.app/s/<token>).
// Deliberately does NOT use requireAuth - anyone with the link can view
// the tracking info, same as handing someone a tracking number directly.
// Only logistics fields are exposed here; the linked contact (recipient
// name/address) never leaves the owner's own account.

const express = require('express');
const rateLimit = require('express-rate-limit');
const { readDB } = require('../services/store');

const router = express.Router();

// Share tokens are 72 random bits, so guessing one isn't realistic - this
// limit is about cost: every lookup reads the whole database document,
// and this is the one route anyone on the internet can hit without an
// account.
router.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please wait a few minutes and try again.' },
}));

router.get('/shipments/:token', async (req, res) => {
  const db = await readDB();
  const shipment = db.shipments.find((s) => s.shareToken === req.params.token);
  if (!shipment) return res.status(404).json({ error: 'This share link is no longer valid.' });

  // The sender's @handle is already what followers see on every chat
  // message, so showing it on the invitation reveals nothing new - and
  // "@joice sent you a package" is the whole reason to open the link.
  const owner = db.users.find((u) => u.id === shipment.userId);
  res.json({
    sharedBy: owner ? owner.handle : null,
    carrier: shipment.carrier,
    trackingNumber: shipment.trackingNumber,
    label: shipment.label,
    status: shipment.status,
    statusLabel: shipment.statusLabel,
    checkpointIndex: shipment.checkpointIndex,
    checkpoints: shipment.checkpoints,
    fullRoute: shipment.fullRoute,
    estimatedDelivery: shipment.estimatedDelivery,
    lastCheckedAt: shipment.lastCheckedAt,
  });
});

module.exports = router;
