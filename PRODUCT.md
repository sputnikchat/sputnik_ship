# PRODUCT.md — Sputnik Ship

## One line
Every shipment is a conversation. Sputnik Ship is an inbox where a package's courier
updates, its map, its photo and the people involved (sender, recipient, co-owners) live
in one thread — across FedEx, UPS, DHL, USPS, air cargo (AWB) and ocean cargo (MBL).

## Who it is for
- **Senders** who ship to friends, family or customers and get asked "where is it?".
- **Recipients** who receive a share link (WhatsApp/SMS) and want to see the package and
  reply without creating "another account" — a @handle and a password, no email, no ID.
- Small sellers and people who ship abroad (customs holds, long routes, air/ocean freight).

## Jobs to be done
1. Paste a tracking number → it becomes a thread in the inbox, courier auto-detected.
2. See at a glance what needs me today: out for delivery, delayed, needs a reply.
3. Talk to the other side of the package inside the thread ("leave it with the concierge").
4. Share a photo of the package safely (EXIF/location stripped server-side).
5. Get one notification stream, in one voice, for every courier.
6. Invite the recipient with one link; they can follow before they sign up.

## Product principles
- **Inbox, not a list.** Unread counts, "Today" first, delivered threads fade down.
- **The courier is a participant.** Status events are messages in the thread with the map and ETA attached.
- **Sharing is the growth loop.** The share page is an invitation, not a read-only tracking page.
- **Privacy by default.** No email, no KYC, no metadata in photos, follower view never exposes
  notes, cost, contact or the owner's photo.
- **Honest about being a PWA.** "Install" means Add to Home Screen; the invite page teaches it.

## Not in scope (now)
Native app store builds, payments/customs duties, label purchase, multi-language UI.
