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

  // Thin-stroke icons (matches the rest of the app's icon language) used
  // inside JS-rendered templates - static markup in index.html has its
  // own inline copies of the same style.
  const ICONS = {
    contact: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="12" r="2"/><path d="M14 10h4M14 14h4M6.3 16.8c.5-1.7 1.8-2.4 2.7-2.4s2.2.7 2.7 2.4"/></svg>',
    phone: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 4h3l1.5 4-2 1.5a11 11 0 0 0 5.5 5.5l1.5-2 4 1.5v3a2 2 0 0 1-2.2 2A17 17 0 0 1 3 5.2 2 2 0 0 1 5 4Z"/></svg>',
    email: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m4 7 8 6 8-6"/></svg>',
    building: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="3" width="16" height="18" rx="1"/><path d="M9 8h.01M15 8h.01M9 12h.01M15 12h.01M9 16h.01M15 16h.01"/></svg>',
  };

  // Official brand marks (Simple Icons, https://simpleicons.org) with each
  // courier's real brand color as the badge background.
  const COURIER_BADGE = {
    fedex: {
      color: '#4D148C',
      iconColor: '#fff',
      path: 'M22.498 14.298c-.016-.414.345-.751.75-.755a.745.745 0 0 1 .752.755.755.755 0 0 1-.751.745c-.395.002-.759-.346-.751-.745zm.759-.083c.067-.02.164-.042.162-.13.007-.09-.086-.133-.162-.134h-.163v.263c0 .001.165-.002.163.001zm-.163.107v.418h-.14v-.91h.327c.156-.021.294.092.286.253a.218.218 0 0 1-.156.19c.162.083.108.322.173.467h-.156a2.355 2.355 0 0 1-.04-.205c-.018-.093-.047-.229-.17-.213h-.124zm.76-.024a.603.603 0 0 0-.605-.632c-.338-.012-.62.302-.605.632a.619.619 0 0 0 .605.622.61.61 0 0 0 .605-.622zm-5.052-.579l-.878 1.008h-1.306l1.559-1.745-1.56-1.75h1.355l.902.997.878-.998h1.306l-1.543 1.743 1.559 1.753h-1.371l-.901-1.008zm-4.703-.352v-.827h1.904v-1.506l1.724 1.948-1.724 1.941v-1.556h-1.904zm1.56 1.36h-3.2V9.044h3.224v1.024H13.77v1.163h1.888v.958h-1.904v1.522h1.904v1.016zm-5.705-.655c-.54.017-.878-.552-.877-1.04-.01-.507.307-1.123.878-1.105.579-.025.871.6.845 1.103.023.501-.29 1.062-.846 1.042zM4.743 12.41c.076-.358.403-.67.78-.663a.788.788 0 0 1 .803.663H4.743zm15.182.564l1.815-2.047h-2.125l-.74.844-.763-.844h-4.037v-.548h1.912V8.741H10.84v2.58c-.362-.448-.981-.559-1.526-.492-.782.123-1.427.762-1.634 1.514-.254-.958-1.179-1.588-2.157-1.554-.781.009-1.6.365-1.987 1.071v-.818h-1.87v-.9h2.043v-1.4H0v6.287h1.666v-2.644h1.666a7.59 7.59 0 0 0-.082.622c-.013 1.232 1.042 2.27 2.274 2.236a2.204 2.204 0 0 0 2.157-1.432H6.254c-.14.268-.441.38-.73.36-.457.009-.83-.417-.829-.86h2.914c.083 1.027.988 1.966 2.043 1.947a1.53 1.53 0 0 0 1.19-.639v.41h7.215l.754-.86.754.86h2.192l-1.832-2.055z',
    },
    ups: {
      color: '#150400',
      iconColor: '#fff',
      path: 'M11.668 14.544l-.028-5.226c.138-.055.387-.111.608-.111.995 0 1.41.774 1.41 2.682 0 1.853-.47 2.765-1.438 2.765-.22 0-.441-.055-.552-.11zM3.124 7.438c4.203-3.843 9.29-4.866 14.018-4.866 1.3 0 2.544.083 3.76.194h-.028v11.253c0 2.184-.774 3.926-2.295 5.171-1.355 1.134-5.447 2.959-6.581 3.456-1.161-.525-5.253-2.378-6.581-3.456-1.493-1.244-2.295-3.014-2.295-5.171V7.438zm12.664 2.599c.028.912.276 1.576 1.687 2.406.747.442 1.051.747 1.051 1.272 0 .581-.387.94-1.023.94-.553 0-1.189-.304-1.631-.691v1.576c.553.304 1.217.525 1.88.525 1.687 0 2.433-1.189 2.461-2.267.028-.995-.249-1.742-1.659-2.571-.608-.387-1.134-.636-1.106-1.244 0-.581.525-.802.995-.802.581 0 1.161.332 1.521.691V8.378c-.304-.221-.94-.581-1.88-.553-1.135.028-2.296.829-2.296 2.212zm-5.834 9.484h1.714l-.028-3.594c.166.028.415.083.774.083 1.908 0 2.986-1.687 2.986-4.175 0-2.461-1.106-4.009-3.152-4.009-.94 0-1.687.221-2.295.608v11.087zm-5.945-6.166c0 1.797.829 2.71 2.516 2.71 1.051 0 1.908-.249 2.571-.691V7.991H7.41v6.387c-.194.138-.47.221-.802.221-.774 0-.885-.719-.885-1.189V7.991H4.009v5.364zM22.12 2.295v11.723c0 2.516-.94 4.645-2.765 6.111-1.549 1.3-6.332 3.429-7.355 3.871-1.023-.442-5.806-2.571-7.355-3.843-1.797-1.465-2.765-3.594-2.765-6.111V2.295C4.756.747 8.074 0 12 0s7.244.747 10.12 2.295zm-.304.221c-2.71-1.465-6-2.184-9.788-2.184s-7.079.746-9.788 2.184v11.502c0 2.433.912 4.452 2.627 5.862 1.576 1.3 6.581 3.484 7.161 3.76.581-.249 5.585-2.433 7.161-3.733 1.714-1.41 2.627-3.429 2.627-5.862V2.516zm-2.433 20.295c0 .47-.387.829-.829.829a.831.831 0 0 1-.829-.829c0-.47.387-.829.829-.829.441 0 .801.359.829.829zm-.166 0a.679.679 0 0 0-.664-.691c-.359 0-.664.332-.664.691 0 .359.304.664.664.664a.673.673 0 0 0 .664-.664zm-.553.055c.028.055.304.442.304.442h-.221s-.276-.387-.276-.415h-.028v.415h-.194v-.995l.304-.028c.249 0 .332.166.332.304s-.083.25-.221.277zm.027-.276c0-.055 0-.138-.166-.138h-.083v.304h.028c.194 0 .221-.083.221-.166z',
    },
    dhl: {
      color: '#FFCC00',
      iconColor: '#D40511',
      path: 'M4.22 10.303l-.767 1.043h4.18c.21 0 .208.078.105.218-.105.142-.28.39-.386.534-.054.073-.154.207.171.207h1.71l.505-.69c.314-.426.028-1.312-1.095-1.312H4.22zm7.204 0l-1.475 2.002h5.39l1.473-2.002H14.61l-.843 1.146h-.985l.846-1.146h-2.203zm6.105 0l-1.474 2.002h2.334l1.472-2.002H17.53zm-12.845 1.3l-1.54 2.094h3.754c1.24 0 1.932-.844 2.145-1.136h-2.56c-.326 0-.226-.133-.172-.207.107-.143.283-.388.388-.53.104-.14.107-.22-.105-.22h-1.91zM0 12.562v.242h3.398l.176-.242H0zm9.762 0l-.836 1.136h2.203l.836-1.136H9.762zm3.185 0l-.836 1.136h2.203l.836-1.136h-2.203zm2.918 0s-.159.22-.238.326c-.276.374-.033.81.87.81h3.538l.834-1.136h-5.004zm5.408 0l-.177.242H24v-.242h-2.727zM0 13.01v.24h3.068l.178-.24H0zm20.943 0l-.175.24H24v-.24h-3.057zM0 13.457v.24h2.74l.176-.24H0zm20.615 0l-.177.24H24v-.24h-3.385z',
    },
    usps: {
      color: '#333366',
      iconColor: '#fff',
      path: 'M3.145 4.577L0 19.423h20.855L24 4.577H3.145zm-.157 3.806h9.436c.157 0 5.064 0 5.159.975H9.09l1.321 4.026c1.51-.723 5.222-2.233 7.455-2.328.944-.031 1.321.126 1.132.252-.126.063-1.038.189-1.761.377-1.258.315-1.321.315-2.642.755-1.478.503-2.705 1.069-4.53 1.919L.723 18.983l2.265-10.6zm16.483 1.698c-.535-.094-2.768.063-3.334.063-.126 0-.472.031-.472-.063 0-.063.126-.063.377-.094s1.006-.157 1.258-.283c.063-.063.22-.157.315-.252.031-.063.063-.094.157-.094h1.164c.755 0 1.195.094 1.132.723-.031.315-.472 1.132-.629 1.384-.063.094-.189.189-.157 0 .126-.503.597-1.321.189-1.384zm.88 8.902H2.076s17.363-6.794 17.552-6.92c0 0 1.541-2.076.629-2.925-.283-.283-.692-.283-2.265-.283 0 0-.063-.598-2.485-1.164-.283-.063-11.858-2.517-11.858-2.517h19.628l-2.926 13.809zm2.925-.695c0-.195-.114-.293-.358-.293h-.406v1.008h.146v-.439h.179l.276.455h.179L23 18.564c.162-.016.276-.097.276-.276zm-.455.146h-.163v-.341h.211c.114 0 .228.016.228.163 0 .162-.13.178-.276.178zm.016-.829a.868.868 0 0 0-.894.878c0 .504.406.894.894.894s.894-.39.894-.894a.878.878 0 0 0-.894-.878zm0 1.642c-.423 0-.731-.325-.731-.764 0-.423.325-.748.731-.748.406 0 .731.325.731.748 0 .439-.325.764-.731.764z',
    },
  };

  function courierBadge(carrier) {
    const b = COURIER_BADGE[carrier];
    if (!b) return `<span class="carrier-chip">${CARRIER_LABEL[carrier] || carrier}</span>`;
    return `
      <span class="courier-badge" style="background:${b.color};" title="${CARRIER_LABEL[carrier] || carrier}">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="${b.iconColor}" xmlns="http://www.w3.org/2000/svg"><path d="${b.path}"/></svg>
      </span>
    `;
  }

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
      showRecoveryCode(data.recoveryCode, showApp);
    } catch (err) {
      errEl.textContent = err.message;
      errEl.hidden = false;
    }
  });

  $all('.auth-screen .tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      $all('.auth-screen .tab').forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      const isLogin = tab.dataset.tab === 'login';
      $('#login-form').hidden = !isLogin;
      $('#signup-form').hidden = isLogin;
      $('#recovery-form').hidden = true;
    });
  });

  $('#logout-btn').addEventListener('click', logout);

  // ---------------- forgot password / account recovery ----------------
  $('#forgot-password-btn').addEventListener('click', () => {
    $('#login-form').hidden = true;
    $('#signup-form').hidden = true;
    $('#recovery-form').hidden = false;
  });

  $('#recovery-back-btn').addEventListener('click', () => {
    $('#recovery-form').hidden = true;
    $('#login-form').hidden = false;
  });

  $('#recovery-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const errEl = $('#recovery-error');
    errEl.hidden = true;
    try {
      const data = await api('/auth/recover', { method: 'POST', body: Object.fromEntries(fd) });
      saveSession(data.token, data.user);
      $('#recovery-form').hidden = true;
      $('#recovery-form').reset();
      showRecoveryCode(data.recoveryCode, showApp);
    } catch (err) {
      errEl.textContent = err.message;
      errEl.hidden = false;
    }
  });

  // Shows a recovery code once, blocking further action until the user
  // checks "I saved it" - used after signup, after recovering a locked
  // account, and after regenerating a code from Account settings.
  function showRecoveryCode(code, onContinue) {
    const modal = $('#recovery-reveal-modal');
    const check = $('#recovery-code-saved-check');
    const continueBtn = $('#recovery-code-continue-btn');
    $('#recovery-code-display').textContent = code;
    check.checked = false;
    continueBtn.disabled = true;
    modal.hidden = false;

    check.onchange = () => { continueBtn.disabled = !check.checked; };
    $('#recovery-code-copy-btn').onclick = async () => {
      try {
        await navigator.clipboard.writeText(code);
        toast('Recovery code copied');
      } catch (err) {
        toast('Could not copy — select and copy it manually');
      }
    };
    continueBtn.onclick = () => {
      modal.hidden = true;
      if (onContinue) onContinue();
    };
  }

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

    list.innerHTML = items.map((c) => {
      const methods = [
        c.company ? `<span class="contact-method">${ICONS.building}${escapeHtml(c.company)}</span>` : '',
        c.phone ? `<span class="contact-method">${ICONS.phone}${escapeHtml(c.phone)}</span>` : '',
        c.email ? `<span class="contact-method">${ICONS.email}${escapeHtml(c.email)}</span>` : '',
      ].filter(Boolean).join('');
      return `
      <div class="card contact-card" data-id="${c.id}">
        <div class="contact-card-row">
          <div class="avatar avatar-sm">${escapeHtml(c.name[0].toUpperCase())}</div>
          <p class="card-title">${escapeHtml(c.name)}</p>
        </div>
        ${methods ? `<div class="contact-methods">${methods}</div>` : ''}
        <div class="card-actions">
          <button class="btn-secondary edit-contact" data-id="${c.id}">Edit</button>
          <button class="btn-secondary delete-contact" data-id="${c.id}">Delete</button>
        </div>
      </div>
    `;
    }).join('');

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
  function updateContactAvatarPreview() {
    const el = $('#contact-modal-avatar');
    const nameVal = ($('#contact-name-input').value || '').trim();
    if (nameVal) {
      el.textContent = nameVal[0].toUpperCase();
      el.classList.remove('avatar-empty');
    } else {
      el.innerHTML = ICONS.contact;
      el.classList.add('avatar-empty');
    }
  }

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
      form.address.value = c.address || '';
      form.notes.value = c.notes || '';
    } else {
      $('#contact-modal-title').textContent = 'New contact';
      form.id.value = '';
    }
    updateContactAvatarPreview();
    $('#contact-modal').hidden = false;
  }

  $('#contact-name-input').addEventListener('input', updateContactAvatarPreview);
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
            ${courierBadge(s.carrier)}
          </div>
          <div class="card-row" style="margin-top:8px; align-items:center; flex-wrap:wrap; gap:6px;">
            <span class="badge status-${s.status}">${escapeHtml(s.statusLabel || s.status)}</span>
            ${s.delayFlagged ? '<span class="badge badge-delay">Possible delay</span>' : ''}
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
    $('#scan-contact-block').hidden = true;
    $('#scan-status').hidden = true;
    $('#shipment-modal').hidden = false;
  });
  $('#shipment-cancel').addEventListener('click', () => { $('#shipment-modal').hidden = true; });
  $('#shipment-modal').addEventListener('click', (e) => { if (e.target.id === 'shipment-modal') $('#shipment-modal').hidden = true; });

  // ---------------- scan label (live camera + OCR/barcode) ----------------

  // Shared by both scan paths (live camera and the file-picker fallback):
  // drops whatever was found into the existing form fields as an editable
  // draft - never auto-saved, since OCR on a real label won't always be
  // perfect.
  function applyScanResult(result) {
    let appliedTracking = false;
    if (result.trackingNumber) {
      const trackingInput = $('#shipment-form input[name="trackingNumber"]');
      trackingInput.value = result.trackingNumber;
      // Fire the existing input listener below so carrier auto-detection
      // runs exactly as it does when someone types the number by hand.
      trackingInput.dispatchEvent(new Event('input', { bubbles: true }));
      appliedTracking = true;
    }
    if (result.recipientName) {
      $('#scan-contact-block').hidden = false;
      $('#scan-contact-name').textContent = result.recipientName;
      $('#scan-contact-name-input').value = result.recipientName;
      $('#scan-contact-address-input').value = result.address || '';
      $('#scan-save-contact').checked = true;
    }
    return appliedTracking;
  }

  function vibrate(pattern) {
    // No-op where unsupported (notably iOS Safari, which never shipped
    // the Vibration API) - the flash + status text below still confirm
    // the scan either way, so this is a bonus, not the only feedback.
    if (navigator.vibrate) { try { navigator.vibrate(pattern); } catch (err) { /* ignore */ } }
  }

  let liveScan = null; // { stop() } while the camera view is open

  async function closeScanCamera() {
    const view = $('#scan-camera-view');
    if (liveScan) { liveScan.stop(); liveScan = null; }
    const video = $('#scan-video');
    video.srcObject = null;
    view.hidden = true;
    view.classList.remove('scan-success');
  }

  async function openScanCamera() {
    const view = $('#scan-camera-view');
    const status = $('#scan-camera-status');
    const video = $('#scan-video');
    view.hidden = false;
    status.textContent = 'Starting camera…';

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      // No live-camera support at all (e.g. an older browser, or a non-
      // secure context) - fall back to the native camera/file picker
      // instead of dead-ending the feature.
      await closeScanCamera();
      $('#scan-label-input').click();
      return;
    }

    let ocrPassesDone = 0;
    let finished = false;
    const best = { trackingNumber: '', recipientName: '', address: '' };

    async function finishScan() {
      if (finished) return;
      finished = true;
      vibrate(80);
      view.classList.add('scan-success');
      status.textContent = '✓ Label detected';
      const flash = document.createElement('div');
      flash.className = 'scan-flash';
      view.appendChild(flash);
      applyScanResult(best);
      setTimeout(() => { flash.remove(); closeScanCamera(); }, 550);
    }

    try {
      liveScan = await LabelScanner.startLiveScan(video, {
        onResult(partial) {
          if (finished) return;
          if (partial.trackingNumber) best.trackingNumber = partial.trackingNumber;
          if (partial.recipientName) best.recipientName = partial.recipientName;
          if (partial.address) best.address = partial.address;
          if (partial.source === 'ocr') ocrPassesDone += 1;

          if (best.trackingNumber) {
            status.textContent = 'Tracking number found — reading the rest of the label…';
            // Stop as soon as we have a tracking number AND OCR has had at
            // least one real pass at the frame (so we don't close the
            // instant a barcode hits, before we've had any chance at the
            // recipient name/address too).
            if (ocrPassesDone >= 1) finishScan();
          } else if (ocrPassesDone >= 1) {
            status.textContent = 'Looking for a tracking number…';
          }
        },
        onError() { /* a single failed OCR pass isn't worth surfacing - it just tries again next interval */ },
      });
      if (!finished) status.textContent = 'Point the camera at the label';
    } catch (err) {
      // Camera permission denied, no camera present, insecure context, etc.
      status.textContent = 'Could not open the camera — using photo picker instead…';
      setTimeout(async () => {
        await closeScanCamera();
        $('#scan-label-input').click();
      }, 900);
    }
  }

  $('#scan-label-btn').addEventListener('click', openScanCamera);
  $('#scan-camera-close').addEventListener('click', closeScanCamera);
  $('#scan-camera-manual').addEventListener('click', closeScanCamera);

  $('#scan-label-input').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = ''; // allow scanning the same file again later
    if (!file) return;

    const status = $('#scan-status');
    status.hidden = false;
    status.textContent = 'Reading label… this can take a few seconds.';

    try {
      const result = await scanShippingLabel(file);
      const found = applyScanResult(result);
      status.textContent = found
        ? 'Tracking number detected — double-check it below.'
        : "Couldn't find a tracking number in that photo. Try a clearer shot, or enter it manually.";
    } catch (err) {
      status.textContent = "Couldn't read that photo: " + err.message;
    }
  });

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
      const wantsScannedContact = !$('#scan-contact-block').hidden && $('#scan-save-contact').checked;
      if (wantsScannedContact) {
        const name = $('#scan-contact-name-input').value.trim();
        if (name) {
          const contact = await api('/contacts', {
            method: 'POST',
            body: { name, address: $('#scan-contact-address-input').value.trim() },
          });
          fd.contactId = contact.id;
          await loadContacts();
        }
      }

      await api('/shipments', { method: 'POST', body: fd });
      $('#shipment-modal').hidden = true;
      e.target.reset();
      $('#scan-contact-block').hidden = true;
      $('#scan-status').hidden = true;
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

  // Gets (or creates) this shipment's public share link and hands it to
  // the native share sheet on mobile, or copies it to the clipboard
  // everywhere else. The link opens a read-only tracking page for anyone,
  // no account required - see the /s/:token handling near boot() below.
  async function shareShipment(id) {
    try {
      const { url } = await api(`/shipments/${id}/share`, { method: 'POST' });
      const fullUrl = location.origin + url;
      const s = state.shipments.find((x) => x.id === id);
      const shareData = {
        title: 'Track my shipment',
        text: `Track ${s ? (s.label || s.trackingNumber) : 'my shipment'} on Sputnik Ship`,
        url: fullUrl,
      };
      if (navigator.share) {
        await navigator.share(shareData).catch(() => {}); // user cancelling the share sheet isn't an error
      } else if (navigator.clipboard) {
        await navigator.clipboard.writeText(fullUrl);
        toast('Link copied to clipboard');
      } else {
        toast(fullUrl);
      }
    } catch (err) {
      toast('Could not create a share link: ' + err.message);
    }
  }

  function renderShipmentDetail() {
    const s = state.shipments.find((x) => x.id === state.currentShipmentId);
    if (!s) return;
    const contact = state.contacts.find((c) => c.id === s.contactId);

    $('#shipment-detail-body').innerHTML = `
      <div class="hero-top">
        <h2>${escapeHtml(s.label || s.trackingNumber)}</h2>
        ${courierBadge(s.carrier)}
      </div>
      <span class="badge status-${s.status}" style="margin-top:10px; display:inline-block;">${escapeHtml(s.statusLabel || s.status)}</span>
      <div class="data-strip">
        <div class="data-row data-eta">
          <small class="data-label">Estimated delivery</small>
          ${fmtDate(s.estimatedDelivery)}
        </div>
        <div class="data-row data-tracking">
          <small class="data-label">Tracking #</small>
          <span class="tn">${escapeHtml(s.trackingNumber)}</span>
        </div>
      </div>
      <p class="small muted" style="margin:8px 0 0;">Last checked: ${fmtDate(s.lastCheckedAt)}</p>
      ${contact ? `<p class="small" style="margin-top:10px; display:flex; align-items:center; gap:6px;">${ICONS.contact} ${escapeHtml(contact.name)}</p>` : ''}
      <div class="modal-actions" style="justify-content:flex-start; margin-top:14px;">
        <button class="btn-secondary small" id="share-shipment-btn">Share shipping</button>
        <button class="btn-secondary small" id="delete-shipment-btn">Delete shipment</button>
      </div>
    `;

    $('#share-shipment-btn').addEventListener('click', () => shareShipment(s.id));

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

  // containerSel/mapKey let this be reused for the read-only shared view
  // (its own #shared-map container, its own state.sharedMap instance) as
  // well as the normal logged-in shipment detail (#map / state.map).
  function renderMap(shipment, containerSel = '#map', mapKey = 'map') {
    const container = $(containerSel);
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

    if (state[mapKey]) {
      state[mapKey].remove();
      state[mapKey] = null;
    }

    const map = L.map(container, { zoomControl: true, attributionControl: true });
    state[mapKey] = map;
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18,
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(map);

    const latlngs = route.map((p) => [p.lat, p.lng]);
    const doneIndex = shipment.checkpointIndex ?? -1;

    L.polyline(latlngs, { color: '#3a3a38', weight: 3, dashArray: '6 6' }).addTo(map);
    if (doneIndex >= 0) {
      L.polyline(latlngs.slice(0, doneIndex + 1), { color: '#c6f135', weight: 4 }).addTo(map);
    }

    route.forEach((p, i) => {
      const isDone = i <= doneIndex;
      const marker = L.circleMarker([p.lat, p.lng], {
        radius: i === doneIndex ? 9 : 6,
        color: isDone ? '#c6f135' : '#3a3a38',
        fillColor: isDone ? '#c6f135' : '#232323',
        fillOpacity: 1,
        weight: 2,
      }).addTo(map);
      marker.bindPopup(`<b>${escapeHtml(p.label)}</b>`);
    });

    const bounds = L.latLngBounds(latlngs);
    map.fitBounds(bounds, { padding: [30, 30] });
  }

  function renderCheckpoints(shipment, containerSel = '#checkpoints-list') {
    const list = $(containerSel);
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

  // ---------------- shared shipment view (public, no account needed) ----------------
  // sputnikship.app/s/<token>: a read-only tracking page anyone can open,
  // with an inline sign-up/log-in so a new user never has to leave the
  // page to end up looking at the exact shipment they were sent.
  async function renderSharedShipment(token) {
    $('#auth-screen').hidden = true;
    $('#app').hidden = true;
    $('#shared-view').hidden = false;
    $('#shared-body').innerHTML = '<p class="empty">Loading shipment…</p>';
    $('#shared-checkpoints').innerHTML = '';
    $('#shared-map').hidden = true;

    try {
      const res = await fetch(`${API}/public/shipments/${token}`);
      const s = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(s.error || 'This share link is no longer valid.');

      $('#shared-body').innerHTML = `
        <div class="shipment-hero">
          <div class="hero-top">
            <h2>${escapeHtml(s.label || s.trackingNumber)}</h2>
            ${courierBadge(s.carrier)}
          </div>
          <span class="badge status-${s.status}" style="margin-top:10px; display:inline-block;">${escapeHtml(s.statusLabel || s.status)}</span>
          <div class="data-strip">
            <div class="data-row data-eta">
              <small class="data-label">Estimated delivery</small>
              ${fmtDate(s.estimatedDelivery)}
            </div>
            <div class="data-row data-tracking">
              <small class="data-label">Tracking #</small>
              <span class="tn">${escapeHtml(s.trackingNumber)}</span>
            </div>
          </div>
          <p class="small muted" style="margin:8px 0 0;">Last checked: ${fmtDate(s.lastCheckedAt)}</p>
        </div>
      `;
      $('#shared-map').hidden = false;
      try {
        renderMap(s, '#shared-map', 'sharedMap');
      } catch (err) {
        $('#shared-map').innerHTML = '<div class="empty" style="padding:20px;">Could not load the map.</div>';
      }
      renderCheckpoints(s, '#shared-checkpoints');
    } catch (err) {
      $('#shared-body').innerHTML = `<div class="empty">${escapeHtml(err.message)}</div>`;
    }

    renderSharedCta();
  }

  function renderSharedCta() {
    const cta = $('#shared-cta');

    if (state.token && state.user) {
      cta.innerHTML = `
        <div class="auth-card shared-auth-card">
          <p class="small muted" style="margin:0 0 14px;">Logged in as @${escapeHtml(state.user.handle)}</p>
          <a href="/" class="btn-primary" style="display:block; text-align:center; text-decoration:none;">Go to my shipments</a>
        </div>
      `;
      return;
    }

    cta.innerHTML = `
      <div class="auth-card shared-auth-card">
        <p class="small muted" style="margin:0 0 14px;">Create a free account to track your own shipments.</p>
        <div class="tabs">
          <button type="button" class="tab active" data-tab="login">Log in</button>
          <button type="button" class="tab" data-tab="signup">Sign up</button>
        </div>
        <form id="shared-login-form" class="auth-form">
          <label>Username
            <div class="handle-input"><span>@</span><input type="text" name="handle" required autocomplete="username" pattern="[a-zA-Z0-9_]{3,20}" placeholder="yourusername" /></div>
          </label>
          <label>Password<input type="password" name="password" required autocomplete="current-password" /></label>
          <button type="submit" class="btn-primary">Log in</button>
          <p class="error" id="shared-login-error" hidden></p>
        </form>
        <form id="shared-signup-form" class="auth-form" hidden>
          <label>Username
            <div class="handle-input"><span>@</span><input type="text" name="handle" required autocomplete="username" pattern="[a-zA-Z0-9_]{3,20}" placeholder="yourusername" /></div>
          </label>
          <label>Password<input type="password" name="password" required minlength="6" autocomplete="new-password" /></label>
          <button type="submit" class="btn-primary">Create account</button>
          <p class="error" id="shared-signup-error" hidden></p>
        </form>
      </div>
    `;

    $all('.tab', cta).forEach((tab) => {
      tab.addEventListener('click', () => {
        $all('.tab', cta).forEach((t) => t.classList.remove('active'));
        tab.classList.add('active');
        const isLogin = tab.dataset.tab === 'login';
        $('#shared-login-form').hidden = !isLogin;
        $('#shared-signup-form').hidden = isLogin;
      });
    });

    $('#shared-login-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const errEl = $('#shared-login-error');
      errEl.hidden = true;
      try {
        const data = await api('/auth/login', { method: 'POST', body: Object.fromEntries(fd) });
        saveSession(data.token, data.user);
        toast(`Welcome back, @${data.user.handle}`);
        renderSharedCta(); // stays on this same page, now signed in
      } catch (err) {
        errEl.textContent = err.message;
        errEl.hidden = false;
      }
    });

    $('#shared-signup-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const errEl = $('#shared-signup-error');
      errEl.hidden = true;
      try {
        const data = await api('/auth/signup', { method: 'POST', body: Object.fromEntries(fd) });
        saveSession(data.token, data.user);
        toast(`Welcome, @${data.user.handle}`);
        renderSharedCta();
      } catch (err) {
        errEl.textContent = err.message;
        errEl.hidden = false;
      }
    });
  }

  // ---------------- account ----------------
  $('#topbar-avatar').addEventListener('click', openAccountView);
  $('#greeting-avatar').addEventListener('click', openAccountView);
  $('#back-from-account').addEventListener('click', () => showView('shipments'));
  $('#account-logout-btn').addEventListener('click', logout);

  function openAccountView() {
    showView('account');
    const initial = state.user?.handle ? state.user.handle[0].toUpperCase() : '?';
    $('#account-handle').textContent = state.user?.handle ? `@${state.user.handle}` : '@';
    $('#account-avatar').textContent = initial;
    renderCoOwners();
  }

  async function renderCoOwners() {
    try {
      const { coOwners } = await api('/account/co-owners');
      const list = $('#co-owners-list');
      list.innerHTML = coOwners.map((c) => `
        <span class="co-owner-chip">
          <span class="avatar">${escapeHtml(c.handle[0].toUpperCase())}</span>
          @${escapeHtml(c.handle)}
        </span>
      `).join('');
      $('#leave-space-btn').hidden = coOwners.length === 0;
      $('#account-space-hint').textContent = coOwners.length
        ? 'Everyone listed here sees and manages the exact same shipments and contacts as you.'
        : '';
    } catch (err) {
      toast(err.message);
    }
  }

  // ---- change password ----
  $('#change-password-btn').addEventListener('click', () => {
    $('#change-password-form').reset();
    $('#change-password-error').hidden = true;
    $('#change-password-modal').hidden = false;
  });
  $('#change-password-cancel').addEventListener('click', () => { $('#change-password-modal').hidden = true; });
  $('#change-password-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target));
    const errEl = $('#change-password-error');
    errEl.hidden = true;
    try {
      await api('/auth/change-password', { method: 'POST', body: fd });
      $('#change-password-modal').hidden = true;
      toast('Password changed');
    } catch (err) {
      errEl.textContent = err.message;
      errEl.hidden = false;
    }
  });

  // ---- regenerate recovery code ----
  $('#regen-recovery-btn').addEventListener('click', () => {
    $('#regen-recovery-form').reset();
    $('#regen-recovery-error').hidden = true;
    $('#regen-recovery-modal').hidden = false;
  });
  $('#regen-recovery-cancel').addEventListener('click', () => { $('#regen-recovery-modal').hidden = true; });
  $('#regen-recovery-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target));
    const errEl = $('#regen-recovery-error');
    errEl.hidden = true;
    try {
      const data = await api('/auth/regenerate-recovery-code', { method: 'POST', body: fd });
      $('#regen-recovery-modal').hidden = true;
      showRecoveryCode(data.recoveryCode);
    } catch (err) {
      errEl.textContent = err.message;
      errEl.hidden = false;
    }
  });

  // ---- invite / join / leave a shared space ----
  $('#invite-btn').addEventListener('click', async () => {
    try {
      const { code } = await api('/account/invite', { method: 'POST' });
      $('#invite-code-display').textContent = code;
      $('#invite-code-modal').hidden = false;
      $('#invite-code-copy-btn').onclick = async () => {
        try {
          await navigator.clipboard.writeText(code);
          toast('Invite code copied');
        } catch (err) {
          toast('Could not copy — select and copy it manually');
        }
      };
    } catch (err) {
      toast(err.message);
    }
  });
  $('#invite-code-close-btn').addEventListener('click', () => { $('#invite-code-modal').hidden = true; });

  $('#join-space-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target));
    try {
      await api('/account/join', { method: 'POST', body: fd });
      e.target.reset();
      toast('Joined! You now share shipments and contacts.');
      await renderCoOwners();
      await loadAll();
    } catch (err) {
      toast(err.message);
    }
  });

  $('#leave-space-btn').addEventListener('click', async () => {
    if (!confirm('Leave this shared space? You’ll only see your own shipments and contacts afterward.')) return;
    try {
      await api('/account/leave-space', { method: 'POST' });
      toast('Left the shared space');
      await renderCoOwners();
      await loadAll();
    } catch (err) {
      toast(err.message);
    }
  });

  // ---------------- passport (shipping stats) ----------------
  let passportPeriod = 'all';

  $('#open-passport-btn').addEventListener('click', () => {
    passportPeriod = 'all';
    showView('passport');
    loadPassport();
  });
  $('#back-from-passport').addEventListener('click', () => showView('account'));

  async function loadPassport() {
    try {
      const stats = await api(`/stats/passport?year=${passportPeriod}`);
      renderPassportPeriodTabs(stats.years);
      renderPassportStats(stats);
    } catch (err) {
      toast(err.message);
    }
  }

  function renderPassportPeriodTabs(years) {
    const container = $('#passport-period');
    const options = [{ value: 'all', label: 'All time' }, ...years.map((y) => ({ value: String(y), label: String(y) }))];
    container.innerHTML = options.map((o) => `
      <button type="button" class="tab ${passportPeriod === o.value ? 'active' : ''}" data-period="${o.value}">${o.label}</button>
    `).join('');
    $all('.tab', container).forEach((btn) => {
      btn.addEventListener('click', () => {
        passportPeriod = btn.dataset.period;
        loadPassport();
      });
    });
  }

  function renderPassportStats(stats) {
    $('#pp-total').textContent = stats.totalShipments;
    $('#pp-delivered').textContent = stats.delivered;
    $('#pp-contacts').textContent = stats.contactsShippedTo;
    $('#pp-avg').textContent = stats.avgDeliveryDays != null ? `${stats.avgDeliveryDays.toFixed(1)}d` : '—';
    if (stats.fastest) {
      $('#pp-fastest').textContent = `${stats.fastest.days.toFixed(1)}d`;
      $('#pp-fastest-label').textContent = `Fastest · ${CARRIER_LABEL[stats.fastest.carrier] || stats.fastest.carrier}`;
    } else {
      $('#pp-fastest').textContent = '—';
      $('#pp-fastest-label').textContent = 'Fastest delivery';
    }

    const maxCount = Math.max(1, ...stats.couriers.map((c) => c.count));
    $('#pp-couriers').innerHTML = stats.couriers.map((c) => {
      const brand = COURIER_BADGE[c.carrier];
      const bg = brand ? brand.color : 'var(--surface-2)';
      const fg = brand ? brand.iconColor : 'var(--muted)';
      return `
        <div class="pp-courier-row">
          <div class="pp-courier-badge" style="background:${bg}; color:${fg};">${escapeHtml(c.label.slice(0, 3).toUpperCase())}</div>
          <div class="pp-courier-name">${escapeHtml(c.label)}</div>
          <div class="pp-courier-bar-track"><div class="pp-courier-bar-fill" style="width:${(c.count / maxCount) * 100}%;"></div></div>
          <div class="pp-courier-count">${c.count}</div>
        </div>
      `;
    }).join('') || '<p class="empty" style="padding:20px;">No shipments in this period yet.</p>';

    $('#pp-milestone').textContent = stats.firstShipmentDate
      ? `First shipment logged ${fmtDate(stats.firstShipmentDate)}`
      : 'Add your first shipment to start your passport.';
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
  const sharedMatch = location.pathname.match(/^\/s\/([A-Za-z0-9_-]+)$/);
  if (sharedMatch) {
    renderSharedShipment(sharedMatch[1]);
  } else if (state.token && state.user) {
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
