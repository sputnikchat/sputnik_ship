// Simple storage in a local JSON file.
// Good enough for a single user / personal use. If the project grows,
// this can be swapped for Postgres/Mongo without changing much of the
// API above (routes/*.js only ever call the functions in this file).

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
  };
}

function ensureFile() {
  if (!fs.existsSync(DB_FILE)) {
    fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
    fs.writeFileSync(DB_FILE, JSON.stringify(defaultData(), null, 2));
  }
}

function readDB() {
  ensureFile();
  const raw = fs.readFileSync(DB_FILE, 'utf-8');
  try {
    return JSON.parse(raw);
  } catch (e) {
    console.error('db.json is corrupted, resetting with empty data.', e);
    const fresh = defaultData();
    writeDB(fresh);
    return fresh;
  }
}

function writeDB(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

// Small helper for an atomic read-modify-write within a single process
// (there's no real write concurrency here, but this avoids losing
// changes if two requests arrive at nearly the same time).
let queue = Promise.resolve();
function update(fn) {
  queue = queue.then(async () => {
    const data = readDB();
    const result = await fn(data);
    writeDB(data);
    return result;
  });
  return queue;
}

module.exports = { readDB, writeDB, update, DB_FILE };
