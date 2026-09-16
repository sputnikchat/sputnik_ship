const express = require('express');
const crypto = require('crypto');
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

router.post('/join', async (req, res) => {
  const { code } = req.body || {};
  if (!code) return res.status(400).json({ error: 'Invite code is required.' });

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

const NOTIFY_TYPES = ['status', 'delay', 'digest', 'chat'];
const DEFAULT_NOTIFY_PREFS = { status: true, delay: true, digest: true, chat: true };

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

module.exports = router;
