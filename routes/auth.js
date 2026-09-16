const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { readDB, update } = require('../services/store');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

const HANDLE_RE = /^[a-z0-9_]{3,20}$/i;
// Avoids visually ambiguous characters (0/O, 1/I/L) since this is meant to
// be hand-copied onto paper, not just pasted.
const RECOVERY_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function sign(user) {
  return jwt.sign(
    { id: user.id, handle: user.handle },
    process.env.JWT_SECRET,
    { expiresIn: '30d' }
  );
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
router.post('/signup', async (req, res) => {
  const { handle, password } = req.body || {};
  if (!handle || !password) {
    return res.status(400).json({ error: 'Missing data: username and password are required.' });
  }
  if (!HANDLE_RE.test(handle)) {
    return res.status(400).json({ error: 'Username must be 3-20 characters: letters, numbers, or "_".' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters long.' });
  }

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
  // recoveryCode is returned exactly once - the server keeps only its hash.
  res.status(201).json({ token, user: { id: user.id, handle: user.handle }, recoveryCode });
});

router.post('/login', async (req, res) => {
  const { handle, password } = req.body || {};
  if (!handle || !password) {
    return res.status(400).json({ error: 'Missing data: username and password.' });
  }

  const normalizedHandle = handle.toLowerCase();
  const db = await readDB();
  const user = db.users.find((u) => u.handle === normalizedHandle);
  if (!user) return res.status(401).json({ error: 'Incorrect username or password.' });

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return res.status(401).json({ error: 'Incorrect username or password.' });

  const token = sign(user);
  res.json({ token, user: { id: user.id, handle: user.handle } });
});

// Recovers a locked-out account with the one-time code shown at signup.
// Issues a new password AND rotates the recovery code (the old one is
// treated as spent, same as a used one-time backup code anywhere else).
router.post('/recover', async (req, res) => {
  const { handle, recoveryCode, newPassword } = req.body || {};
  if (!handle || !recoveryCode || !newPassword) {
    return res.status(400).json({ error: 'Missing data: username, recovery code, and new password.' });
  }
  if (newPassword.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters long.' });
  }

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
  await update((data) => {
    const u = data.users.find((x) => x.id === user.id);
    u.passwordHash = bcrypt.hashSync(newPassword, 10);
    u.recoveryCodeHash = bcrypt.hashSync(normalizeRecoveryCode(newRecoveryCode), 10);
  });

  const token = sign(user);
  res.json({ token, user: { id: user.id, handle: user.handle }, recoveryCode: newRecoveryCode });
});

router.use(requireAuth);

router.post('/change-password', async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Missing data: current and new password.' });
  }
  if (newPassword.length < 6) {
    return res.status(400).json({ error: 'New password must be at least 6 characters long.' });
  }

  const db = await readDB();
  const user = db.users.find((u) => u.id === req.user.id);
  const ok = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!ok) return res.status(401).json({ error: 'Current password is incorrect.' });

  await update((data) => {
    const u = data.users.find((x) => x.id === req.user.id);
    u.passwordHash = bcrypt.hashSync(newPassword, 10);
  });
  res.status(204).end();
});

// Invalidates the old code (in case it leaked) and issues a fresh one.
// Requires the current password so a stolen/left-open session can't
// silently mint a new recovery code for itself.
router.post('/regenerate-recovery-code', async (req, res) => {
  const { currentPassword } = req.body || {};
  if (!currentPassword) return res.status(400).json({ error: 'Current password is required.' });

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
