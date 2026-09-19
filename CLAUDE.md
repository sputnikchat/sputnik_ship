# Sputnik Ship — project memory for Claude Code

Read this first in every session. Then read PRODUCT.md (what the product is)
and DESIGN.md (how it must look) before touching any UI.

## What this is
A PWA that tracks shipments across couriers and turns every shipment into a
conversation between the sender, the recipient and the courier. Node/Express
API + framework-free vanilla HTML/CSS/JS frontend. Deployed on Render at
https://sputnik-ship.onrender.com (GitHub: sputnikchat/sputnik_ship, branch main).

## Run
- `npm install` once, then `npm run dev` → http://localhost:3000
- `.env` is required (copy `.env.example`). TRACKING_MODE=mock needs no courier keys.
- The owner does NOT use the Terminal. Run commands yourself, never hand them a script.

## Where things live
- `server.js` — Express app, Helmet CSP, CORS allowlist, static `public/`, SPA fallback.
- `routes/*.js` — auth (JWT in httpOnly cookie), shipments (+ per-shipment chat, followers,
  share tokens), contacts, notifications, push, account (spaces/co-owners), stats, public (`/api/public/shipments/:token`).
- `services/carrierProviders.js` — tracking engine. `CARRIERS` array is the source of truth
  for courier values (fedex, ups, dhl, usps, air_cargo, ocean_cargo). Live mode = Ship24 aggregator.
- `services/store.js` — Postgres (Supabase), the whole app state is ONE jsonb document;
  `readDB()` / `update(fn)`. No SQL per entity.
- `public/index.html` — every screen is a `<section class="view">`; `public/js/app.js` switches
  them with `showView()` and renders with template literals + `escapeHtml()` (ALWAYS escape user data).
- `public/css/tokens.css` — design tokens (never hand-edit values; change DESIGN.md first).
- `public/css/style.css` — all component styles. `public/js/hero.js` — landing map canvas.
- `docs/design/` — `REDESIGN_BRIEF.md` (spec) and `sputnik-hero.html` (marketing mockup).
- `public/promo/` — static scene pages used to record the launch video. Not app screens.

## Rules
- No framework migration. Keep vanilla JS; the codebase is small and readable on purpose.
- Never change API routes, the data shape in store.js, or auth without asking.
- Every rendered string that comes from a user or a courier goes through `escapeHtml()`.
- Status colours are semantic and fixed (see DESIGN.md): in-transit indigo, out-for-delivery violet,
  delivered green, delay amber, exception red. Never grey for a status.
- Mobile first: verify at 390px width before desktop. Respect `prefers-reduced-motion`.
- Commit per phase with a descriptive message. `git push` is done by the owner or by you when
  they ask "haz git push".

## Design skills in this repo
Use `impeccable` for any UI work (it reads PRODUCT.md + DESIGN.md), `mobile-native` for
PWA feel, `animate` / `transitions-polish` for motion, `awesome-design-md` (Linear, Raycast)
as reference for the inbox. Ignore skills unrelated to UI/tracking.
