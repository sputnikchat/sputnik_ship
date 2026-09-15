(() => {
  'use strict';

  const API = '/api';
  let state = {
    token: localStorage.getItem('sputnikship_token') || null,
    user: JSON.parse(localStorage.getItem('sputnikship_user') || 'null'),
    contacts: [],
    shipments: [],
    notifications: [],
    currentShipmentId: null,
    map: null,
    mapLayer: null,
  };

  // ---------------- helpers ----------------
  function $(sel, root = document) { return root.querySelector(sel); }
  function $all(sel, root = document) { return Array.from(root.querySelectorAll(sel)); }

  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { el.hidden = true; }, 2600);
  }

  async function api(path, { method = 'GET', body } = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (state.token) headers.Authorization = `Bearer ${state.token}`;
    const res = await fetch(API + path, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 401) {
      logout();
      throw new Error('Sesión vencida, entrá de nuevo.');
    }
    if (res.status === 204) return null;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Error de red');
    return data;
  }

  const CARRIER_LABEL = { fedex: 'FedEx', ups: 'UPS', dhl: 'DHL', usps: 'USPS' };

  // Heuristica simple por formato de numero de tracking, igual a lo que
  // hacen ParcelsApp/17TRACK para no obligar a elegir el courier a mano.
  function detectCarrier(raw) {
    const t = (raw || '').replace(/\s+/g, '').toUpperCase();
    if (!t) return null;
    if (/^1Z[0-9A-Z]{16}$/.test(t)) return 'ups';
    if (/^(94|93|92|82|EC|CP)\d{18,20}$/.test(t) || /^[A-Z]{2}\d{9}US$/.test(t)) return 'usps';
    if (/^\d{10}$|^\d{11}$/.test(t)) return 'dhl';
    if (/^\d{12}$|^\d{15}$|^96\d{20}$/.test(t)) return 'fedex';
    return null;
  }

  function fmtDate(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    return d.toLocaleString('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  }

  // ---------------- auth ----------------
  function showAuth() {
    $('#auth-screen').hidden = false;
    $('#app').hidden = true;
  }

  function showApp() {
    $('#auth-screen').hidden = true;
    $('#app').hidden = false;
    loadAll();
    initPush();
  }

  function saveSession(token, user) {
    state.token = token;
    state.user = user;
    localStorage.setItem('sputnikship_token', token);
    localStorage.setItem('sputnikship_user', JSON.stringify(user));
  }

  function logout() {
    state.token = null;
    state.user = null;
    localStorage.removeItem('sputnikship_token');
    localStorage.removeItem('sputnikship_user');
    showAuth();
  }

  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const errEl = $('#login-error');
    errEl.hidden = true;
    try {
      const data = await api('/auth/login', { method: 'POST', body: Object.fromEntries(fd) });
      saveSession(data.token, data.user);
      showApp();
    } catch (err) {
      errEl.textContent = err.message;
      errEl.hidden = false;
    }
  });

  $('#signup-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const errEl = $('#signup-error');
    errEl.hidden = true;
    try {
      const data = await api('/auth/signup', { method: 'POST', body: Object.fromEntries(fd) });
      saveSession(data.token, data.user);
      showApp();
    } catch (err) {
      errEl.textContent = err.message;
      errEl.hidden = false;
    }
  });

  $all('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      $all('.tab').forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      const isLogin = tab.dataset.tab === 'login';
      $('#login-form').hidden = !isLogin;
      $('#signup-form').hidden = isLogin;
    });
  });

  $('#logout-btn').addEventListener('click', logout);

  // ---------------- navigation ----------------
  function showView(name) {
    $all('.view').forEach((v) => v.classList.remove('active'));
    $all('.nav-btn').forEach((b) => b.classList.remove('active'));
    const view = $('#view-' + name);
    if (view) view.classList.add('active');
    const btn = $(`.nav-btn[data-view="${name}"]`);
    if (btn) btn.classList.add('active');
  }

  $all('.nav-btn').forEach((btn) => {
    btn.addEventListener('click', () => showView(btn.dataset.view));
  });

  $('#notif-btn').addEventListener('click', () => showView('notifications'));

  $('#back-to-shipments').addEventListener('click', () => {
    state.currentShipmentId = null;
    showView('shipments');
  });

  // ---------------- data loading ----------------
  async function loadAll() {
    await Promise.all([loadContacts(), loadShipments(), loadNotifications()]);
  }

  async function loadContacts() {
    state.contacts = await api('/contacts');
    renderContacts();
    renderShipmentContactOptions();
  }

  async function loadShipments() {
    state.shipments = await api('/shipments');
    renderShipments();
  }

  async function loadNotifications() {
    state.notifications = await api('/notifications');
    renderNotifications();
  }

  // ---------------- render: contacts ----------------
  function renderContacts() {
    const list = $('#contacts-list');
    const q = ($('#contact-search').value || '').toLowerCase();
    const items = state.contacts.filter((c) =>
      !q || c.name.toLowerCase().includes(q) || (c.company || '').toLowerCase().includes(q)
    );

    if (!items.length) {
      list.innerHTML = `<div class="empty">Todavía no agregaste contactos.<br>Tocá "+ Nuevo contacto" para empezar.</div>`;
      return;
    }

    list.innerHTML = items.map((c) => `
      <div class="card" data-id="${c.id}">
        <div class="card-row">
          <div>
            <p class="card-title">${escapeHtml(c.name)}</p>
            <p class="card-sub">${escapeHtml(c.company || c.phone || c.email || '')}</p>
          </div>
        </div>
        <div class="card-actions">
          <button class="btn-secondary edit-contact" data-id="${c.id}">Editar</button>
          <button class="btn-secondary delete-contact" data-id="${c.id}">Eliminar</button>
        </div>
      </div>
    `).join('');

    $all('.edit-contact', list).forEach((btn) =>
      btn.addEventListener('click', (e) => { e.stopPropagation(); openContactModal(btn.dataset.id); })
    );
    $all('.delete-contact', list).forEach((btn) =>
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!confirm('¿Eliminar este contacto?')) return;
        await api(`/contacts/${btn.dataset.id}`, { method: 'DELETE' });
        toast('Contacto eliminado');
        loadContacts();
      })
    );
  }

  $('#contact-search').addEventListener('input', renderContacts);

  function renderShipmentContactOptions() {
    const select = $('#shipment-form select[name="contactId"]');
    const current = select.value;
    select.innerHTML = '<option value="">— Ninguno —</option>' +
      state.contacts.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
    select.value = current;
  }

  // ---------------- contact modal ----------------
  function openContactModal(id) {
    const form = $('#contact-form');
    form.reset();
    if (id) {
      const c = state.contacts.find((x) => x.id === id);
      $('#contact-modal-title').textContent = 'Editar contacto';
      form.id.value = c.id;
      form.name.value = c.name;
      form.phone.value = c.phone || '';
      form.email.value = c.email || '';
      form.company.value = c.company || '';
      form.address.value = c.address || '';
      form.notes.value = c.notes || '';
    } else {
      $('#contact-modal-title').textContent = 'Nuevo contacto';
      form.id.value = '';
    }
    $('#contact-modal').hidden = false;
  }

  $('#add-contact-btn').addEventListener('click', () => openContactModal(null));
  $('#contact-cancel').addEventListener('click', () => { $('#contact-modal').hidden = true; });
  $('#contact-modal').addEventListener('click', (e) => { if (e.target.id === 'contact-modal') $('#contact-modal').hidden = true; });

  $('#contact-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target));
    try {
      if (fd.id) {
        await api(`/contacts/${fd.id}`, { method: 'PUT', body: fd });
      } else {
        await api('/contacts', { method: 'POST', body: fd });
      }
      $('#contact-modal').hidden = true;
      toast('Contacto guardado');
      loadContacts();
    } catch (err) {
      toast(err.message);
    }
  });

  // ---------------- greeting ----------------
  function renderGreeting() {
    const hour = new Date().getHours();
    const saludo = hour < 12 ? 'Buenos días' : hour < 20 ? 'Buenas tardes' : 'Buenas noches';
    const handle = state.user?.handle || '';
    $('#greeting-title').textContent = handle ? `${saludo}, @${handle}` : saludo;
    const initial = handle ? handle[0].toUpperCase() : '?';
    $('#greeting-avatar').textContent = initial;
    $('#topbar-avatar').textContent = initial;

    const active = state.shipments.filter((s) => s.status !== 'delivered').length;
    $('#active-shipments-count').textContent = active;
    $('#greeting-sub').textContent = active
      ? `Tenés ${active} envío${active === 1 ? '' : 's'} en camino.`
      : 'No tenés envíos en camino ahora mismo.';
  }

  // ---------------- render: shipments ----------------
  function renderShipments() {
    renderGreeting();
    const list = $('#shipments-list');
    const q = ($('#shipment-search').value || '').toLowerCase();
    const items = state.shipments.filter((s) =>
      !q || s.trackingNumber.toLowerCase().includes(q) || (s.label || '').toLowerCase().includes(q)
    );

    if (!state.shipments.length) {
      list.innerHTML = `<div class="empty">Todavía no agregaste envíos.<br>Tocá "+ Nuevo envío" para empezar a hacer seguimiento.</div>`;
      return;
    }
    if (!items.length) {
      list.innerHTML = `<div class="empty">Ningún envío coincide con "${escapeHtml(q)}".</div>`;
      return;
    }
    list.innerHTML = items.map((s) => {
      const contact = state.contacts.find((c) => c.id === s.contactId);
      return `
        <div class="card" data-id="${s.id}">
          <div class="card-row">
            <div>
              <p class="card-title">${escapeHtml(s.label || s.trackingNumber)}</p>
              <p class="card-sub">${escapeHtml(s.trackingNumber)}${contact ? ' · ' + escapeHtml(contact.name) : ''}</p>
            </div>
            <span class="carrier-chip">${CARRIER_LABEL[s.carrier] || s.carrier}</span>
          </div>
          <div class="card-row" style="margin-top:8px; align-items:center;">
            <span class="badge status-${s.status}">${escapeHtml(s.statusLabel || s.status)}</span>
            <span class="card-sub">Últ. chequeo: ${fmtDate(s.lastCheckedAt)}</span>
          </div>
        </div>
      `;
    }).join('');

    $all('.card', list).forEach((card) =>
      card.addEventListener('click', () => openShipmentDetail(card.dataset.id))
    );
  }

  $('#shipment-search').addEventListener('input', renderShipments);

  $('#add-shipment-btn').addEventListener('click', () => {
    renderShipmentContactOptions();
    $('#shipment-form').reset();
    $('#carrier-detect-hint').textContent = '';
    $('#shipment-modal').hidden = false;
  });
  $('#shipment-cancel').addEventListener('click', () => { $('#shipment-modal').hidden = true; });
  $('#shipment-modal').addEventListener('click', (e) => { if (e.target.id === 'shipment-modal') $('#shipment-modal').hidden = true; });

  $('#shipment-form input[name="trackingNumber"]').addEventListener('input', (e) => {
    const carrier = detectCarrier(e.target.value);
    const hint = $('#carrier-detect-hint');
    const select = $('#shipment-form select[name="carrier"]');
    if (carrier) {
      select.value = carrier;
      hint.textContent = `Detectado: ${CARRIER_LABEL[carrier]}`;
    } else {
      hint.textContent = '';
    }
  });

  $('#shipment-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target));
    try {
      await api('/shipments', { method: 'POST', body: fd });
      $('#shipment-modal').hidden = true;
      e.target.reset();
      toast('Envío agregado, buscando tracking…');
      await loadShipments();
    } catch (err) {
      toast(err.message);
    }
  });

  $('#refresh-now-btn').addEventListener('click', async () => {
    toast('Actualizando envíos…');
    try {
      await api('/shipments/refresh-all/now', { method: 'POST' });
      await loadShipments();
      await loadNotifications();
      toast('Envíos actualizados');
    } catch (err) {
      toast(err.message);
    }
  });

  // ---------------- shipment detail + map ----------------
  async function openShipmentDetail(id) {
    state.currentShipmentId = id;
    showView('shipment-detail');
    renderShipmentDetail();
    // refrescamos ese envío puntual al entrar, para ver el ultimo estado
    try {
      const updated = await api(`/shipments/${id}/refresh`, { method: 'POST' });
      const idx = state.shipments.findIndex((s) => s.id === id);
      if (idx >= 0) state.shipments[idx] = updated;
      renderShipmentDetail();
    } catch (err) {
      // si falla el refresh puntual, igual mostramos lo que ya tenemos
    }
  }

  function renderShipmentDetail() {
    const s = state.shipments.find((x) => x.id === state.currentShipmentId);
    if (!s) return;
    const contact = state.contacts.find((c) => c.id === s.contactId);

    $('#shipment-detail-body').innerHTML = `
      <div class="hero-top">
        <div>
          <h2>${escapeHtml(s.label || s.trackingNumber)}</h2>
          <p class="muted small" style="margin:0;">${escapeHtml(s.trackingNumber)}</p>
        </div>
        <span class="carrier-chip">${CARRIER_LABEL[s.carrier] || s.carrier}</span>
      </div>
      <span class="badge status-${s.status}" style="margin-top:10px; display:inline-block;">${escapeHtml(s.statusLabel || s.status)}</span>
      <div class="hero-eta">
        <small>Entrega estimada</small>
        ${fmtDate(s.estimatedDelivery)}
      </div>
      <p class="small muted" style="margin:2px 0 0;">Último chequeo: ${fmtDate(s.lastCheckedAt)}</p>
      ${contact ? `<p class="small" style="margin-top:10px;">📇 ${escapeHtml(contact.name)}</p>` : ''}
      <button class="btn-secondary small" id="delete-shipment-btn" style="margin-top:14px;">Eliminar envío</button>
    `;

    $('#delete-shipment-btn').addEventListener('click', async () => {
      if (!confirm('¿Eliminar este envío?')) return;
      await api(`/shipments/${s.id}`, { method: 'DELETE' });
      toast('Envío eliminado');
      state.currentShipmentId = null;
      showView('shipments');
      loadShipments();
    });

    // El mapa depende de una librería externa (Leaflet); si por lo que sea no
    // cargó (sin internet, un bloqueador, una red restringida) no queremos
    // que eso rompa el resto del detalle del envío.
    try {
      renderMap(s);
    } catch (err) {
      console.error('No se pudo dibujar el mapa:', err);
      $('#map').innerHTML = '<div class="empty" style="padding:20px;">No se pudo cargar el mapa (sin conexión al proveedor de mapas). El resto de la información del envío sigue disponible abajo.</div>';
    }
    renderCheckpoints(s);
  }

  function renderMap(shipment) {
    const container = $('#map');
    const route = shipment.fullRoute && shipment.fullRoute.length ? shipment.fullRoute : null;

    if (!route) {
      container.innerHTML = '<div class="empty" style="padding:20px;">El mapa aparece en cuanto el courier reporte el primer checkpoint.</div>';
      return;
    }
    if (typeof L === 'undefined') {
      container.innerHTML = '<div class="empty" style="padding:20px;">No se pudo cargar el mapa (sin conexión al proveedor de mapas). El resto de la información del envío sigue disponible abajo.</div>';
      return;
    }
    container.innerHTML = '';

    if (state.map) {
      state.map.remove();
      state.map = null;
    }

    state.map = L.map(container, { zoomControl: true, attributionControl: true });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18,
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(state.map);

    const latlngs = route.map((p) => [p.lat, p.lng]);
    const doneIndex = shipment.checkpointIndex ?? -1;

    L.polyline(latlngs, { color: '#4b4b52', weight: 3, dashArray: '6 6' }).addTo(state.map);
    if (doneIndex >= 0) {
      L.polyline(latlngs.slice(0, doneIndex + 1), { color: '#cfff52', weight: 4 }).addTo(state.map);
    }

    route.forEach((p, i) => {
      const isDone = i <= doneIndex;
      const marker = L.circleMarker([p.lat, p.lng], {
        radius: i === doneIndex ? 9 : 6,
        color: isDone ? '#cfff52' : '#4b4b52',
        fillColor: isDone ? '#cfff52' : '#28282d',
        fillOpacity: 1,
        weight: 2,
      }).addTo(state.map);
      marker.bindPopup(`<b>${escapeHtml(p.label)}</b>`);
    });

    const bounds = L.latLngBounds(latlngs);
    state.map.fitBounds(bounds, { padding: [30, 30] });
  }

  function renderCheckpoints(shipment) {
    const list = $('#checkpoints-list');
    const checkpoints = shipment.checkpoints || [];
    if (!checkpoints.length) {
      list.innerHTML = '';
      return;
    }
    list.innerHTML = checkpoints.slice().reverse().map((c) => `
      <div class="checkpoint">
        <div>
          <div class="checkpoint-label">${escapeHtml(c.label)}</div>
          <div class="checkpoint-time">${fmtDate(c.timestamp)}</div>
        </div>
      </div>
    `).join('');
  }

  // ---------------- notifications ----------------
  function renderNotifications() {
    const list = $('#notifications-list');
    const unread = state.notifications.filter((n) => !n.read).length;
    $('#notif-dot').hidden = unread === 0;

    if (!state.notifications.length) {
      list.innerHTML = `<div class="empty">Sin notificaciones todavía. Te avisamos acá cuando cambie el estado de un envío.</div>`;
      return;
    }

    list.innerHTML = state.notifications.map((n) => `
      <div class="card notif-card ${n.read ? '' : 'unread'}" data-id="${n.id}">
        <div class="notif-dotmark ${n.read ? 'read' : ''}"></div>
        <div>
          <p class="card-title">${escapeHtml(n.title)}</p>
          <p class="card-sub">${escapeHtml(n.message)}</p>
          <p class="card-sub">${fmtDate(n.createdAt)}</p>
        </div>
      </div>
    `).join('');

    $all('.notif-card', list).forEach((card) =>
      card.addEventListener('click', async () => {
        await api(`/notifications/${card.dataset.id}/read`, { method: 'POST' });
        loadNotifications();
      })
    );
  }

  $('#mark-all-read-btn').addEventListener('click', async () => {
    await api('/notifications/read-all', { method: 'POST' });
    loadNotifications();
  });

  // ---------------- push notifications del navegador (opcional) ----------------
  function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(base64);
    return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
  }

  function pushSupported() {
    return 'serviceWorker' in navigator && 'PushManager' in window;
  }

  async function initPush() {
    const btn = $('#push-toggle-btn');
    if (!pushSupported()) return;
    btn.hidden = false;

    try {
      const reg = await navigator.serviceWorker.ready;
      const existing = await reg.pushManager.getSubscription();
      updatePushButton(Boolean(existing));
    } catch (err) {
      // si el service worker no esta listo todavia, dejamos el boton en su estado inicial
    }
  }

  function updatePushButton(subscribed) {
    const btn = $('#push-toggle-btn');
    btn.textContent = subscribed ? 'Notificaciones activadas ✓' : 'Activar notificaciones';
  }

  $('#push-toggle-btn').addEventListener('click', async () => {
    if (!pushSupported()) return;
    try {
      const reg = await navigator.serviceWorker.ready;
      const existing = await reg.pushManager.getSubscription();
      if (existing) {
        toast('Las notificaciones ya están activadas en este navegador.');
        return;
      }

      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        toast('No se concedió el permiso de notificaciones.');
        return;
      }

      const { publicKey } = await api('/push/vapid-public-key');
      if (!publicKey) {
        toast('El servidor todavía no tiene configuradas las notificaciones push.');
        return;
      }

      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
      await api('/push/subscribe', { method: 'POST', body: sub.toJSON() });
      updatePushButton(true);
      toast('Notificaciones activadas');
    } catch (err) {
      toast('No se pudo activar las notificaciones: ' + err.message);
    }
  });

  function escapeHtml(str) {
    return String(str ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  // ---------------- polling ligero mientras la app esta abierta ----------------
  // Ademas del refresh automatico del servidor cada 30 min, refrescamos
  // notificaciones/envios cada 2 min mientras el usuario tiene la app abierta,
  // para que se vea al toque si el scheduler encontro cambios.
  setInterval(() => {
    if (state.token) {
      loadNotifications().catch(() => {});
    }
  }, 2 * 60 * 1000);

  // ---------------- boot ----------------
  if (state.token && state.user) {
    showApp();
  } else {
    showAuth();
  }

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/service-worker.js').catch(() => {});
    });
  }
})();
