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

// Safety net for the whole app: an async route handler that throws
// without its own try/catch (still common across routes/*.js) rejects a
// promise Express 4 never awaits or catches - by default Node treats
// that as fatal and kills the entire process, taking down every other
// in-flight request along with it. This has happened for real: a
// transient "Connection terminated unexpectedly" from Supabase's pooler
// during one ordinary GET /api/notifications crashed the whole server.
// Logging and continuing means that one request still fails for that
// one user, instead of every user losing the app for the ~15 seconds
// Render takes to notice and restart it.
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection (request failed, server kept running):', reason);
});
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception (kept running):', err);
});

// This used to silently fall back to a hardcoded 'change-me-dev-secret'
// if unset - anyone who ever read this file could forge a valid session
// token for any account. Same fail-fast treatment as DATABASE_URL/
// ENCRYPTION_KEY/AUDIT_DATABASE_URL: refuse to start rather than run
// insecurely without anyone noticing.
if (!process.env.JWT_SECRET) {
  throw new Error(
    'JWT_SECRET is not set. Copy .env.example to .env and set one (a long random string) before starting the server.'
  );
}

const app = express();

// Render (and most hosts) sit behind a reverse proxy - without this,
// express-rate-limit sees every request as coming from the same internal
// IP and either rate-limits everyone together or refuses to start.
app.set('trust proxy', 1);

// Security headers (clickjacking, MIME-sniffing, forced HTTPS, etc.).
// The default Content-Security-Policy is replaced with one that actually
// matches what this app loads - Leaflet + its tiles, Google Fonts, the
// QR code image API, and the label-scanner's OCR/barcode libraries
// (Tesseract.js + ZXing, public/js/scan.js) - a generic default would
// silently break all of these instead of erroring loudly.
// crossOriginEmbedderPolicy is off because it requires every cross-origin
// resource (fonts, map tiles) to opt in with CORP headers we don't
// control and don't need the isolation guarantees it buys.
app.use(
  helmet({
    crossOriginEmbedderPolicy: false,
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        // 'wasm-unsafe-eval' (not the far broader 'unsafe-eval') is what
        // lets Tesseract.js's WebAssembly OCR core compile at all - it
        // does not permit eval()/new Function() the way 'unsafe-eval' would.
        scriptSrc: ["'self'", "'wasm-unsafe-eval'", 'https://cdnjs.cloudflare.com', 'https://cdn.jsdelivr.net'],
        // Tesseract.js runs its OCR in a Web Worker it creates from a
        // blob: URL, and fetches its wasm core from the same CDNs as the
        // wrapper script above.
        workerSrc: ["'self'", 'blob:'],
        // Inline style="" attributes are used throughout the frontend, so
        // style-src can't be locked down further without a larger rewrite.
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com', 'https://cdnjs.cloudflare.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        imgSrc: ["'self'", 'data:', 'blob:', 'https://services.arcgisonline.com', 'https://api.qrserver.com'],
        connectSrc: ["'self'", 'https://cdnjs.cloudflare.com', 'https://cdn.jsdelivr.net', 'blob:'],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        frameAncestors: ["'self'"],
      },
    },
  })
);

const allowedOrigins = [
  'https://sputnik-ship.onrender.com',
  'https://sputnikship.app',
  'https://www.sputnikship.app',
  'http://localhost:3000',
];
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
}));
// Express's default json() body limit is 100kb - a compressed shipment
// photo (see compressImage() in public/js/app.js) sits right around
// that line, so some real photos were silently getting rejected with a
// 413 the client just reported as a generic "Network error".
app.use(express.json({ limit: '5mb' }));
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

// "/" is the marketing landing for visitors; the app itself lives at /app
// (and any deep link like /app?openShipment=... or /s/<token>). This route
// has to come before express.static, which would otherwise answer "/"
// with public/index.html (the app shell) itself.
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'landing.html'));
});

// Static frontend (PWA)
app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Without this, a disallowed-origin CORS rejection falls through to
// Express's default error handler: HTML instead of this app's JSON error
// convention, status 500 instead of 403, and (in dev, where NODE_ENV isn't
// set) a full stack trace in the response body.
app.use((err, req, res, next) => {
  if (err.message === 'Not allowed by CORS') {
    return res.status(403).json({ error: 'Not allowed by CORS' });
  }
  next(err);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Sputnik Ship running at http://localhost:${PORT}`);
  startScheduler();
});
