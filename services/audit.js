// Append-only audit log, enforced by Postgres itself - not by code
// convention. Lives in its own `audit_log` table (see the one-time setup,
// scripts/setup-audit-role.js), written through a SEPARATE
// connection authenticated as `sputnik_audit_writer`, a role that only
// has INSERT on this one table (no SELECT/UPDATE/DELETE/TRUNCATE,
// verified directly against Postgres - see the encryption/audit-log
// conversation this came out of). The app's regular DATABASE_URL role
// keeps full access, since that's still the admin credential used for
// setup; this only locks down the credential the running app actually
// holds day to day, and only for this one table.
//
// Honest limit: this stops a code bug or a leak of just
// AUDIT_DATABASE_URL from tampering with the log. It does NOT stop
// someone who has DATABASE_URL itself (Supabase's project-owner role),
// since that role can always re-grant itself privileges. True immunity
// to that would mean the running app never holding an admin-level
// credential at all - a bigger change than this table asked for.
const { v4: uuidv4 } = require('uuid');
const { Pool } = require('pg');

if (!process.env.AUDIT_DATABASE_URL) {
  throw new Error(
    'AUDIT_DATABASE_URL is not set. Run scripts/setup-audit-role.js once (with DATABASE_URL pointing at an admin-level Postgres role) to create the audit_log table and its restricted role, then put the connection string it writes into .env.'
  );
}

const pool = new Pool({ connectionString: process.env.AUDIT_DATABASE_URL, ssl: { rejectUnauthorized: false } });

// Same reasoning as services/store.js's pool: an idle client getting
// disconnected by Supabase's pooler emits 'error' on the pool itself,
// and with no listener that's an uncaught exception that kills the
// whole process - unrelated to any specific request.
pool.on('error', (err) => {
  console.error('Unexpected error on idle Postgres client (audit_log pool):', err.message);
});

// Callers await this inside plain Express handlers with no try/catch,
// so a transient failure here (a network blip, the pooler recycling a
// connection mid-query) must never become an uncaught rejection that
// takes the whole server down over a missed audit entry - it's
// supplementary telemetry, not something worth trading availability for.
async function logAudit({ userId, action, shipmentId = null, req = null }) {
  try {
    await pool.query(
      'INSERT INTO audit_log (id, user_id, action, shipment_id, ip, user_agent) VALUES ($1, $2, $3, $4, $5, $6)',
      [uuidv4(), userId, action, shipmentId, req?.ip || null, req?.headers?.['user-agent'] || null]
    );
  } catch (err) {
    console.error('Could not write audit log entry:', err.message);
  }
}

module.exports = { logAudit };
