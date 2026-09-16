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
      throw new Error('Session expired, please log in again.');
    }
    if (res.status === 204) return null;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Network error');
    return data;
  }

  const CARRIER_LABEL = { fedex: 'FedEx', ups: 'UPS', dhl: 'DHL', usps: 'USPS' };

  // Simple heuristic based on tracking number format, same approach
  // ParcelsApp/17TRACK use so people don't have to pick the courier by hand.
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
    return d.toLocaleString('en-US', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
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
      list.innerHTML = `<div class="empty">You haven't added any contacts yet.<br>Tap "+ New contact" to get started.</div>`;
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
          <button class="btn-secondary edit-contact" data-id="${c.id}">Edit</button>
          <button class="btn-secondary delete-contact" data-id="${c.id}">Delete</button>
        </div>
      </div>
    `).join('');

    $all('.edit-contact', list).forEach((btn) =>
      btn.addEventListener('click', (e) => { e.stopPropagation(); openContactModal(btn.dataset.id); })
    );
    $all('.delete-contact', list).forEach((btn) =>
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!confirm('Delete this contact?')) return;
        await api(`/contacts/${btn.dataset.id}`, { method: 'DELETE' });
        toast('Contact deleted');
        loadContacts();
      })
    );
  }

  $('#contact-search').addEventListener('input', renderContacts);

  function renderShipmentContactOptions() {
    const select = $('#shipment-form select[name="contactId"]');
    const current = select.value;
    select.innerHTML = '<option value="">— None —</option>' +
      state.contacts.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
    select.value = current;
  }

  // ---------------- contact modal ----------------
  function openContactModal(id) {
    const form = $('#contact-form');
    form.reset();
    if (id) {
      const c = state.contacts.find((x) => x.id === id);
      $('#contact-modal-title').textContent = 'Edit contact';
      form.id.value = c.id;
      form.name.value = c.name;
      form.phone.value = c.phone || '';
      form.email.value = c.email || '';
      form.company.value = c.company || '';
      form.address.value = c.address || '';
      form.notes.value = c.notes || '';
    } else {
      $('#contact-modal-title').textContent = 'New contact';
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
      toast('Contact saved');
      loadContacts();
    } catch (err) {
      toast(err.message);
    }
  });

  // ---------------- greeting ----------------
  function renderGreeting() {
    const handle = state.user?.handle || '';
    $('#greeting-title').textContent = handle ? `@${handle}` : 'Hi';
    const initial = handle ? handle[0].toUpperCase() : '?';
    $('#greeting-avatar').textContent = initial;
    $('#topbar-avatar').textContent = initial;

    const active = state.shipments.filter((s) => s.status !== 'delivered').length;
    $('#active-shipments-count').textContent = active;
    $('#greeting-sub').textContent = active
      ? `You have ${active} shipment${active === 1 ? '' : 's'} on the way.`
      : 'No shipments on the way right now.';
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
      list.innerHTML = `<div class="empty">You haven't added any shipments yet.<br>Tap "+ New shipment" to start tracking.</div>`;
      return;
    }
    if (!items.length) {
      list.innerHTML = `<div class="empty">No shipment matches "${escapeHtml(q)}".</div>`;
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
            <span class="card-sub">Last checked: ${fmtDate(s.lastCheckedAt)}</span>
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
      hint.textContent = `Detected: ${CARRIER_LABEL[carrier]}`;
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
      toast('Shipment added, looking up tracking…');
      await loadShipments();
    } catch (err) {
      toast(err.message);
    }
  });

  $('#refresh-now-btn').addEventListener('click', async () => {
    toast('Refreshing shipments…');
    try {
      await api('/shipments/refresh-all/now', { method: 'POST' });
      await loadShipments();
      await loadNotifications();
      toast('Shipments updated');
    } catch (err) {
      toast(err.message);
    }
  });

  // ---------------- shipment detail + map ----------------
  async function openShipmentDetail(id) {
    state.currentShipmentId = id;
    showView('shipment-detail');
    renderShipmentDetail();
    // Refresh this specific shipment on open, to show the latest status.
    try {
      const updated = await api(`/shipments/${id}/refresh`, { method: 'POST' });
      const idx = state.shipments.findIndex((s) => s.id === id);
      if (idx >= 0) state.shipments[idx] = updated;
      renderShipmentDetail();
    } catch (err) {
      // If the targeted refresh fails, we still show what we already have.
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
        <small>Estimated delivery</small>
        ${fmtDate(s.estimatedDelivery)}
      </div>
      <p class="small muted" style="margin:2px 0 0;">Last checked: ${fmtDate(s.lastCheckedAt)}</p>
      ${contact ? `<p class="small" style="margin-top:10px;">📇 ${escapeHtml(contact.name)}</p>` : ''}
      <button class="btn-secondary small" id="delete-shipment-btn" style="margin-top:14px;">Delete shipment</button>
    `;

    $('#delete-shipment-btn').addEventListener('click', async () => {
      if (!confirm('Delete this shipment?')) return;
      await api(`/shipments/${s.id}`, { method: 'DELETE' });
      toast('Shipment deleted');
      state.currentShipmentId = null;
      showView('shipments');
      loadShipments();
    });

    // The map depends on an external library (Leaflet); if it fails to
    // load for any reason (offline, a blocker, a restricted network) we
    // don't want that to break the rest of the shipment detail.
    try {
      renderMap(s);
    } catch (err) {
      console.error('Could not render the map:', err);
      $('#map').innerHTML = '<div class="empty" style="padding:20px;">Could not load the map (no connection to the map provider). The rest of the shipment info is still available below.</div>';
    }
    renderCheckpoints(s);
  }

  function renderMap(shipment) {
    const container = $('#map');
    const route = shipment.fullRoute && shipment.fullRoute.length ? shipment.fullRoute : null;

    if (!route) {
      container.innerHTML = '<div class="empty" style="padding:20px;">The map will appear as soon as the courier reports the first checkpoint.</div>';
      return;
    }
    if (typeof L === 'undefined') {
      container.innerHTML = '<div class="empty" style="padding:20px;">Could not load the map (no connection to the map provider). The rest of the shipment info is still available below.</div>';
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

    L.polyline(latlngs, { color: '#8a7460', weight: 3, dashArray: '6 6' }).addTo(state.map);
    if (doneIndex >= 0) {
      L.polyline(latlngs.slice(0, doneIndex + 1), { color: '#ffd23f', weight: 4 }).addTo(state.map);
    }

    route.forEach((p, i) => {
      const isDone = i <= doneIndex;
      const marker = L.circleMarker([p.lat, p.lng], {
        radius: i === doneIndex ? 9 : 6,
        color: isDone ? '#ffd23f' : '#8a7460',
        fillColor: isDone ? '#ffd23f' : '#2b241d',
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
      list.innerHTML = `<div class="empty">No notifications yet. We'll let you know here when a shipment's status changes.</div>`;
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

  // ---------------- browser push notifications (optional) ----------------
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
      // If the service worker isn't ready yet, leave the button in its default state.
    }
  }

  function updatePushButton(subscribed) {
    const btn = $('#push-toggle-btn');
    btn.textContent = subscribed ? 'Notifications enabled ✓' : 'Enable notifications';
  }

  $('#push-toggle-btn').addEventListener('click', async () => {
    if (!pushSupported()) return;
    try {
      const reg = await navigator.serviceWorker.ready;
      const existing = await reg.pushManager.getSubscription();
      if (existing) {
        toast('Notifications are already enabled in this browser.');
        return;
      }

      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        toast('Notification permission was not granted.');
        return;
      }

      const { publicKey } = await api('/push/vapid-public-key');
      if (!publicKey) {
        toast('The server does not have push notifications configured yet.');
        return;
      }

      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
      await api('/push/subscribe', { method: 'POST', body: sub.toJSON() });
      updatePushButton(true);
      toast('Notifications enabled');
    } catch (err) {
      toast('Could not enable notifications: ' + err.message);
    }
  });

  function escapeHtml(str) {
    return String(str ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  // ---------------- light polling while the app is open ----------------
  // Besides the server's automatic refresh every 30 min, we refresh
  // notifications/shipments every 2 min while the app is open, so
  // changes picked up by the scheduler show up quickly.
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
