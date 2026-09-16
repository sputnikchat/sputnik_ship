const cron = require('node-cron');
const { update } = require('./store');
const { getTrackingUpdate } = require('./carrierProviders');
const { pushNotification } = require('./notify');

// Refreshes tracking for all active (not-delivered) shipments and
// generates a notification whenever the status changes.
async function refreshAllShipments() {
  await update(async (data) => {
    const active = data.shipments.filter((s) => s.status !== 'delivered' && !s.archived);
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
          pushNotification(data, {
            userId: shipment.userId,
            shipmentId: shipment.id,
            title: `Shipment ${shipment.trackingNumber} (${shipment.carrier.toUpperCase()})`,
            message: `New status: ${result.statusLabel}`,
            level: result.status === 'delivered' ? 'success' : 'info',
          });
        }
      } catch (err) {
        console.error(`Error updating shipment ${shipment.id}:`, err.message);
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
}

module.exports = { startScheduler, refreshAllShipments };
