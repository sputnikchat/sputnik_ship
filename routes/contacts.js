const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { readDB, update } = require('../services/store');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

router.get('/', (req, res) => {
  const db = readDB();
  const contacts = db.contacts
    .filter((c) => c.userId === req.user.id)
    .sort((a, b) => a.name.localeCompare(b.name));
  res.json(contacts);
});

router.post('/', async (req, res) => {
  const { name, phone, email, address, company, notes } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Name is required.' });

  const contact = {
    id: uuidv4(),
    userId: req.user.id,
    name,
    phone: phone || '',
    email: email || '',
    address: address || '',
    company: company || '',
    notes: notes || '',
    createdAt: new Date().toISOString(),
  };

  await update((data) => {
    data.contacts.push(contact);
  });

  res.status(201).json(contact);
});

router.put('/:id', async (req, res) => {
  const { id } = req.params;
  let updated = null;
  await update((data) => {
    const contact = data.contacts.find((c) => c.id === id && c.userId === req.user.id);
    if (!contact) return;
    const { name, phone, email, address, company, notes } = req.body || {};
    Object.assign(contact, {
      name: name ?? contact.name,
      phone: phone ?? contact.phone,
      email: email ?? contact.email,
      address: address ?? contact.address,
      company: company ?? contact.company,
      notes: notes ?? contact.notes,
    });
    updated = contact;
  });
  if (!updated) return res.status(404).json({ error: 'Contact not found.' });
  res.json(updated);
});

router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  let found = false;
  await update((data) => {
    const before = data.contacts.length;
    data.contacts = data.contacts.filter((c) => !(c.id === id && c.userId === req.user.id));
    found = data.contacts.length < before;
  });
  if (!found) return res.status(404).json({ error: 'Contact not found.' });
  res.status(204).end();
});

module.exports = router;
