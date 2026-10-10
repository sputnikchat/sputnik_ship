# Sputnik Ship

An app to keep contacts and track shipments (FedEx, UPS, DHL, USPS) in one place:

- Simple login with a username and password — **no identity verification (KYC)**.
- Contact book (name, phone, email, company, address, notes).
- Shipments linked to a contact, with courier and tracking number.
- Automatic status updates for every shipment **every 30 minutes** (configurable).
- Notifications when a shipment's status changes.
- Map with the shipment's route (origin → checkpoints → destination) via [Leaflet](https://leafletjs.com/) + OpenStreetMap.
- Works in the browser and is installable as a **PWA** (home screen icon, on Android and iOS).

By default the app runs with **simulated tracking data** (`TRACKING_MODE=mock`), so you can try the whole flow — contacts, shipments, map, notifications — without needing courier accounts yet. Once you have FedEx/UPS/DHL/USPS credentials, follow the "Connecting real tracking" section and switch to `TRACKING_MODE=live`.

## Running it on your computer

You need [Node.js](https://nodejs.org/) 18 or newer installed.

```bash
cd sputnik-ship
npm install
cp .env.example .env
# open .env and at least change JWT_SECRET to a long random string
npm start
```

Open `http://localhost:3000/app` in your browser, create your account (Sign up), and you're ready to use the app. (`http://localhost:3000` on its own is the public landing page.)

> Note: in the environment where this project was generated there was no internet access to download npm packages, so `npm install` wasn't run there — the syntax of every file and the internal logic (database, tracking simulator) were tested separately. On your own computer, with normal internet, `npm install` will work fine.

## Testing tracking without waiting 30 minutes

- The **"Refresh now"** button on the Shipments screen: forces the same cycle that runs automatically every 30 min, for every shipment.
- Opening a shipment's detail view also refreshes that specific shipment.
- Every time you add a new shipment, its initial tracking is looked up immediately.

With simulated data, every refresh "advances" the shipment one checkpoint further along its route (created → picked up → in transit → out for delivery → delivered), so you can see notifications and the map move without waiting.

## Project structure

```
sputnik-ship/
  server.js                  Express server (API + serves the frontend)
  routes/
    auth.js                  Signup / login (JWT, no KYC)
    contacts.js               Contact CRUD
    shipments.js              Shipment CRUD + tracking refresh
    notifications.js          Notifications
  services/
    store.js                  Database: Postgres (Supabase), one JSON document per app
    carrierProviders.js       Tracking engine: mock mode + real FedEx/UPS/DHL/USPS stubs
    scheduler.js               Cron that refreshes every shipment every 30 min
    notify.js                  Creates notifications (+ optional email)
  middleware/auth.js          Verifies the JWT token on every request
  public/                     Frontend (framework-free HTML/CSS/JS) + PWA (manifest, service worker)
```

## Connecting real tracking

With `TRACKING_MODE=live`, shipments are looked up through two tracking
services (see `.env.example`):

| What | Service | Variable |
|---|---|---|
| Parcels: FedEx, UPS, DHL, USPS, Correos, SEUR, GLS and 1,500+ more ("Other courier" auto-detects) | Ship24 Tracking API, ship24.com | `SHIP24_API_KEY` |
| Air cargo (AWB, 160+ airlines) and ocean cargo (container / booking / MBL) | ShipsGo API v2, shipsgo.com | `SHIPSGO_API_KEY` |

Each service is a backup for the other's cargo: if ShipsGo has nothing yet
for an AWB or container, Ship24 is tried. A courier's own API (optional,
`DHL_API_KEY`, `FEDEX_CLIENT_ID`/`_SECRET`, `UPS_CLIENT_ID`/`_SECRET`,
`USPS_CLIENT_ID`/`_SECRET`) is used as a backup for that courier when Ship24
fails. Sandbox/test courier keys return fake data - leave them empty in
production.

A shipment with no configured service isn't looked up: it keeps its last
data and the thread shows a "Carrier site" button instead.

Couriers only report the place name for each checkpoint ("Memphis, TN,
US"), not coordinates, so in `live` mode each place is geocoded
(Nominatim, falling back to Photon) to keep drawing the route. That adds a
small delay the first time a new place shows up (it's cached after that).

## Email notifications (optional)

Notifications always stay saved inside the app (the 🔔 bell). If you also want to receive them by email, fill this in `.env`:

```
NOTIFY_EMAIL_ENABLED=true
SMTP_HOST=...
SMTP_PORT=587
SMTP_USER=...
SMTP_PASS=...
NOTIFY_EMAIL_FROM=...
NOTIFY_EMAIL_TO=...
```

And add the dependency: `npm install nodemailer`.

## Browser push notifications (optional)

Besides the in-app bell, you can enable real browser push notifications
(they alert you even with the app closed). They're optional: if you don't
configure anything, the rest of the app works the same.

1. Generate the keys once: `npx web-push generate-vapid-keys`.
2. Paste them into your `.env`:

```
VAPID_PUBLIC_KEY=...
VAPID_PRIVATE_KEY=...
VAPID_SUBJECT=mailto:your-email@example.com
```

3. Restart the server, open the **Alerts** tab inside the app, and tap
   **"Enable notifications"** — the browser will ask for permission.

It works fine on `localhost` for testing in Chrome. For it to work for
other people you'll need to deploy the app with real HTTPS (see the
deployment section below).

## Changing how often it refreshes

In `.env`, `TRACKING_REFRESH_MINUTES=30` (you can lower it to 5 or 10 while testing, for example).

## Closing signup (just you as the user)

Since you chose to use this app just for yourself, once you create your account you can "close" signup so no one else can create a new account: in `routes/auth.js`, inside `/signup`, add at the top:

```js
if (db.users.length >= 1) {
  return res.status(403).json({ error: 'Signup is closed.' });
}
```

## Deploying it to run 24/7 (so the 30-min refresh always works)

While the app only runs on your computer, the automatic 30-min refresh only happens while the computer is on and `npm start` is running. To have it run all the time (and be able to open it from your phone as an installed app), the simplest option is deploying it to a free/cheap service that keeps a Node process running, for example:

- **Render** (render.com) — free plan to try it out, "Web Service" from this same code.
- **Railway** (railway.app)
- **Fly.io**

With any of the three: push this project (e.g. to a GitHub repo), connect it to the service, set the `.env` environment variables in its dashboard, and the start command is `npm start`. Once deployed, open the public URL from your phone and use "Add to Home Screen" to install it as an app.

## Suggested next steps

- Connect the real APIs for the couriers you use most (see section above).
- Enable browser push notifications (Web Push) if you want alerts even while the app is closed — requires deploying with HTTPS.
- If down the line you need several people to use the app with their own accounts, the foundation already supports multiple users (each one only sees their own contacts and shipments).
