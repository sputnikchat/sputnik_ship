# DESIGN.md — Sputnik Ship visual system

Reference mockups: `docs/design/sputnik-hero.html` (marketing) and the Inbox concept
(https://claude.ai/artifact/HbXtDdLmouvgy39uosVxYa). Tokens live in `public/css/tokens.css`
and are copied here verbatim — change here first, then there.

## Tone
Dark, quiet, precise. Linear/Raycast lineage, not a glossy consumer chat app. One accent
family (indigo → violet), semantic colour only for shipment state. Motion is short and
purposeful; nothing bounces.

## Tokens
```css
:root{
  --bg:#050507; --bg2:#0b0c12; --surface:#0f1017; --line:#1e2029; --line2:#2a2d3a;
  --text:#f2f3f7; --muted:#9a9fac; --dim:#5f6472;
  --accent:#5e6ad2; --accent2:#8b7cf6; --accent-soft:rgba(94,106,210,.16);
  --ok:#3ecf8e; --warn:#f2b45c; --danger:#eb5757;
  --sans:"Instrument Sans",-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
  --mono:"IBM Plex Mono",ui-monospace,SFMono-Regular,Menlo,monospace;
  --r-sm:9px; --r-md:14px; --r-lg:18px; --r-xl:32px;
}
```

## Typography
- Instrument Sans for all UI text. Headings 600, letter-spacing -0.02em to -0.04em.
- IBM Plex Mono ONLY for: tracking numbers, times/dates, ETAs, coordinates, eyebrows/labels
  (11px, uppercase, letter-spacing .06em, colour --dim or --accent-text #c3c8f0).
- Body 14px / 1.45. Thread titles 15px 600. Inbox greeting 22px 600.

## Semantic status colours (never grey)
| state | text | background | border |
|---|---|---|---|
| label_created / picked_up / in_transit | #c3c8f0 | --accent-soft | rgba(94,106,210,.4) |
| out_for_delivery | #ddd6ff | rgba(139,124,246,.18) | rgba(139,124,246,.45) |
| delivered | --ok | rgba(62,207,142,.14) | rgba(62,207,142,.35) |
| delay (delayFlagged) | --warn | rgba(242,180,92,.14) | rgba(242,180,92,.35) |
| exception / failed_attempt | --danger | rgba(235,87,87,.14) | rgba(235,87,87,.35) |
Active states (in_transit, out_for_delivery) get a pulsing dot; delivered a static dot.

## Surfaces
- Page ground --bg with a faint radial indigo glow top-right. Cards --surface, 1px --line,
  radius --r-md. Only ONE elevated element per screen (the live card / the highlighted event).
- Pills: 999px radius, 11.5px, dot before the label.
- Buttons: primary --accent white text radius --r-sm shadow `0 8px 24px -8px rgba(94,106,210,.6)`;
  secondary --surface + --line2 border.
- Courier badges: real brand marks for FedEx/UPS/DHL/USPS; generic glyphs (plane, container)
  in --accent / #1f8a6f for air_cargo / ocean_cargo.

## Inbox model (Home)
Rows are threads: 44px package tile with courier chip (top-left) and status dot (bottom-right),
title (label or tracking number), second line = last message (system message in status colour,
human message in --muted), time in mono, unread pill (--accent, or --ok for "delivered").
Groups: Today (out for delivery / needs reply) → In transit → Delivered (55% opacity).

## Thread model (Detail)
Pinned live card: 96px map strip (dot grid, route gradient --accent2→--accent, pulsing pin),
ETA window in 14px 600, tracking number in mono. Below: one timeline oldest→newest —
courier events as centred mono chips with a status dot, photos as bubbles with the
"Metadata removed" badge, human messages as bubbles (mine = --accent, theirs = --surface),
the current milestone as a highlighted card with actions. Input bar: camera + field + send.

## Motion
150ms ease for state/colour, 200–260ms ease-out for entrances (translateY 8–12px → 0,
opacity), pulsing dots 2s. Everything off under `prefers-reduced-motion`.

## Mobile
Design at 390px first. Safe-area insets on top/bottom bars, 44px minimum tap targets,
no hover-only affordances, inputs ≥16px font to avoid iOS zoom.
