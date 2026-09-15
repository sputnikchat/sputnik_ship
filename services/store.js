// Almacenamiento simple en un archivo JSON local.
// Suficiente para un usuario / uso personal. Si el proyecto crece,
// esto se puede reemplazar por Postgres/Mongo sin cambiar mucho la API
// de arriba (routes/*.js solo llaman a las funciones de este archivo).

const fs = require('fs');
const path = require('path');

const DB_FILE = path.join(__dirname, '..', 'data', 'db.json');

function defaultData() {
  return {
    users: [],
    contacts: [],
    shipments: [],
    notifications: [],
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
    console.error('db.json esta corrupto, se reinicia con datos vacios.', e);
    const fresh = defaultData();
    writeDB(fresh);
    return fresh;
  }
}

function writeDB(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

// Pequeño helper para hacer una lectura-modificacion-escritura atomica
// dentro de un mismo proceso (no hay concurrencia real de escritura aqui,
// pero evita perder cambios si dos requests llegan casi al mismo tiempo).
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
