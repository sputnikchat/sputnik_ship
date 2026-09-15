require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const authRoutes = require('./routes/auth');
const contactsRoutes = require('./routes/contacts');
const shipmentsRoutes = require('./routes/shipments');
const notificationsRoutes = require('./routes/notifications');
const { startScheduler } = require('./services/scheduler');

if (!process.env.JWT_SECRET) {
  console.warn(
    '[AVISO] No hay JWT_SECRET en el entorno. Copia .env.example a .env y define uno antes de usar en produccion.'
  );
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'secreto-de-desarrollo-cambiame';
}

const app = express();
app.use(cors());
app.use(express.json());

app.use('/api/auth', authRoutes);
app.use('/api/contacts', contactsRoutes);
app.use('/api/shipments', shipmentsRoutes);
app.use('/api/notifications', notificationsRoutes);

app.get('/api/health', (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

// Frontend estatico (PWA)
app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`ShipTrack corriendo en http://localhost:${PORT}`);
  startScheduler();
});
