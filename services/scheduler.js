const cron = require('node-cron');
const { update } = require('./store');
const { getTrackingUpdate } = require('./carrierProviders');
const { pushNotification } = require('./notify');

// Refresca el tracking de todos los envios activos (no entregados) y
// genera una notificacion cuando el estado cambia.
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
            title: `Envio ${shipment.trackingNumber} (${shipment.carrier.toUpperCase()})`,
            message: `Nuevo estado: ${result.statusLabel}`,
            level: result.status === 'delivered' ? 'success' : 'info',
          });
        }
      } catch (err) {
        console.error(`Error actualizando el envio ${shipment.id}:`, err.message);
      }
    }
  });
}

function startScheduler() {
  const minutes = Number(process.env.TRACKING_REFRESH_MINUTES || 30);
  const cronExpr = `*/${minutes} * * * *`;
  console.log(`Scheduler de tracking activo: se actualizan los envios cada ${minutes} minuto(s).`);
  cron.schedule(cronExpr, () => {
    refreshAllShipments().catch((err) => console.error('Error en el refresh programado:', err));
  });
}

module.exports = { startScheduler, refreshAllShipments };
