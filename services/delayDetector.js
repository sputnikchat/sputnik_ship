// Heuristic delay flagging - no ML, no external prediction service, just
// two honest rules checked on every tracking refresh:
//   1. Overdue: past its own estimated delivery date and still not delivered.
//   2. Stalled: no new checkpoint in STALE_DAYS while still active - the
//      courier's own timeline may not have caught up yet, but a package
//      that hasn't moved in this long is worth a heads-up either way.
//
// Call checkDelay(shipment) right after applying a tracking result, inside
// the same store.update() - it mutates shipment.delayFlagged and returns
// a human-readable reason exactly once per newly-detected delay (not on
// every refresh), so callers can turn that into a single notification.
// Returns null when nothing changed or the delay already had its alert.

const STALE_DAYS = 5;

function checkDelay(shipment) {
  if (shipment.status === 'delivered' || shipment.archived) {
    shipment.delayFlagged = false;
    return null;
  }

  const now = new Date();
  let reason = null;

  if (shipment.estimatedDelivery && new Date(shipment.estimatedDelivery) < now) {
    reason = 'Past its estimated delivery date.';
  } else if (shipment.checkpoints?.length) {
    const last = shipment.checkpoints[shipment.checkpoints.length - 1];
    if (last?.timestamp) {
      const daysSince = (now - new Date(last.timestamp)) / (1000 * 60 * 60 * 24);
      if (daysSince > STALE_DAYS) {
        reason = `No update from the courier in ${Math.floor(daysSince)} days.`;
      }
    }
  }

  if (reason && !shipment.delayFlagged) {
    shipment.delayFlagged = true;
    return reason;
  }
  if (!reason && shipment.delayFlagged) {
    shipment.delayFlagged = false; // recovered on its own - a fresh alert can fire again later if it stalls again
  }
  return null;
}

module.exports = { checkDelay };
