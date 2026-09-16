require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const authRoutes = require('./routes/auth');
const contactsRoutes = require('./routes/contacts');
const shipmentsRoutes = require('./routes/shipments');
const notificationsRoutes = require('./routes/notifications');
const pushRoutes = require('./routes/push');
const publicRoutes = require('./routes/public');
const accountRoutes = require('./routes/account');
const statsRoutes = require('./routes/stats');
const { startScheduler } = require('./services/scheduler');

if (!process.env.JWT_SECRET) {
  console.warn(
    '[WARNING] No JWT_SECRET set in the environment. Copy .env.example to .env and set one before using this in production.'
  );
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'change-me-dev-secret';
}

const app = express();
app.use(cors());
app.use(express.json());

app.use('/api/auth', authRoutes);
app.use('/api/contacts', contactsRoutes);
app.use('/api/shipments', shipmentsRoutes);
app.use('/api/notifications', notificationsRoutes);
app.use('/api/push', pushRoutes);
app.use('/api/public', publicRoutes);
app.use('/api/account', accountRoutes);
app.use('/api/stats', statsRoutes);

app.get('/api/health', (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

// Static frontend (PWA)
app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Sputnik Ship running at http://localhost:${PORT}`);
  startScheduler();
});
