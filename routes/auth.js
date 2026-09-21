const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const { v4: uuidv4 } = require('uuid');
const { readDB, update } = require('../services/store');
const { requireAuth } = require('../middleware/auth');

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

function sign(user) {
  return jwt.sign(
    // tv = the user's tokenVersion when this token was issued; see
    // middleware/auth.js for how it lets a password change end old sessions.
    { id: user.id, handle: user.handle, tv: user.tokenVersion || 0 },
    process.env.JWT_SECRET,
    { expiresIn: '30d' }
  );
}

// The main web app's own session lives in this httpOnly cookie instead of
// a token the page's own JavaScript can read (e.g. from localStorage) -
// so a future XSS bug in this app or a compromised third-party script it
// loads can't walk off with a logged-in session. httpOnly means client
// JS genuinely cannot read or set this cookie; only the server can.
// The browser extension and any other non-browser client still get the
// token in the response body and send it as a Bearer header instead,
// since a cross-origin client was never going to receive this cookie.
const AUTH_COOKIE = 'sputnikship_token';
function setAuthCookie(req, res, token) {
  res.cookie(AUTH_COOKIE, token, {
    httpOnly: true,
    secure: req.secure,
    sameSite: 'lax',
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days, matches the JWT's own expiry
    path: '/',
  });
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

  const token = sign(user);
  setAuthCookie(req, res, token);
  // recoveryCode is returned exactly once - the server keeps only its hash.
  res.status(201).json({ token, user: { id: user.id, handle: user.handle }, recoveryCode });
});

router.post('/login', authLimiter, async (req, res) => {
  const { handle, password } = req.body || {};
  if (typeof handle !== 'string' || typeof password !== 'string' || !handle || !password) {
    return res.status(400).json({ error: 'Missing data: username and password.' });
  }

  const normalizedHandle = handle.toLowerCase();
  const db = await readDB();
  const user = db.users.find((u) => u.handle === normalizedHandle);
  if (!user) {
    await bcrypt.compare(password, DUMMY_HASH);
    return res.status(401).json({ error: 'Incorrect username or password.' });
  }

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return res.status(401).json({ error: 'Incorrect username or password.' });

  const token = sign(user);
  setAuthCookie(req, res, token);
  res.json({ token, user: { id: user.id, handle: user.handle } });
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
  const db = await readDB();
  const user = db.users.find((u) => u.handle === normalizedHandle);
  // Same generic error whether the handle doesn't exist or the code is
  // wrong - don't reveal which one to an attacker guessing handles.
  const genericError = { error: 'Incorrect username or recovery code.' };
  if (!user || !user.recoveryCodeHash) return res.status(401).json(genericError);

  const ok = await bcrypt.compare(normalizeRecoveryCode(recoveryCode), user.recoveryCodeHash);
  if (!ok) return res.status(401).json(genericError);

  const newRecoveryCode = generateRecoveryCode();
  let updatedUser = user;
  await update((data) => {
    const u = data.users.find((x) => x.id === user.id);
    u.passwordHash = bcrypt.hashSync(newPassword, 10);
    u.recoveryCodeHash = bcrypt.hashSync(normalizeRecoveryCode(newRecoveryCode), 10);
    // Recovering usually means someone else may know the old password:
    // every session issued before this moment stops working.
    u.tokenVersion = (u.tokenVersion || 0) + 1;
    updatedUser = u;
  });

  const token = sign(updatedUser);
  setAuthCookie(req, res, token);
  res.json({ token, user: { id: user.id, handle: user.handle }, recoveryCode: newRecoveryCode });
});

// Clears the session cookie. Doesn't require a valid session itself - a
// stale or already-expired cookie should still be clearable.
router.post('/logout', (req, res) => {
  res.clearCookie(AUTH_COOKIE, { httpOnly: true, secure: req.secure, sameSite: 'lax', path: '/' });
  res.status(204).end();
});

router.use(requireAuth);

router.post('/change-password', async (req, res) => {
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

  let updatedUser = null;
  await update((data) => {
    const u = data.users.find((x) => x.id === req.user.id);
    u.passwordHash = bcrypt.hashSync(newPassword, 10);
    // Ends every other session (another device, or someone who had the
    // old password) - this device gets a fresh token right below, so the
    // person changing their password stays logged in here.
    u.tokenVersion = (u.tokenVersion || 0) + 1;
    updatedUser = u;
  });
  const token = sign(updatedUser);
  setAuthCookie(req, res, token);
  res.json({ token });
});

// Invalidates the old code (in case it leaked) and issues a fresh one.
// Requires the current password so a stolen/left-open session can't
// silently mint a new recovery code for itself.
router.post('/regenerate-recovery-code', async (req, res) => {
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
