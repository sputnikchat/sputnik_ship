// Unauthenticated routes for shipment share links (sputnikship.app/s/<token>).
// Deliberately does NOT use requireAuth - anyone with the link can view
// the tracking info, same as handing someone a tracking number directly.
// Only logistics fields are exposed here; the linked contact (recipient
// name/address) never leaves the owner's own account.

const express = require('express');
const { readDB } = require('../services/store');

const router = express.Router();

router.get('/shipments/:token', async (req, res) => {
  const db = await readDB();
  const shipment = db.shipments.find((s) => s.shareToken === req.params.token);
  if (!shipment) return res.status(404).json({ error: 'This share link is no longer valid.' });

  res.json({
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
