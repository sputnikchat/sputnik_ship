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

Open `http://localhost:3000` in your browser, create your account (Sign up), and you're ready to use the app.

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
    store.js                  Database in a local JSON file (data/db.json)
    carrierProviders.js       Tracking engine: mock mode + real FedEx/UPS/DHL/USPS stubs
    scheduler.js               Cron that refreshes every shipment every 30 min
    notify.js                  Creates notifications (+ optional email)
  middleware/auth.js          Verifies the JWT token on every request
  public/                     Frontend (framework-free HTML/CSS/JS) + PWA (manifest, service worker)
```

## Connecting real tracking (Ship24)

Instead of creating a separate developer account with each courier (FedEx,
UPS, DHL, USPS — each with its own OAuth flow), the app uses
[Ship24](https://www.ship24.com/tracking-api) as an aggregator: **a single
API key** covers those 4 plus 2500+ more couriers, auto-detecting the
carrier from the tracking number's format.

1. Sign up at [ship24.com/tracking-api](https://www.ship24.com/tracking-api)
   (free plan: 10 shipments/month, with a 100-shipment bonus the first month).
2. Paste your key into `.env`: `SHIP24_API_KEY=...`
3. Set `TRACKING_MODE=live` in `.env` and restart the server.

Real couriers only report the place name for each checkpoint
("Memphis, TN, US"), not coordinates — that's why, in `live` mode, the app
geocodes each location with Nominatim/OpenStreetMap (the same provider the
map already uses) so it can keep drawing the route. That adds a small delay
the first time a new place shows up (it's cached after that).

The integration is written against Ship24's official spec
([OpenAPI](https://docs.ship24.com/assets/openapi/ship24-tracking-api.yaml)),
so the field names in `parseShip24Response()`
(`services/carrierProviders.js`) should match the real response — it's
still worth testing once you turn on `live` with your key.

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
