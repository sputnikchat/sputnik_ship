const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { readDB, update } = require('../services/store');

const router = express.Router();

const HANDLE_RE = /^[a-z0-9_]{3,20}$/i;

function sign(user) {
  return jwt.sign(
    { id: user.id, handle: user.handle },
    process.env.JWT_SECRET,
    { expiresIn: '30d' }
  );
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
  const db = readDB();
  const exists = db.users.find((u) => u.handle === normalizedHandle);
  if (exists) {
    return res.status(409).json({ error: 'That username is already taken.' });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const user = {
    id: uuidv4(),
    handle: normalizedHandle,
    passwordHash,
    createdAt: new Date().toISOString(),
  };

  await update((data) => {
    data.users.push(user);
  });

  const token = sign(user);
  res.status(201).json({ token, user: { id: user.id, handle: user.handle } });
});

router.post('/login', async (req, res) => {
  const { handle, password } = req.body || {};
  if (!handle || !password) {
    return res.status(400).json({ error: 'Missing data: username and password.' });
  }

  const normalizedHandle = handle.toLowerCase();
  const db = readDB();
  const user = db.users.find((u) => u.handle === normalizedHandle);
  if (!user) return res.status(401).json({ error: 'Incorrect username or password.' });

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return res.status(401).json({ error: 'Incorrect username or password.' });

  const token = sign(user);
  res.json({ token, user: { id: user.id, handle: user.handle } });
});

module.exports = router;
