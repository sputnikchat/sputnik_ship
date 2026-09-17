const { v4: uuidv4 } = require('uuid');

// Append-only: nothing in this codebase should ever remove or edit an
// entry once it's written (unlike data.notifications, which is trimmed).
// Call inside an existing services/store.js update(data => ...) so the
// entry lands in the same write as whatever action triggered it.
function logAudit(data, { userId, action, shipmentId = null, req = null }) {
  data.auditLog ||= [];
  data.auditLog.push({
    id: uuidv4(),
    userId,
    action,
    shipmentId,
    ip: req?.ip || null,
    userAgent: req?.headers?.['user-agent'] || null,
    createdAt: new Date().toISOString(),
  });
}

module.exports = { logAudit };
