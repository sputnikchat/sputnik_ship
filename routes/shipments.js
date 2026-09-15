const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { readDB, update } = require('../services/store');
const { requireAuth } = require('../middleware/auth');
const { getTrackingUpdate, CARRIERS } = require('../services/carrierProviders');
const { pushNotification } = require('../services/notify');
const { refreshAllShipments } = require('../services/scheduler');

const router = express.Router();
router.use(requireAuth);

router.get('/', (req, res) => {
  const db = readDB();
  const shipments = db.shipments
    .filter((s) => s.userId === req.user.id)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json(shipments);
});

router.post('/', async (req, res) => {
  const { carrier, trackingNumber, contactId, label } = req.body || {};
  if (!carrier || !CARRIERS.includes(String(carrier).toLowerCase())) {
    return res.status(400).json({ error: `El courier debe ser uno de: ${CARRIERS.join(', ')}` });
  }
  if (!trackingNumber) return res.status(400).json({ error: 'El numero de tracking es obligatorio.' });

  const shipment = {
    id: uuidv4(),
    userId: req.user.id,
    carrier: String(carrier).toLowerCase(),
    trackingNumber: String(trackingNumber).trim(),
    contactId: contactId || null,
    label: label || '',
    status: 'label_created',
    statusLabel: 'Etiqueta creada',
    checkpointIndex: -1,
    checkpoints: [],
    fullRoute: [],
    currentLocation: null,
    estimatedDelivery: null,
    lastCheckedAt: null,
    archived: false,
    createdAt: new Date().toISOString(),
  };

  await update((data) => {
    data.shipments.push(shipment);
  });

  // Primera consulta de tracking inmediata, para que el envio no aparezca
  // vacio hasta el proximo ciclo del scheduler (cada 30 min por defecto).
  try {
    const result = await getTrackingUpdate(shipment.carrier, shipment.trackingNumber, shipment);
    await update((data) => {
      const s = data.shipments.find((x) => x.id === shipment.id);
      if (!s) return;
      Object.assign(s, {
        status: result.status,
        statusLabel: result.statusLabel,
        checkpointIndex: result.checkpointIndex,
        fullRoute: result.fullRoute,
        checkpoints: result.checkpoints,
        currentLocation: result.currentLocation,
        estimatedDelivery: result.estimatedDelivery,
        lastCheckedAt: new Date().toISOString(),
      });
      pushNotification(data, {
        userId: s.userId,
        shipmentId: s.id,
        title: `Envio agregado: ${s.trackingNumber} (${s.carrier.toUpperCase()})`,
        message: `Estado inicial: ${result.statusLabel}`,
        level: 'info',
      });
    });
  } catch (err) {
    console.error('No se pudo obtener el tracking inicial:', err.message);
  }

  const db = readDB();
  res.status(201).json(db.shipments.find((s) => s.id === shipment.id));
});

router.get('/:id', (req, res) => {
  const db = readDB();
  const shipment = db.shipments.find((s) => s.id === req.params.id && s.userId === req.user.id);
  if (!shipment) return res.status(404).json({ error: 'Envio no encontrado.' });
  res.json(shipment);
});

// Forzar una actualizacion manual de UN envio (ademas del refresh automatico cada 30 min).
router.post('/:id/refresh', async (req, res) => {
  const db = readDB();
  const shipment = db.shipments.find((s) => s.id === req.params.id && s.userId === req.user.id);
  if (!shipment) return res.status(404).json({ error: 'Envio no encontrado.' });

  try {
    const result = await getTrackingUpdate(shipment.carrier, shipment.trackingNumber, shipment);
    let updated = null;
    await update((data) => {
      const s = data.shipments.find((x) => x.id === shipment.id);
      const statusChanged = result.status !== s.status;
      Object.assign(s, {
        status: result.status,
        statusLabel: result.statusLabel,
        checkpointIndex: result.checkpointIndex,
        fullRoute: result.fullRoute,
        checkpoints: result.checkpoints,
        currentLocation: result.currentLocation,
        estimatedDelivery: result.estimatedDelivery,
        lastCheckedAt: new Date().toISOString(),
      });
      if (statusChanged) {
        pushNotification(data, {
          userId: s.userId,
          shipmentId: s.id,
          title: `Envio ${s.trackingNumber} (${s.carrier.toUpperCase()})`,
          message: `Nuevo estado: ${result.statusLabel}`,
          level: result.status === 'delivered' ? 'success' : 'info',
        });
      }
      updated = s;
    });
    res.json(updated);
  } catch (err) {
    res.status(502).json({ error: `No se pudo actualizar el tracking: ${err.message}` });
  }
});

router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  let found = false;
  await update((data) => {
    const before = data.shipments.length;
    data.shipments = data.shipments.filter((s) => !(s.id === id && s.userId === req.user.id));
    found = data.shipments.length < before;
  });
  if (!found) return res.status(404).json({ error: 'Envio no encontrado.' });
  res.status(204).end();
});

// Dispara manualmente el ciclo de refresh de TODOS los envios (lo mismo
// que hace el scheduler cada 30 min). Util para probar sin esperar.
router.post('/refresh-all/now', async (req, res) => {
  await refreshAllShipments();
  const db = readDB();
  const shipments = db.shipments.filter((s) => s.userId === req.user.id);
  res.json({ ok: true, shipments });
});

module.exports = router;
