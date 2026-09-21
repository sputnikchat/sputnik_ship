const express = require('express');
const rateLimit = require('express-rate-limit');
const { v4: uuidv4 } = require('uuid');
const { readDB, update } = require('../services/store');
const { requireAuth } = require('../middleware/auth');
const { getSpaceUserIds } = require('../services/space');
const { encryptField, decryptField } = require('../services/encryption');
const { ValidationError, optionalText, requiredText } = require('../services/validate');

const router = express.Router();
router.use(requireAuth);

// Same budget as shipment writes (routes/shipments.js): plenty for a
// person, a wall for a script.
const writeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please wait a few minutes and try again.' },
});

// A contact is the most personal data in the app - a real name, phone,
// email and home address - so all of it is encrypted at rest with the
// same AES-256-GCM key as a shipment's photo and cost (see
// services/encryption.js): a leaked database or backup shows ciphertext,
// not people's addresses. Contacts saved before this change are still
// plain text and pass through decryptField unchanged, so nothing needs
// migrating; they get encrypted the next time they're edited.
const PII_FIELDS = ['name', 'phone', 'email', 'address', 'notes'];
const LIMITS = { name: 120, phone: 40, email: 254, address: 500, notes: 2000 };

function decryptContact(contact) {
  const out = { ...contact };
  for (const field of PII_FIELDS) out[field] = decryptField(contact[field]) || '';
  return out;
}

function validationFailed(res, err) {
  if (err instanceof ValidationError) {
    res.status(400).json({ error: err.message });
    return true;
  }
  return false;
}

router.get('/', async (req, res) => {
  const db = await readDB();
  const spaceUserIds = getSpaceUserIds(db, req.user.id);
  const contacts = db.contacts
    .filter((c) => spaceUserIds.includes(c.userId))
    .map(decryptContact)
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
  res.json(contacts);
});

router.post('/', writeLimiter, async (req, res) => {
  const body = req.body || {};
  let clean;
  try {
    clean = {
      name: requiredText(body.name, LIMITS.name, 'Name is required.'),
      phone: optionalText(body.phone, LIMITS.phone),
      email: optionalText(body.email, LIMITS.email),
      address: optionalText(body.address, LIMITS.address),
      notes: optionalText(body.notes, LIMITS.notes),
    };
  } catch (err) {
    if (validationFailed(res, err)) return;
    throw err;
  }

  const contact = {
    id: uuidv4(),
    userId: req.user.id,
    createdAt: new Date().toISOString(),
  };
  for (const field of PII_FIELDS) contact[field] = encryptField(clean[field]);

  await update((data) => {
    data.contacts.push(contact);
  });

  res.status(201).json(decryptContact(contact));
});

router.put('/:id', writeLimiter, async (req, res) => {
  const { id } = req.params;
  const body = req.body || {};
  // Only the fields actually sent are changed (same as before); each one
  // sent is validated and re-encrypted.
  const changes = {};
  try {
    for (const field of PII_FIELDS) {
      if (body[field] === undefined || body[field] === null) continue;
      changes[field] = field === 'name'
        ? requiredText(body[field], LIMITS[field], 'Name is required.')
        : optionalText(body[field], LIMITS[field]);
    }
  } catch (err) {
    if (validationFailed(res, err)) return;
    throw err;
  }

  const db = await readDB();
  const spaceUserIds = getSpaceUserIds(db, req.user.id);
  let updated = null;
  await update((data) => {
    const contact = data.contacts.find((c) => c.id === id && spaceUserIds.includes(c.userId));
    if (!contact) return;
    for (const [field, value] of Object.entries(changes)) contact[field] = encryptField(value);
    updated = contact;
  });
  if (!updated) return res.status(404).json({ error: 'Contact not found.' });
  res.json(decryptContact(updated));
});

router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  const db = await readDB();
  const spaceUserIds = getSpaceUserIds(db, req.user.id);
  let found = false;
  await update((data) => {
    const before = data.contacts.length;
    data.contacts = data.contacts.filter((c) => !(c.id === id && spaceUserIds.includes(c.userId)));
    found = data.contacts.length < before;
  });
  if (!found) return res.status(404).json({ error: 'Contact not found.' });
  res.status(204).end();
});

module.exports = router;
