const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { v4: uuidv4 } = require('uuid');
const { readDB, update } = require('../services/store');
const { requireAuth } = require('../middleware/auth');
const { passwordCheckLimiter } = require('../middleware/limits');
const {
  REFRESH_COOKIE,
  createSession,
  rotate,
  revokeByRefresh,
  setSessionCookies,
  clearSessionCookies,
} = require('../services/sessions');

const router = express.Router();

// Signup/login/recover are the only routes anyone can hit without already
// having a valid token - the ones worth protecting against someone
// script-guessing passwords or recovery codes. 20 tries per 15 minutes per
// IP is generous for real use (typos, a couple of people on one wifi)
// but shuts down brute-forcing.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please wait a few minutes and try again.' },
});

const HANDLE_RE = /^[a-z0-9_]{3,20}$/i;
// Avoids visually ambiguous characters (0/O, 1/I/L) since this is meant to
// be hand-copied onto paper, not just pasted.
const RECOVERY_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

// 8 is the minimum NIST recommends for user-chosen passwords. Existing
// accounts with a shorter one can still log in - this only applies when a
// password is set. The upper bound keeps someone from posting a
// multi-megabyte "password" at bcrypt (which only reads the first 72
// bytes anyway).
const MIN_PASSWORD = 8;
const MAX_PASSWORD = 200;
function passwordError(password) {
  if (typeof password !== 'string') return 'Invalid password.';
  if (password.length < MIN_PASSWORD) return `Password must be at least ${MIN_PASSWORD} characters long.`;
  if (password.length > MAX_PASSWORD) return 'Password is too long.';
  return null;
}

// Compared against when a login names a handle that doesn't exist, so
// that path costs the same bcrypt time as a real wrong password -
// otherwise the response time alone tells an attacker which handles are
// registered.
const DUMMY_HASH = bcrypt.hashSync(crypto.randomBytes(16).toString('hex'), 10);

// Per-account lockout, on top of the per-IP limiter above: an attacker
// rotating IPs (a botnet) still gets 5 guesses per account, then a wait
// that doubles with every further lockout (15 min, 30 min, 1 h ... 24 h).
// Keyed by the typed handle whether or not it exists, so a lockout doesn't
// reveal which handles are real. Kept in memory: a restart only clears the
// counters, never unlocks a stolen session.
const MAX_FAILS = 5;
const BASE_LOCK_MS = 15 * 60 * 1000;
const MAX_LOCK_MS = 24 * 60 * 60 * 1000;
const loginFailures = new Map(); // handle -> { fails, locks, lockedUntil, lastAt }

function lockedFor(handle) {
  const entry = loginFailures.get(handle);
  return entry && entry.lockedUntil > Date.now() ? entry.lockedUntil - Date.now() : 0;
}

function recordFailure(handle) {
  const now = Date.now();
  const entry = loginFailures.get(handle) || { fails: 0, locks: 0, lockedUntil: 0, lastAt: now };
  entry.fails += 1;
  entry.lastAt = now;
  if (entry.fails >= MAX_FAILS) {
    entry.lockedUntil = now + Math.min(BASE_LOCK_MS * 2 ** entry.locks, MAX_LOCK_MS);
    entry.locks += 1;
    entry.fails = 0;
    console.warn(`Login locked for handle "${handle}" after repeated failures.`);
  }
  loginFailures.set(handle, entry);
  // Bounded memory: forget handles nobody has tried for a day.
  if (loginFailures.size > 10000) {
    for (const [h, e] of loginFailures) if (now - e.lastAt > MAX_LOCK_MS) loginFailures.delete(h);
  }
}

function lockedResponse(res, ms) {
  const minutes = Math.ceil(ms / 60000);
  res.set('Retry-After', String(Math.ceil(ms / 1000)));
  return res.status(429).json({ error: `Too many failed attempts for this account. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.` });
}

// Kicking sessions out isn't enough on its own: a device someone
// subscribed to push while they had the session would keep receiving this
// account's notifications. The owner re-enables push on their devices.
function dropPushSubscriptions(data, userId) {
  data.pushSubscriptions = (data.pushSubscriptions || []).filter((p) => p.userId !== userId);
}

// Starts a session for `userId` (inside one store update) and hands the
// tokens out: as httpOnly cookies for the web app, and in the body for the
// browser extension, which keeps them itself and calls /refresh.
async function startSession(req, res, userId, mutate) {
  const result = await update((data) => {
    const u = data.users.find((x) => x.id === userId);
    if (mutate) mutate(u, data);
    return createSession(u, req.headers['user-agent']);
  });
  setSessionCookies(req, res, result);
  return { token: result.accessToken, refreshToken: result.refreshToken };
}

