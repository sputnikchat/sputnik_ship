const cron = require('node-cron');
const { readDB, update } = require('./store');
const { getTrackingUpdate, canTrack } = require('./carrierProviders');
const { pushNotification, pushSystemMessage, applyCustomsAlert } = require('./notify');
const { checkDelay } = require('./delayDetector');
const { sendDailyDigest } = require('./digest');
const { geocodeLocation } = require('./geocode');

// Delivered shipments are never re-tracked, so one whose places couldn't be
// geocoded at the time (e.g. the geocoder was refusing Render's IP) kept an
// empty map forever. This rebuilds the route from the stored checkpoint
// labels ("<status> · <place>") - geocoding only, no courier lookup.
// Returns the fields to apply, or null when no place could be geocoded.
async function buildMissingRoute(shipment) {
  const points = [];
  for (const cp of shipment.checkpoints) {
    const sep = cp.label.lastIndexOf(' · ');
    const point = sep === -1 ? null : await geocodeLocation(cp.label.slice(sep + 3));
    if (point) points.push({ label: cp.label, lat: point.lat, lng: point.lng, timestamp: cp.timestamp });
  }
  if (!points.length) return null;
  return {
    fullRoute: points,
    checkpointIndex: points.length - 1,
    currentLocation: points[points.length - 1],
  };
}

function applyTrackingResult(data, shipment, result) {
  const statusChanged = result.status !== shipment.status;

  Object.assign(shipment, {
    status: result.status,
    statusLabel: result.statusLabel,
    checkpointIndex: result.checkpointIndex,
    fullRoute: result.fullRoute,
    checkpoints: result.checkpoints,
    currentLocation: result.currentLocation,
    estimatedDelivery: result.estimatedDelivery,
    providerRef: result.providerRef || shipment.providerRef,
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
}

// Refreshes tracking for all active (not-delivered) shipments and
// generates a notification whenever the status changes. `filter` narrows
// it to a subset (e.g. one user's space for the manual "refresh all"
// button) - without it, any logged-in user pressing that button would
// fan out a courier API lookup for EVERY user's shipments.
//
// The courier and geocoder calls take seconds each (minutes for a full
// run), and update() is the single write queue for the whole app: doing
// them inside it froze every chat message, login and session rotation
// until the run finished. So the network work happens against a readDB()
// snapshot, and only applying the results takes the queue - re-finding
// each shipment by id, since it may have been edited or deleted meanwhile.
async function refreshAllShipments(filter = null) {
  const snapshot = await readDB();
  const open = snapshot.shipments.filter((s) => s.status !== 'delivered' && !s.archived && (!filter || filter(s)));
  // Couriers without a connected API (no credentials, or air/ocean cargo)
  // aren't looked up; they keep their last data.
  const active = open.filter((s) => canTrack(s.carrier));
  const missingRoute = snapshot.shipments.filter(
    (s) => !active.includes(s) && s.checkpoints?.length && !s.fullRoute?.length && (!filter || filter(s))
  );

  const tracked = [];
  for (const shipment of active) {
    try {
      const result = await getTrackingUpdate(shipment.carrier, shipment.trackingNumber, shipment);
      tracked.push({ id: shipment.id, carrier: shipment.carrier, trackingNumber: shipment.trackingNumber, result });
    } catch (err) {
      console.error(`Error updating shipment ${shipment.id}:`, err.message);
    }
  }

  const repaired = [];
  for (const shipment of missingRoute) {
    try {
      const fields = await buildMissingRoute(shipment);
      if (fields) repaired.push({ id: shipment.id, fields });
    } catch (err) {
      console.error(`Error repairing route of shipment ${shipment.id}:`, err.message);
    }
  }

  if (!tracked.length && !repaired.length) return;

  await update((data) => {
    for (const { id, carrier, trackingNumber, result } of tracked) {
      const shipment = data.shipments.find((s) => s.id === id);
      // Deleted meanwhile, or re-pointed at another parcel: this result is stale.
      if (!shipment || shipment.carrier !== carrier || shipment.trackingNumber !== trackingNumber) continue;
      try {
        applyTrackingResult(data, shipment, result);
      } catch (err) {
        console.error(`Error updating shipment ${shipment.id}:`, err.message);
      }
    }
    for (const { id, fields } of repaired) {
      const shipment = data.shipments.find((s) => s.id === id);
      if (!shipment || shipment.fullRoute?.length) continue; // deleted, or already has a route now
      Object.assign(shipment, fields);
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
