const express = require('express');
const { readDB } = require('../services/store');
const { requireAuth } = require('../middleware/auth');
const { getSpaceUserIds } = require('../services/space');

const router = express.Router();
router.use(requireAuth);

const CARRIER_LABEL = { fedex: 'FedEx', ups: 'UPS', dhl: 'DHL', usps: 'USPS', air_cargo: 'Air Cargo (AWB)', ocean_cargo: 'Ocean Cargo (MBL)' };

// Best-effort delivery timestamp: the last checkpoint's time for a
// delivered shipment. Checkpoints are stored oldest-first (the UI
// reverses them for display), so the last entry is the most recent one.
function deliveredAt(shipment) {
  if (shipment.status !== 'delivered' || !shipment.checkpoints?.length) return null;
  return shipment.checkpoints[shipment.checkpoints.length - 1].timestamp || null;
}

router.get('/passport', async (req, res) => {
  const db = await readDB();
  const spaceUserIds = getSpaceUserIds(db, req.user.id);
  let shipments = db.shipments.filter((s) => spaceUserIds.includes(s.userId));

  const { year } = req.query;
  if (year && year !== 'all') {
    shipments = shipments.filter((s) => new Date(s.createdAt).getFullYear() === Number(year));
  }

  const years = Array.from(
    new Set(db.shipments.filter((s) => spaceUserIds.includes(s.userId)).map((s) => new Date(s.createdAt).getFullYear()))
  ).sort((a, b) => b - a);

  const courierBreakdown = {};
  for (const s of shipments) {
    courierBreakdown[s.carrier] = (courierBreakdown[s.carrier] || 0) + 1;
  }
  const couriers = Object.entries(courierBreakdown)
    .map(([carrier, count]) => ({ carrier, label: CARRIER_LABEL[carrier] || carrier.toUpperCase(), count }))
    .sort((a, b) => b.count - a.count);

  const deliveries = shipments
    .map((s) => {
      const at = deliveredAt(s);
      if (!at) return null;
      const days = (new Date(at) - new Date(s.createdAt)) / (1000 * 60 * 60 * 24);
      return { days, carrier: s.carrier, label: s.label || s.trackingNumber };
    })
    .filter(Boolean);

  const avgDeliveryDays = deliveries.length
    ? deliveries.reduce((sum, d) => sum + d.days, 0) / deliveries.length
    : null;

  const fastest = deliveries.length
    ? deliveries.reduce((best, d) => (d.days < best.days ? d : best))
    : null;

  const contactsShippedTo = new Set(shipments.filter((s) => s.contactId).map((s) => s.contactId)).size;

  const allTimeShipments = db.shipments.filter((s) => spaceUserIds.includes(s.userId));
  const firstShipmentDate = allTimeShipments.length
    ? allTimeShipments.reduce((earliest, s) => (new Date(s.createdAt) < new Date(earliest) ? s.createdAt : earliest), allTimeShipments[0].createdAt)
    : null;

  res.json({
    years,
    totalShipments: shipments.length,
    delivered: shipments.filter((s) => s.status === 'delivered').length,
    couriers,
    avgDeliveryDays,
    fastest: fastest ? { days: fastest.days, carrier: fastest.carrier, label: fastest.label } : null,
    contactsShippedTo,
    firstShipmentDate,
  });
});

module.exports = router;