// Wallet-style account, no email on file - so there's no "reset link" a
// normal app could send. This is the equivalent of a seed phrase: a
// one-time code shown right after it's generated, hashed at rest like a
// password, never retrievable again. Losing both the password AND this
// code means the account can't be recovered - that trade-off is the
// price of not collecting an email address.
function generateRecoveryCode() {
  const groups = [];
  for (let g = 0; g < 3; g++) {
    let group = '';
    for (let i = 0; i < 4; i++) {
      group += RECOVERY_CHARS[crypto.randomInt(RECOVERY_CHARS.length)];
    }
    groups.push(group);
  }
  return groups.join('-'); // e.g. "7XQK-M4RT-9PLC"
}

function normalizeRecoveryCode(code) {
  return String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

// Wallet-style signup: just @handle + password. No real name, no email,
// no identity verification (KYC). Anyone with the server link can create
// an account unless you decide to close public signup (see README,
// "Closing signup" section).
router.post('/signup', authLimiter, async (req, res) => {
  const { handle, password, website } = req.body || {};
  // Honeypot: the signup forms carry a "website" field that is invisible
  // and unreachable for people (off-screen, no tab stop, hidden from
  // screen readers), so only a bot blindly filling every input ever sends
  // it. No CAPTCHA, no third-party script, nothing tracking real users.
  if (website) {
    return res.status(400).json({ error: 'Signup failed. Please try again.' });
  }
  if (typeof handle !== 'string' || !handle || !password) {
    return res.status(400).json({ error: 'Missing data: username and password are required.' });
  }
  if (!HANDLE_RE.test(handle)) {
    return res.status(400).json({ error: 'Username must be 3-20 characters: letters, numbers, or "_".' });
  }
  const pwError = passwordError(password);
  if (pwError) return res.status(400).json({ error: pwError });

  const normalizedHandle = handle.toLowerCase();
  const db = await readDB();
  const exists = db.users.find((u) => u.handle === normalizedHandle);
  if (exists) {
    return res.status(409).json({ error: 'That username is already taken.' });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const recoveryCode = generateRecoveryCode();
  const recoveryCodeHash = await bcrypt.hash(normalizeRecoveryCode(recoveryCode), 10);
  const user = {
    id: uuidv4(),
    handle: normalizedHandle,
    passwordHash,
    recoveryCodeHash,
    createdAt: new Date().toISOString(),
  };

  await update((data) => {
    data.users.push(user);
  });

  const tokens = await startSession(req, res, user.id);
  // recoveryCode is returned exactly once - the server keeps only its hash.
  res.status(201).json({ ...tokens, user: { id: user.id, handle: user.handle }, recoveryCode });
});

router.post('/login', authLimiter, async (req, res) => {
  const { handle, password } = req.body || {};
  if (typeof handle !== 'string' || typeof password !== 'string' || !handle || !password) {
    return res.status(400).json({ error: 'Missing data: username and password.' });
  }

  const normalizedHandle = handle.toLowerCase();
  const wait = lockedFor(normalizedHandle);
  if (wait) return lockedResponse(res, wait);

  const db = await readDB();
  const user = db.users.find((u) => u.handle === normalizedHandle);
  const ok = user
    ? await bcrypt.compare(password, user.passwordHash)
    : await bcrypt.compare(password, DUMMY_HASH).then(() => false);
  if (!ok) {
    recordFailure(normalizedHandle);
    const nowLocked = lockedFor(normalizedHandle);
    if (nowLocked) return lockedResponse(res, nowLocked);
    return res.status(401).json({ error: 'Incorrect username or password.' });
  }

  loginFailures.delete(normalizedHandle);
  const tokens = await startSession(req, res, user.id);
  res.json({ ...tokens, user: { id: user.id, handle: user.handle } });
});

// Recovers a locked-out account with the one-time code shown at signup.
// Issues a new password AND rotates the recovery code (the old one is
// treated as spent, same as a used one-time backup code anywhere else).
router.post('/recover', authLimiter, async (req, res) => {
  const { handle, recoveryCode, newPassword } = req.body || {};
  if (typeof handle !== 'string' || typeof recoveryCode !== 'string' || !handle || !recoveryCode || !newPassword) {
    return res.status(400).json({ error: 'Missing data: username, recovery code, and new password.' });
  }
  const pwError = passwordError(newPassword);
  if (pwError) return res.status(400).json({ error: pwError });

  const normalizedHandle = handle.toLowerCase();
  const wait = lockedFor(normalizedHandle);
  if (wait) return lockedResponse(res, wait);

  const db = await readDB();
  const user = db.users.find((u) => u.handle === normalizedHandle);
  // Same generic error whether the handle doesn't exist or the code is
  // wrong - don't reveal which one to an attacker guessing handles.
  const genericError = { error: 'Incorrect username or recovery code.' };
  const ok = user && user.recoveryCodeHash
    ? await bcrypt.compare(normalizeRecoveryCode(recoveryCode), user.recoveryCodeHash)
    : false;
  if (!ok) {
    recordFailure(normalizedHandle);
    return res.status(401).json(genericError);
  }
  loginFailures.delete(normalizedHandle);

  const newRecoveryCode = generateRecoveryCode();
  const passwordHash = await bcrypt.hash(newPassword, 10);
  const recoveryCodeHash = await bcrypt.hash(normalizeRecoveryCode(newRecoveryCode), 10);
  const tokens = await startSession(req, res, user.id, (u, data) => {
    u.passwordHash = passwordHash;
    u.recoveryCodeHash = recoveryCodeHash;
    // Recovering usually means someone else may know the old password:
    // every existing session (and token) stops working.
    u.tokenVersion = (u.tokenVersion || 0) + 1;
    u.sessions = [];
    dropPushSubscriptions(data, u.id);
  });
  res.json({ ...tokens, user: { id: user.id, handle: user.handle }, recoveryCode: newRecoveryCode });
});

// Rotates the browser extension's refresh token (the web app does this
// transparently in middleware/auth.js via its cookie).
router.post('/refresh', authLimiter, async (req, res) => {
  const { refreshToken } = req.body || {};
  if (typeof refreshToken !== 'string') return res.status(400).json({ error: 'Missing refresh token.' });
  const r = await update((data) => rotate(data, refreshToken));
  if (!r || !r.refreshToken) return res.status(401).json({ error: 'Session expired. Please log in again.' });
  res.json({ token: r.accessToken, refreshToken: r.refreshToken });
});

// Ends this session server-side and clears the cookies. Doesn't require a
// valid access token - a stale or already-expired session should still be
// closable.
router.post('/logout', async (req, res) => {
  const refreshToken = req.cookies?.[REFRESH_COOKIE] || (req.body || {}).refreshToken;
  if (typeof refreshToken === 'string') await update((data) => revokeByRefresh(data, refreshToken));
  clearSessionCookies(req, res);
  res.status(204).end();
});

router.use(requireAuth);

router.post('/change-password', passwordCheckLimiter, async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (typeof currentPassword !== 'string' || !currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Missing data: current and new password.' });
  }
  const pwError = passwordError(newPassword);
  if (pwError) return res.status(400).json({ error: pwError });

  const db = await readDB();
  const user = db.users.find((u) => u.id === req.user.id);
  const ok = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!ok) return res.status(401).json({ error: 'Current password is incorrect.' });

  const passwordHash = await bcrypt.hash(newPassword, 10);
  // Ends every other session (another device, or someone who had the old
  // password) - this device gets a fresh session, so the person changing
  // their password stays logged in here.
  const tokens = await startSession(req, res, req.user.id, (u, data) => {
    u.passwordHash = passwordHash;
    u.tokenVersion = (u.tokenVersion || 0) + 1;
    u.sessions = [];
    dropPushSubscriptions(data, u.id);
  });
  res.json(tokens);
});

// Invalidates the old code (in case it leaked) and issues a fresh one.
// Requires the current password so a stolen/left-open session can't
// silently mint a new recovery code for itself.
router.post('/regenerate-recovery-code', passwordCheckLimiter, async (req, res) => {
  const { currentPassword } = req.body || {};
  if (typeof currentPassword !== 'string' || !currentPassword) return res.status(400).json({ error: 'Current password is required.' });

  const db = await readDB();
  const user = db.users.find((u) => u.id === req.user.id);
  const ok = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!ok) return res.status(401).json({ error: 'Current password is incorrect.' });

  const recoveryCode = generateRecoveryCode();
  await update((data) => {
    const u = data.users.find((x) => x.id === req.user.id);
    u.recoveryCodeHash = bcrypt.hashSync(normalizeRecoveryCode(recoveryCode), 10);
  });
  res.json({ recoveryCode });
});

module.exports = router;
