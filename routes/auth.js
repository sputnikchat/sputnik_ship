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

// Registro estilo wallet: solo @handle + contraseña. Sin nombre real, sin
// email, sin verificacion de identidad (KYC). Cualquiera con el link del
// servidor puede crear su cuenta salvo que decidas desactivar el registro
// publico (ver README, seccion "Cerrar el registro").
router.post('/signup', async (req, res) => {
  const { handle, password } = req.body || {};
  if (!handle || !password) {
    return res.status(400).json({ error: 'Faltan datos: usuario y contraseña son obligatorios.' });
  }
  if (!HANDLE_RE.test(handle)) {
    return res.status(400).json({ error: 'El usuario debe tener entre 3 y 20 caracteres: letras, números o "_".' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres.' });
  }

  const normalizedHandle = handle.toLowerCase();
  const db = readDB();
  const exists = db.users.find((u) => u.handle === normalizedHandle);
  if (exists) {
    return res.status(409).json({ error: 'Ese usuario ya está en uso.' });
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
    return res.status(400).json({ error: 'Faltan datos: usuario y contraseña.' });
  }

  const normalizedHandle = handle.toLowerCase();
  const db = readDB();
  const user = db.users.find((u) => u.handle === normalizedHandle);
  if (!user) return res.status(401).json({ error: 'Usuario o contraseña incorrectos.' });

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return res.status(401).json({ error: 'Usuario o contraseña incorrectos.' });

  const token = sign(user);
  res.json({ token, user: { id: user.id, handle: user.handle } });
});

module.exports = router;
