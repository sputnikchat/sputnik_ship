const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { readDB, update } = require('../services/store');
const { requireAuth } = require('../middleware/auth');
const { spaceIdOf, getSpaceUserIds } = require('../services/space');

const router = express.Router();
router.use(requireAuth);

const INVITE_CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const INVITE_TTL_MS = 24 * 60 * 60 * 1000; // 24h

function generateInviteCode() {
  let code = '';
  for (let i = 0; i < 6; i++) code += INVITE_CODE_CHARS[crypto.randomInt(INVITE_CODE_CHARS.length)];
  return code;
}

router.get('/co-owners', async (req, res) => {
  const db = await readDB();
  const spaceUserIds = getSpaceUserIds(db, req.user.id);
  const coOwners = db.users
    .filter((u) => spaceUserIds.includes(u.id) && u.id !== req.user.id)
    .map((u) => ({ id: u.id, handle: u.handle }));
  res.json({ coOwners });
});

// Generates a short-lived, single-use code to hand to someone else (by
// any channel outside the app - text, WhatsApp, in person). Whoever
// redeems it via POST /join joins the inviter's space.
router.post('/invite', async (req, res) => {
  const db = await readDB();
  const inviter = db.users.find((u) => u.id === req.user.id);
  const code = generateInviteCode();
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS).toISOString();

  await update((data) => {
    data.spaceInvites ||= [];
    // Only one live invite per inviter at a time - creating a new one
    // retires any earlier unused code.
    data.spaceInvites = data.spaceInvites.filter((i) => i.fromUserId !== req.user.id);
    data.spaceInvites.push({
      id: code,
      code,
      fromUserId: req.user.id,
      fromHandle: inviter.handle,
      spaceId: spaceIdOf(inviter),
      expiresAt,
      createdAt: new Date().toISOString(),
    });
  });

  res.json({ code, expiresAt });
});

// Joining a space gives full access to everything in it (shipments,
// contacts, photos, costs), and invite codes are short enough to type by
// hand (6 characters, valid 24 h). Without a limit a script could keep
// guessing codes until it lands in someone else's space; 10 tries per
// 15 minutes leaves room for typos and makes guessing hopeless.
const joinLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please wait a few minutes and try again.' },
});

router.post('/join', joinLimiter, async (req, res) => {
  const { code } = req.body || {};
  if (typeof code !== 'string' || !code) return res.status(400).json({ error: 'Invite code is required.' });

  const db = await readDB();
  const normalized = String(code).toUpperCase().trim();
  const invite = (db.spaceInvites || []).find((i) => i.code === normalized);
  if (!invite) return res.status(404).json({ error: 'That invite code is invalid or already used.' });
  if (new Date(invite.expiresAt) < new Date()) {
    return res.status(410).json({ error: 'That invite code has expired. Ask for a new one.' });
  }
  if (invite.fromUserId === req.user.id) {
    return res.status(400).json({ error: "You can't join your own invite." });
  }

  let coOwners = [];
  await update((data) => {
    const me = data.users.find((u) => u.id === req.user.id);
    me.spaceId = invite.spaceId;
    data.spaceInvites = (data.spaceInvites || []).filter((i) => i.code !== normalized);
    const spaceUserIds = getSpaceUserIds(data, req.user.id);
    coOwners = data.users
      .filter((u) => spaceUserIds.includes(u.id) && u.id !== req.user.id)
      .map((u) => ({ id: u.id, handle: u.handle }));
  });

  res.json({ ok: true, coOwners });
});

// Goes back to a solo space. Doesn't affect the other members - they
// keep sharing whatever's left of that space between them.
router.post('/leave-space', async (req, res) => {
  await update((data) => {
    const me = data.users.find((u) => u.id === req.user.id);
    me.spaceId = me.id;
  });
  res.status(204).end();
});

const NOTIFY_TYPES = ['status', 'delay', 'digest', 'chat', 'customs'];
const DEFAULT_NOTIFY_PREFS = { status: true, delay: true, digest: true, chat: true, customs: true };

router.get('/notify-prefs', async (req, res) => {
  const db = await readDB();
  const me = db.users.find((u) => u.id === req.user.id);
  res.json({ ...DEFAULT_NOTIFY_PREFS, ...(me?.notifyPrefs || {}) });
});

router.put('/notify-prefs', async (req, res) => {
  const body = req.body || {};
  let prefs = null;
  await update((data) => {
    const me = data.users.find((u) => u.id === req.user.id);
    me.notifyPrefs ||= { ...DEFAULT_NOTIFY_PREFS };
    for (const type of NOTIFY_TYPES) {
      if (typeof body[type] === 'boolean') me.notifyPrefs[type] = body[type];
    }
    prefs = { ...DEFAULT_NOTIFY_PREFS, ...me.notifyPrefs };
  });
  res.json(prefs);
});

// Permanently deletes this account and everything it owns: contacts,
// shipments (and this user's own read/message history on shipments
// they were only following), notifications, push subscriptions, and any
// pending invite they issued. A co-owner in the same space keeps their
// own shipments/contacts untouched - only this user's data is removed.
// Requires the current password so a stolen/left-open session can't
// silently wipe the account.
router.delete('/', async (req, res) => {
  const { currentPassword } = req.body || {};
  if (!currentPassword) return res.status(400).json({ error: 'Current password is required.' });

  const db = await readDB();
  const user = db.users.find((u) => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: 'Account not found.' });
  const ok = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!ok) return res.status(401).json({ error: 'Current password is incorrect.' });

  await update((data) => {
    const uid = req.user.id;
    data.contacts = data.contacts.filter((c) => c.userId !== uid);
    data.shipments = data.shipments
      .filter((s) => s.userId !== uid)
      .map((s) => ({ ...s, followers: (s.followers || []).filter((f) => f !== uid) }));
    data.notifications = data.notifications.filter((n) => n.userId !== uid);
    data.pushSubscriptions = (data.pushSubscriptions || []).filter((p) => p.userId !== uid);
    data.spaceInvites = (data.spaceInvites || []).filter((i) => i.fromUserId !== uid);
    data.users = data.users.filter((u) => u.id !== uid);
  });

  res.clearCookie('sputnikship_token', { httpOnly: true, secure: req.secure, sameSite: 'lax', path: '/' });
  res.status(204).end();
});

module.exports = router;
