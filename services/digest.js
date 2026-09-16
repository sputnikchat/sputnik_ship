// A single daily notification instead of N separate ones: "2 arriving
// today, 1 delayed" beats getting paged once per checkpoint. Runs once a
// day (see scheduler.js) and only fires for a space when there's
// actually something to say - no "all clear" noise every morning.

const { update } = require('./store');
const { pushNotification } = require('./notify');
const { spaceIdOf } = require('./space');

async function sendDailyDigest() {
  await update((data) => {
    const spaces = new Map(); // spaceId -> { representativeUserId, shipments: [] }
    for (const shipment of data.shipments) {
      if (shipment.status === 'delivered' || shipment.archived) continue;
      const owner = data.users.find((u) => u.id === shipment.userId);
      if (!owner) continue;
      const spaceId = spaceIdOf(owner);
      if (!spaces.has(spaceId)) spaces.set(spaceId, { representativeUserId: owner.id, shipments: [] });
      spaces.get(spaceId).shipments.push(shipment);
    }

    const todayStr = new Date().toDateString();
    for (const { representativeUserId, shipments } of spaces.values()) {
      const arrivingToday = shipments.filter(
        (s) => s.estimatedDelivery && new Date(s.estimatedDelivery).toDateString() === todayStr
      );
      const delayed = shipments.filter((s) => s.delayFlagged);
      if (!arrivingToday.length && !delayed.length) continue; // nothing worth interrupting anyone for

      const parts = [];
      if (arrivingToday.length) parts.push(`${arrivingToday.length} arriving today`);
      if (delayed.length) parts.push(`${delayed.length} delayed`);

      pushNotification(data, {
        userId: representativeUserId,
        shipmentId: null,
        title: 'Daily shipment summary',
        message: parts.join(', ') + '.',
        level: delayed.length ? 'warning' : 'info',
        type: 'digest',
      });
    }
  });
}

module.exports = { sendDailyDigest };
