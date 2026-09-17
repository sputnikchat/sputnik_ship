require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
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

// Render (and most hosts) sit behind a reverse proxy - without this,
// express-rate-limit sees every request as coming from the same internal
// IP and either rate-limits everyone together or refuses to start.
app.set('trust proxy', 1);

// Security headers (clickjacking, MIME-sniffing, forced HTTPS, etc.).
// The default Content-Security-Policy is replaced with one that actually
// matches what this app loads - Leaflet + its tiles, Google Fonts, the
// QR code image API - a generic default would silently break all three.
// crossOriginEmbedderPolicy is off because it requires every cross-origin
// resource (fonts, map tiles) to opt in with CORP headers we don't
// control and don't need the isolation guarantees it buys.
app.use(
  helmet({
    crossOriginEmbedderPolicy: false,
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", 'https://cdnjs.cloudflare.com'],
        // Inline style="" attributes are used throughout the frontend, so
        // style-src can't be locked down further without a larger rewrite.
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com', 'https://cdnjs.cloudflare.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        imgSrc: ["'self'", 'data:', 'https://*.tile.openstreetmap.org', 'https://api.qrserver.com'],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        frameAncestors: ["'self'"],
      },
    },
  })
);

app.use(cors());
app.use(express.json());
app.use(cookieParser());

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
