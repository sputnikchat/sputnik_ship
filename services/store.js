// Storage backed by Postgres (Supabase), keeping the whole app's data as a
// single JSON document instead of normalized tables. This app started on a
// local JSON file (data/db.json) - every free host's filesystem is wiped on
// each redeploy/restart, so that couldn't survive a real deploy. Postgres
// fixes that, and storing one jsonb document (instead of splitting users/
// contacts/shipments/notifications into separate tables) means routes/*.js
// didn't have to change at all: readDB()/update() still return/mutate the
// exact same in-memory shape they always did.
//
// If the project outgrows this (thousands of shipments, need for real SQL
// queries/indexes), that's the point to split into proper tables - this
// trades query power for a near-zero-risk migration today.

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const DB_FILE = path.join(__dirname, '..', 'data', 'db.json');

function defaultData() {
  return {
    users: [],
    contacts: [],
    shipments: [],
    notifications: [],
    pushSubscriptions: [],
    spaceInvites: [],
  };
}

if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL is not set. Copy .env.example to .env and set it to your Supabase project\'s connection string (Project Settings > Database > Connection string > URI).'
  );
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }, // Supabase requires SSL; its cert chain isn't in Node's default trust store.
});

// node-postgres emits 'error' on the pool whenever an IDLE client gets
// disconnected from the backend (Supabase's pooler does this routinely,
// not an outage) - with no listener, that's an uncaught exception that
// kills the whole Node process. This isn't a query failure; it's
// unrelated background housekeeping and must not crash live requests.
pool.on('error', (err) => {
  console.error('Unexpected error on idle Postgres client (app_state pool):', err.message);
});

const ROW_ID = 1;
let ensured = null;

// Supabase automatically exposes every table in the `public` schema
// through its REST API (PostgREST) and grants its platform roles - anon,
// authenticated, service_role - full access to new tables there. This
// table holds the ENTIRE app (password hashes, contacts, messages), so
// with those defaults anyone holding the project's anon key, which
// Supabase treats as public, could download it over HTTPS. The app itself
// never goes through that API: it connects directly as the table's owner.
//
// Two independent locks, applied on every boot (both are idempotent):
//  - Row Level Security with no policies: the REST roles see zero rows.
//    The owner role this app connects as is exempt from RLS (it isn't
//    FORCEd), so the app keeps working exactly as before.
//  - The platform roles' grants are revoked outright, the same treatment
//    scripts/setup-audit-role.js already gives audit_log.
// Each statement is tried separately and only logged on failure: on a
// plain Postgres without Supabase's roles the REVOKEs simply don't apply,
// and a missing permission must never keep the app from starting.
async function lockDownTable() {
  const statements = [
    'ALTER TABLE app_state ENABLE ROW LEVEL SECURITY',
    'REVOKE ALL ON app_state FROM PUBLIC',
    'REVOKE ALL ON app_state FROM anon',
    'REVOKE ALL ON app_state FROM authenticated',
    'REVOKE ALL ON app_state FROM service_role',
  ];
  for (const sql of statements) {
    try {
      await pool.query(sql);
    } catch (err) {
      if (!/does not exist/i.test(err.message)) {
        console.error(`Could not apply "${sql}":`, err.message);
      }
    }
  }
}

// Creates the table on first use and seeds it from the old data/db.json if
// one exists locally (so demo/test data made before this migration isn't
// lost), otherwise from an empty document. Safe to call every time - it's
// memoized so the CREATE/seed only actually runs once per process.
function ensureReady() {
  if (!ensured) {
    ensured = (async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS app_state (
          id INT PRIMARY KEY,
          data JSONB NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `);
      const { rows } = await pool.query('SELECT 1 FROM app_state WHERE id = $1', [ROW_ID]);
      if (rows.length === 0) {
        let seed = defaultData();
        if (fs.existsSync(DB_FILE)) {
          try {
            seed = JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
            console.log('Seeded Postgres from existing data/db.json.');
          } catch (e) {
            console.error('Could not parse data/db.json, starting empty:', e.message);
          }
        }
        await pool.query('INSERT INTO app_state (id, data) VALUES ($1, $2)', [ROW_ID, seed]);
      }
      await lockDownTable();
    })();
  }
  return ensured;
}

async function readDB() {
  await ensureReady();
  const { rows } = await pool.query('SELECT data FROM app_state WHERE id = $1', [ROW_ID]);
  return rows[0].data;
}

async function writeDB(data) {
  await ensureReady();
  await pool.query(
    'UPDATE app_state SET data = $2, updated_at = now() WHERE id = $1',
    [ROW_ID, data]
  );
}

// Same read-modify-write queue as before: serializes concurrent updates
// within this process so two requests arriving close together don't clobber
// each other. (Postgres itself only sees one UPDATE at a time this way -
// no row-level locking needed for a single-row document like this.)
let queue = Promise.resolve();
function update(fn) {
  queue = queue.then(async () => {
    const data = await readDB();
    const result = await fn(data);
    await writeDB(data);
    return result;
  });
  return queue;
}

module.exports = { readDB, writeDB, update, pool };
