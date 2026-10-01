const cron = require('node-cron');
const { update } = require('./store');
const { getTrackingUpdate } = require('./carrierProviders');
const { pushNotification, pushSystemMessage, applyCustomsAlert } = require('./notify');
const { checkDelay } = require('./delayDetector');
const { sendDailyDigest } = require('./digest');
const { geocodeLocation } = require('./geocode');

// Delivered shipments are never re-tracked, so one whose places couldn't be
// geocoded at the time (e.g. the geocoder was refusing Render's IP) kept an
// empty map forever. This rebuilds the route from the stored checkpoint
// labels ("<status> · <place>") - geocoding only, no paid Ship24 lookup.
async function repairMissingRoute(shipment) {
  const points = [];
  for (const cp of shipment.checkpoints) {
    const sep = cp.label.lastIndexOf(' · ');
    const point = sep === -1 ? null : await geocodeLocation(cp.label.slice(sep + 3));
    if (point) points.push({ label: cp.label, lat: point.lat, lng: point.lng, timestamp: cp.timestamp });
  }
  if (!points.length) return;
  Object.assign(shipment, {
    fullRoute: points,
    checkpointIndex: points.length - 1,
    currentLocation: points[points.length - 1],
  });
}

// Refreshes tracking for all active (not-delivered) shipments and
// generates a notification whenever the status changes. `filter` narrows
// it to a subset (e.g. one user's space for the manual "refresh all"
// button) - without it, any logged-in user pressing that button would
// fan out a paid Ship24 lookup for EVERY user's shipments.
async function refreshAllShipments(filter = null) {
  await update(async (data) => {
    const active = data.shipments.filter((s) => s.status !== 'delivered' && !s.archived && (!filter || filter(s)));
    for (const shipment of active) {
      try {
        const result = await getTrackingUpdate(shipment.carrier, shipment.trackingNumber, shipment);
        const statusChanged = result.status !== shipment.status;

        Object.assign(shipment, {
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
          pushSystemMessage(shipment, `Status: ${result.statusLabel}`);
          pushNotification(data, {
            userId: shipment.userId,
            shipmentId: shipment.id,
            title: `Shipment ${shipment.trackingNumber} (${shipment.carrier.toUpperCase()})`,
            message: `New status: ${result.statusLabel}`,
            level: result.status === 'delivered' ? 'success' : 'info',
            type: 'status',
          });
        }

        const delayReason = checkDelay(shipment);
        if (delayReason) {
          pushSystemMessage(shipment, `Possible delay: ${delayReason}`);
          pushNotification(data, {
            userId: shipment.userId,
            shipmentId: shipment.id,
            title: `Possible delay: ${shipment.trackingNumber} (${shipment.carrier.toUpperCase()})`,
            message: delayReason,
            level: 'warning',
            type: 'delay',
          });
        }

        applyCustomsAlert(data, shipment, result);
      } catch (err) {
        console.error(`Error updating shipment ${shipment.id}:`, err.message);
      }
    }

    const missingRoute = data.shipments.filter(
      (s) => !active.includes(s) && s.checkpoints?.length && !s.fullRoute?.length && (!filter || filter(s))
    );
    for (const shipment of missingRoute) {
      try {
        await repairMissingRoute(shipment);
      } catch (err) {
        console.error(`Error repairing route of shipment ${shipment.id}:`, err.message);
      }
    }
  });
}

function startScheduler() {
  const minutes = Number(process.env.TRACKING_REFRESH_MINUTES || 30);
  const cronExpr = `*/${minutes} * * * *`;
  console.log(`Tracking scheduler active: shipments refresh every ${minutes} minute(s).`);
  cron.schedule(cronExpr, () => {
    refreshAllShipments().catch((err) => console.error('Error in scheduled refresh:', err));
  });

  // Once a day. Runs in the server's own timezone (set TZ in the
  // environment if that's not where most users are) - an honest limit
  // of not knowing each user's actual timezone.
  const digestTime = process.env.DIGEST_TIME || '08:00';
  const [digestHour, digestMinute] = digestTime.split(':').map(Number);
  console.log(`Daily digest active: runs at ${digestTime} server time.`);
  cron.schedule(`${digestMinute} ${digestHour} * * *`, () => {
    sendDailyDigest().catch((err) => console.error('Error sending daily digest:', err));
  });
}

module.exports = { startScheduler, refreshAllShipments };
