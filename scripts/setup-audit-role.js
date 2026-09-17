// One-time setup: creates the audit_log table and a Postgres role
// (sputnik_audit_writer) that can only INSERT into it - no SELECT,
// UPDATE, DELETE or TRUNCATE. This is what makes the audit log genuinely
// append-only, enforced by Postgres itself instead of by a comment in
// application code.
//
// Run with DATABASE_URL pointing at an admin-level role (the one that
// can CREATE ROLE / GRANT - Supabase's default "postgres" project role
// qualifies). It writes the resulting AUDIT_DATABASE_URL straight into
// .env and never prints the password to the terminal.
//
// Safe to re-run: CREATE TABLE IF NOT EXISTS, and an existing role just
// gets its password rotated (skipped if .env already has the value, so
// re-running doesn't silently invalidate a value already deployed to
// Render - remove the line from .env first if you want a fresh rotation).
//
//   node scripts/setup-audit-role.js

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Pool } = require('pg');

const ENV_PATH = path.join(__dirname, '..', '.env');
const ROLE = 'sputnik_audit_writer';
// Supabase grants these platform roles broad default privileges on any
// new table in `public` automatically - revoking PUBLIC alone doesn't
// touch these, so a table created without this step would be writable
// by anyone holding the Supabase service_role key, bypassing the whole
// point of a restricted writer role.
const SUPABASE_DEFAULT_ROLES = ['anon', 'authenticated', 'service_role'];

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not set - this script needs the admin-level connection string.');
  }
  const adminUrl = new URL(process.env.DATABASE_URL);
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

  await pool.query(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id UUID PRIMARY KEY,
      user_id TEXT,
      action TEXT NOT NULL,
      shipment_id TEXT,
      ip TEXT,
      user_agent TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  console.log('1) audit_log table created (or already existed)');

  const password = crypto.randomBytes(24).toString('base64url');
  const roleExists = await pool.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [ROLE]);
  if (roleExists.rows.length === 0) {
    await pool.query(`CREATE ROLE ${ROLE} WITH LOGIN PASSWORD '${password}'`);
    console.log('2) role created:', ROLE);
  } else {
    await pool.query(`ALTER ROLE ${ROLE} WITH LOGIN PASSWORD '${password}'`);
    console.log('2) role already existed - password rotated:', ROLE);
  }

  await pool.query('REVOKE ALL ON audit_log FROM PUBLIC');
  for (const role of SUPABASE_DEFAULT_ROLES) {
    await pool.query(`REVOKE ALL ON audit_log FROM ${role}`);
  }
  await pool.query(`GRANT INSERT ON audit_log TO ${ROLE}`);
  await pool.query(`GRANT USAGE ON SCHEMA public TO ${ROLE}`);
  console.log('3) privileges set: INSERT only for', ROLE, '- PUBLIC and Supabase default roles revoked');

  const grants = await pool.query(
    "SELECT grantee, privilege_type FROM information_schema.role_table_grants WHERE table_name = 'audit_log' ORDER BY grantee, privilege_type"
  );
  console.log('4) current grants on audit_log:', JSON.stringify(grants.rows));

  // Supabase's connection pooler expects <role>.<project-ref> as the
  // username, same pattern the existing postgres.<ref> DATABASE_URL uses.
  const projectRef = adminUrl.username.split('.')[1];
  const roleUser = projectRef ? `${ROLE}.${projectRef}` : ROLE;
  const auditUrl = new URL(process.env.DATABASE_URL);
  auditUrl.username = roleUser;
  auditUrl.password = password;
  const auditConnectionString = auditUrl.toString();

  // Verify the credential actually connects and can INSERT before
  // writing anything, then clean up that one proof row - so .env never
  // ends up with a broken value and the table isn't left with test noise.
  const testPool = new Pool({ connectionString: auditConnectionString, ssl: { rejectUnauthorized: false } });
  const testId = crypto.randomUUID();
  await testPool.query('INSERT INTO audit_log (id, user_id, action) VALUES ($1, $2, $3)', [testId, 'setup-script', 'role_setup_verification']);
  await testPool.end();
  await pool.query('DELETE FROM audit_log WHERE id = $1', [testId]); // admin connection - the writer role itself can't do this
  console.log('5) verified the restricted role can connect and INSERT');

  const envContent = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, 'utf-8') : '';
  if (!envContent.includes('AUDIT_DATABASE_URL=')) {
    fs.appendFileSync(ENV_PATH, `\nAUDIT_DATABASE_URL=${auditConnectionString}\n`);
    console.log('6) AUDIT_DATABASE_URL appended to .env (value not printed to the terminal)');
  } else {
    console.log('6) .env already has AUDIT_DATABASE_URL - left untouched. Remove that line first to write a rotated value.');
  }

  await pool.end();
}

main().catch((err) => {
  console.error('FAILED:', err.message);
  process.exit(1);
});
