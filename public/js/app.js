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
    // The session itself travels in an httpOnly cookie the browser attaches
    // automatically to this same-origin request - nothing here can read or
    // resend it, which is the point (see routes/auth.js for why).
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

  // Wraps a form's submit handler so the submit button is disabled (and
  // shows a busy label) for the whole duration of an in-flight request,
  // re-enabled whether it succeeds or fails. Without this, tapping "Save"
  // twice on a slow connection - the request is still running, nothing on
  // screen says so - fires the submit twice and creates duplicates (this
  // is a real bug users hit, not a hypothetical).
  function guardSubmit(form, handler) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = form.querySelector('button[type="submit"]');
      if (btn && btn.disabled) return; // a request from the previous tap is still running
      const originalText = btn ? btn.textContent : null;
      if (btn) { btn.disabled = true; btn.textContent = 'Please wait…'; }
      try {
        await handler(e);
      } finally {
        if (btn) { btn.disabled = false; btn.textContent = originalText; }
      }
    });
  }

  // Same idea for a plain action button (not a form submit) - Archive,
  // Delete, Follow, etc. - that fires a network request on click.
  function guardClick(button, handler) {
    button.addEventListener('click', async (...args) => {
      if (button.disabled) return;
      const originalText = button.textContent;
      button.disabled = true;
      try {
        await handler(...args);
      } finally {
        button.disabled = false;
        if (document.body.contains(button)) button.textContent = originalText;
      }
    });
  }

  const CARRIER_LABEL = { fedex: 'FedEx', ups: 'UPS', dhl: 'DHL', usps: 'USPS', air_cargo: 'Air Cargo (AWB)', ocean_cargo: 'Ocean Cargo (MBL)' };

  // Kept in sync by hand with CATEGORIES in routes/shipments.js.
  const CATEGORIES = [
    { value: 'electronics', label: 'Electronics', icon: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="7" y="7" width="10" height="10" rx="1.5"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/></svg>' },
    { value: 'documents', label: 'Documents', icon: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h9l4 4v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z"/><path d="M14 3v5h5M8 12h8M8 16h5"/></svg>' },
    { value: 'gifts', label: 'Gifts', icon: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="9" width="18" height="12" rx="1"/><path d="M3 9V6a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v3M12 5v16M12 5C10 5 8 3.8 8 2.3 8 1.6 8.6 1 9.4 1 11 1 12 3 12 5ZM12 5c2 0 4-1.2 4-2.7C16 1.6 15.4 1 14.6 1 13 1 12 3 12 5Z"/></svg>' },
    { value: 'clothing', label: 'Clothing', icon: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M8 4 4 7l2 3 2-1.3V21h8V8.7L18 10l2-3-4-3-2 1.5h-4L8 4Z"/></svg>' },
    { value: 'food', label: 'Food', icon: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2v8a2 2 0 0 0 4 0V2M8 10v12M18 2c-2 1-3 3-3 6s1 3 2 3v11"/></svg>' },
    { value: 'other', label: 'Other', icon: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8l9-5 9 5-9 5-9-5Z"/><path d="M3 8v8l9 5 9-5V8M12 13v8"/></svg>' },
  ];
  const CATEGORY_ICON = Object.fromEntries(CATEGORIES.map((c) => [c.value, c.icon]));

  // Thin-stroke icons (matches the rest of the app's icon language) used
  // inside JS-rendered templates - static markup in index.html has its
  // own inline copies of the same style.
  const ICONS = {
    contact: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="12" r="2"/><path d="M14 10h4M14 14h4M6.3 16.8c.5-1.7 1.8-2.4 2.7-2.4s2.2.7 2.7 2.4"/></svg>',
    phone: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 4h3l1.5 4-2 1.5a11 11 0 0 0 5.5 5.5l1.5-2 4 1.5v3a2 2 0 0 1-2.2 2A17 17 0 0 1 3 5.2 2 2 0 0 1 5 4Z"/></svg>',
    email: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m4 7 8 6 8-6"/></svg>',
    chat: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5h16v11H8l-4 4V5Z"/></svg>',
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
    // Not a real airline brand mark on purpose - AWB/air cargo covers many
    // different carriers (identified by the AWB's own 3-digit prefix), so
    // this uses a generic plane glyph in the app's own accent color instead
    // of pretending to be one specific airline.
    air_cargo: {
      color: '#5e6ad2',
      iconColor: '#fff',
      path: 'M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2.5 1.8V22l3.5-1 3.5 1v-1.2L13 19v-5.5l8 2.5z',
    },
    // Same idea as air_cargo: no single shipping line fits ocean freight,
    // so this uses a generic container glyph in a teal accent instead of
    // one carrier's brand.
    ocean_cargo: {
      color: '#1f8a6f',
      iconColor: '#fff',
      path: 'M3 16h18l-2 4H5l-2-4zm2-2V8a1 1 0 0 1 1-1h3V4h6v3h3a1 1 0 0 1 1 1v6H5zm3-6v4h2V8H8zm5 0v4h2V8h-2z',
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
    // AWB (air cargo): 3-digit IATA airline prefix + hyphen + 8-digit
    // serial (e.g. "020-12345675"). Checked before the plain-digit DHL/
    // FedEx patterns since those would otherwise collide with an
    // un-hyphenated AWB - requiring the hyphen keeps auto-detection
    // unambiguous; without one, pick "Air Cargo (AWB)" by hand.
    if (/^\d{3}-\d{8}$/.test(t)) return 'air_cargo';
    // ISO 6346 container number: 3-letter owner code + category id
    // (U/J/Z) + 6-digit serial + check digit (e.g. "MSCU1234567"). MBL
    // numbers themselves vary too much per shipping line to pattern-match
    // reliably, so detection goes by the container number instead - pick
    // "Ocean Cargo (MBL)" by hand when only the MBL number is on hand.
    if (/^[A-Z]{3}[UJZ]\d{7}$/.test(t)) return 'ocean_cargo';
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

  async function showApp() {
    $('#auth-screen').hidden = true;
    $('#app').hidden = false;
    await loadAll();
    initPush();
    // A "follow this shipment" redirect from the public /s/:token page
    // (see renderSharedCta) lands here with ?openShipment=<id> - open it
    // straight away instead of leaving the user to find it themselves.
    const params = new URLSearchParams(location.search);
    const openId = params.get('openShipment');
    if (openId) {
      history.replaceState({}, '', '/');
      openShipmentDetail(openId);
    }
  }

  // The real token lives only in the httpOnly cookie the server just set
  // (see routes/auth.js) - this app never stores or reads the actual
  // secret. `state.token` is just a "there's an active session" marker so
  // the UI can decide what to show on boot without a network round-trip.
  function saveSession(token, user) {
    state.token = true;
    state.user = user;
    localStorage.setItem('sputnikship_token', '1');
    localStorage.setItem('sputnikship_user', JSON.stringify(user));
  }

  async function logout() {
    state.token = null;
    state.user = null;
    localStorage.removeItem('sputnikship_token');
    localStorage.removeItem('sputnikship_user');
    try {
      await fetch(API + '/auth/logout', { method: 'POST' });
    } catch (err) {
      // Best-effort - the local session is already cleared either way.
    }
    showAuth();
  }

  guardSubmit($('#login-form'), async (e) => {
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

  guardSubmit($('#signup-form'), async (e) => {
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

  guardSubmit($('#recovery-form'), async (e) => {
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
    if (name !== 'shipment-detail') stopChatPolling();
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
    const items = state.contacts.filter((c) => !q || c.name.toLowerCase().includes(q));

    if (!items.length) {
      list.innerHTML = `<div class="empty">You haven't added any contacts yet.<br>Tap "+ New contact" to get started.</div>`;
      return;
    }

    list.innerHTML = items.map((c) => {
      const methods = [
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
      guardClick(btn, async (e) => {
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

  guardSubmit($('#contact-form'), async (e) => {
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

    const active = state.shipments.filter((s) => s.status !== 'delivered' && !s.archived && s.viewerRole !== 'follower').length;
    $('#active-shipments-count').textContent = active;
    $('#greeting-sub').textContent = active
      ? `You have ${active} shipment${active === 1 ? '' : 's'} on the way.`
      : 'No shipments on the way right now.';
  }

  // ---------------- render: shipments ----------------
  // How far along the journey a shipment is, for the thin progress track
  // under each card (same five stops as the status timeline).
  const STATUS_PROGRESS = { pending: 6, info_received: 6, label_created: 10, picked_up: 32, in_transit: 58, out_for_delivery: 86, available_for_pickup: 86, delivered: 100, exception: 58, failed_attempt: 86 };
  function statusProgress(s) { return STATUS_PROGRESS[s.status] != null ? STATUS_PROGRESS[s.status] : 6; }

  // ---------------- inbox (home) ----------------
  // "Seen" is per device on purpose: it's a reading cursor, not data the
  // server needs, and keeping it in localStorage means no API/data-shape
  // change for the inbox. Unread = messages from someone else newer than
  // the last time this device opened the thread.
  const SEEN_KEY = 'sputnikship_seen';
  function readSeen() { try { return JSON.parse(localStorage.getItem(SEEN_KEY) || '{}'); } catch { return {}; } }
  function markSeen(shipmentId) {
    try { const m = readSeen(); m[shipmentId] = new Date().toISOString(); localStorage.setItem(SEEN_KEY, JSON.stringify(m)); } catch { /* private mode etc. */ }
  }
  function unreadCount(s, seen) {
    // Courier (system) messages count too - the courier is a participant.
    // A thread this device has never opened only counts the last 48h, so
    // an old inbox doesn't light up entirely the first time it's seen.
    const since = seen[s.id] ? new Date(seen[s.id]) : new Date(Date.now() - 48 * 3600 * 1000);
    return (s.messages || []).filter((m) => m.userId !== state.user?.id && new Date(m.createdAt) > since).length;
  }
  function isToday(iso) {
    if (!iso) return false;
    const d = new Date(iso), n = new Date();
    return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
  }
  // What the second line of a row says: the newest message if there is
  // one (a human line in muted text, a courier line in the status colour),
  // otherwise the shipment's own status.
  function lastLine(s) {
    const msgs = s.messages || [];
    const m = msgs[msgs.length - 1];
    const cls = s.delayFlagged ? 'warn' : s.status === 'delivered' ? 'ok' : s.status === 'exception' || s.status === 'failed_attempt' ? 'danger' : s.status === 'out_for_delivery' ? 'vio' : 'acc';
    if (m && m.type !== 'system') {
      const who = m.userId === state.user?.id ? 'you' : '@' + escapeHtml(m.handle || '');
      const body = m.photo ? (m.text ? escapeHtml(m.text) : 'Photo') : escapeHtml(m.text || '');
      return { html: `${who}: ${body}`, cls: 'human', at: m.createdAt };
    }
    if (m && m.type === 'system') {
      return { html: escapeHtml(m.text), cls: 'sys ' + cls, at: m.createdAt };
    }
    const loc = s.currentLocation?.label ? ' · ' + escapeHtml(String(s.currentLocation.label).split(':').pop().trim()) : '';
    return { html: escapeHtml(s.statusLabel || s.status || 'Label created') + loc, cls: 'sys ' + cls, at: s.lastCheckedAt || s.createdAt };
  }
  const COURIER_CHIP = { fedex: 'FDX', ups: 'UPS', dhl: 'DHL', usps: 'USPS', air_cargo: 'AWB', ocean_cargo: 'MBL' };
  function dotClass(s) {
    if (s.delayFlagged) return 'warn';
    if (s.status === 'delivered') return 'ok';
    if (s.status === 'exception' || s.status === 'failed_attempt') return 'danger';
    if (s.status === 'out_for_delivery' || s.status === 'available_for_pickup') return 'vio';
    return 'acc';
  }
  function inboxRow(s, seen) {
    const isFollower = s.viewerRole === 'follower';
    const line = lastLine(s);
    const unread = unreadCount(s, seen);
    const contact = state.contacts.find((c) => c.id === s.contactId);
    const title = s.label || s.trackingNumber;
    const sub = isFollower ? 'Following' : contact ? contact.name : '';
    return `
      <div class="ibx-row status-${s.status || 'pending'} ${s.status === 'delivered' && !unread ? 'done' : ''} ${unread ? 'unread' : ''}" data-id="${s.id}" role="button" tabindex="0">
        <div class="ibx-pk">
          <span class="ibx-chip c-${s.carrier}">${COURIER_CHIP[s.carrier] || escapeHtml(String(s.carrier).toUpperCase())}</span>
          ${isFollower ? ICONS.chat : (CATEGORY_ICON[s.category] || CATEGORY_ICON.other)}
          <i class="ibx-dot ${dotClass(s)}"></i>
        </div>
        <div class="ibx-body">
          <div class="ibx-l1">
            <b>${escapeHtml(title)}${sub ? ` <span class="ibx-sub">· ${escapeHtml(sub)}</span>` : ''}</b>
            <time>${fmtShort(line.at)}</time>
          </div>
          <div class="ibx-l2">
            <span class="ibx-last ${line.cls}">${line.html}</span>
            ${unread ? `<span class="ibx-un ${s.status === 'delivered' ? 'ok' : ''}">${unread > 9 ? '9+' : unread}</span>` : s.archived ? '<span class="ibx-tag">Archived</span>' : ''}
          </div>
        </div>
      </div>`;
  }

  function renderShipments() {
    renderGreeting();
    const list = $('#shipments-list');
    const q = ($('#shipment-search').value || '').toLowerCase();
    const seen = readSeen();
    const byFilter = state.shipments.filter((s) => {
      if (shipmentFilter === 'following') return s.viewerRole === 'follower';
      if (shipmentFilter === 'archived') return s.archived;
      if (s.archived) return false; // archived threads only show under "Archived"
      if (shipmentFilter === 'delayed') return s.delayFlagged;
      if (shipmentFilter === 'all') return true;
      return true; // 'active' = the inbox: everything not archived, grouped below
    });
    const items = byFilter.filter((s) =>
      !q || s.trackingNumber.toLowerCase().includes(q) || (s.label || '').toLowerCase().includes(q)
    );

    if (!state.shipments.length) {
      list.innerHTML = `<div class="empty">Your inbox is empty.<br>Paste a tracking number above, or tap "New", and the package becomes a thread here.</div>`;
      return;
    }
    if (!items.length) {
      list.innerHTML = q
        ? `<div class="empty">No thread matches "${escapeHtml(q)}".</div>`
        : `<div class="empty">Nothing here.</div>`;
      return;
    }

    // Newest activity first inside each group - the last message if any,
    // else the last courier check.
    const activity = (s) => new Date(lastLine(s).at || s.createdAt).getTime();
    const sorted = [...items].sort((a, b) => activity(b) - activity(a));

    let html;
    if (shipmentFilter === 'active') {
      const today = sorted.filter((s) => s.status !== 'delivered' && (s.status === 'out_for_delivery' || s.status === 'available_for_pickup' || isToday(s.estimatedDelivery)));
      const transit = sorted.filter((s) => s.status !== 'delivered' && !today.includes(s));
      const delivered = sorted.filter((s) => s.status === 'delivered');
      const group = (k, rows, note) => rows.length ? `
        <div class="ibx-sec"><span>${k}</span>${note ? `<em>${note}</em>` : ''}</div>
        ${rows.map((s) => inboxRow(s, seen)).join('')}` : '';
      const ofd = today.filter((s) => s.status === 'out_for_delivery' || s.status === 'available_for_pickup').length;
      html = group('Today', today, ofd ? `${ofd} out for delivery` : '') + group('In transit', transit) + group('Delivered', delivered);
    } else {
      html = sorted.map((s) => inboxRow(s, seen)).join('');
    }
    list.innerHTML = html;

    $all('.ibx-row', list).forEach((row) => {
      row.addEventListener('click', () => openShipmentDetail(row.dataset.id));
      row.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openShipmentDetail(row.dataset.id); } });
    });
  }

  $('#shipment-search').addEventListener('input', renderShipments);

  // ---------------- shipment filter tabs ----------------
  let shipmentFilter = 'active';
  $all('#shipment-filter-tabs .tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      shipmentFilter = tab.dataset.filter;
      $all('#shipment-filter-tabs .tab').forEach((t) => t.classList.toggle('active', t === tab));
      renderShipments();
    });
  });

  // ---------------- category chips (new shipment form) ----------------
  function renderCategoryChips() {
    const container = $('#category-chips');
    container.innerHTML = CATEGORIES.map((c) =>
      `<button type="button" class="category-chip" data-value="${c.value}">${c.icon}${c.label}</button>`
    ).join('');
    $all('.category-chip', container).forEach((chip) =>
      chip.addEventListener('click', () => setActiveCategory(chip.dataset.value))
    );
  }
  function setActiveCategory(value) {
    $('#shipment-category-input').value = value;
    $all('.category-chip', $('#category-chips')).forEach((chip) =>
      chip.classList.toggle('active', chip.dataset.value === value)
    );
  }
  renderCategoryChips();

  // ---------------- photo attachment (new shipment form) ----------------
  function resetPhotoPicker() {
    $('#shipment-photo-input').value = '';
    $('#shipment-photo-file').value = '';
    $('#shipment-photo-preview').hidden = true;
    $('#shipment-photo-preview-img').src = '';
  }

  // Resizes/compresses client-side before storing as base64 in the shipment
  // document (Postgres jsonb) - keeps the document small since there's no
  // separate file storage set up.
  function compressImage(file, maxDim = 900, quality = 0.75) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          const scale = maxDim / Math.max(width, height);
          width = Math.round(width * scale);
          height = Math.round(height * scale);
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
        URL.revokeObjectURL(img.src);
      };
      img.onerror = () => reject(new Error('Could not read that image.'));
      img.src = URL.createObjectURL(file);
    });
  }

  $('#shipment-photo-btn').addEventListener('click', () => $('#shipment-photo-file').click());
  $('#shipment-photo-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const dataUrl = await compressImage(file);
      $('#shipment-photo-input').value = dataUrl;
      $('#shipment-photo-preview-img').src = dataUrl;
      $('#shipment-photo-preview').hidden = false;
    } catch (err) {
      toast(err.message);
    }
  });
  $('#shipment-photo-remove').addEventListener('click', resetPhotoPicker);

  // Same client-side compress+strip as the shipment's own photo above -
  // re-encoding through a canvas drops all EXIF (GPS, device model) before
  // the image leaves the browser; the server strips again on save
  // (services/imageMeta.js) so it never relies on the client having done it.
  function resetChatPhotoPicker() {
    $('#chat-photo-input').value = '';
    $('#chat-photo-file').value = '';
    $('#chat-photo-preview').hidden = true;
  }
  $('#chat-photo-btn').addEventListener('click', () => $('#chat-photo-file').click());
  $('#chat-photo-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const dataUrl = await compressImage(file);
      $('#chat-photo-input').value = dataUrl;
      $('#chat-photo-preview-img').src = dataUrl;
      $('#chat-photo-preview').hidden = false;
    } catch (err) {
      toast(err.message);
    }
  });
  $('#chat-photo-remove').addEventListener('click', resetChatPhotoPicker);

  // ---------------- paste-and-go ----------------
  // On opening a blank "New shipment" form, silently checks the clipboard
  // for something that already looks like a tracking number and pre-fills
  // it - a no-op if the browser denies clipboard access or there's no
  // match, never blocking the form.
  async function tryPasteAndGo() {
    if (!navigator.clipboard || !navigator.clipboard.readText) return;
    try {
      const text = (await navigator.clipboard.readText() || '').trim();
      const carrier = detectCarrier(text);
      if (!carrier) return;
      const input = $('#shipment-form input[name="trackingNumber"]');
      input.value = text.replace(/\s+/g, '');
      $('#shipment-form select[name="carrier"]').value = carrier;
      $('#carrier-detect-hint').textContent = `Detected from clipboard: ${CARRIER_LABEL[carrier]}`;
    } catch (err) {
      // Clipboard permission denied or unavailable - fine, just skip it.
    }
  }

  $('#add-shipment-btn').addEventListener('click', () => {
    renderShipmentContactOptions();
    $('#shipment-form').reset();
    $('#carrier-detect-hint').textContent = '';
    $('#scan-contact-block').hidden = true;
    $('#scan-status').hidden = true;
    setActiveCategory('other');
    resetPhotoPicker();
    $('#shipment-modal').hidden = false;
    tryPasteAndGo();
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

  guardSubmit($('#shipment-form'), async (e) => {
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

  guardClick($('#refresh-now-btn'), async () => {
    const btn = $('#refresh-now-btn');
    btn.classList.add('spinning');
    try {
      await api('/shipments/refresh-all/now', { method: 'POST' });
      await loadShipments();
      await loadNotifications();
      toast('Shipments updated');
    } catch (err) {
      toast(err.message);
    } finally {
      btn.classList.remove('spinning');
    }
  });

  // ---------------- calendar ----------------
  // One week at a time (Monday-first), the selected day's shipments listed
  // underneath. Opens on today's week with today selected.
  function startOfWeek(d) {
    const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
    return x;
  }
  let calendarCursor = startOfWeek(new Date());
  let calendarSelectedDay = dateKey(new Date()); // 'YYYY-MM-DD'

  function dateKey(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function renderCalendar() {
    const todayKey = dateKey(new Date());
    const byDay = {};
    for (const s of state.shipments) {
      if (s.archived) continue;
      if (s.estimatedDelivery) {
        const key = dateKey(new Date(s.estimatedDelivery));
        byDay[key] ||= { delay: false, items: [] };
        if (s.delayFlagged) byDay[key].delay = true;
        byDay[key].items.push(s);
      }
      // "Out for delivery" means the courier has it today, regardless of
      // what the estimated-delivery date says (or if there even is one) -
      // always surface it under today so it isn't missed.
      if (s.status === 'out_for_delivery') {
        byDay[todayKey] ||= { delay: false, items: [] };
        if (!byDay[todayKey].items.some((x) => x.id === s.id)) {
          byDay[todayKey].items.push(s);
        }
      }
    }

    const days = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(calendarCursor);
      d.setDate(calendarCursor.getDate() + i);
      days.push(d);
    }
    const selected = new Date(calendarSelectedDay + 'T00:00:00');
    $('#calendar-month-label').textContent = selected.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    $('#calendar-today-label').textContent = `${calendarSelectedDay === todayKey ? 'Today' : 'Selected'} · ${selected.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric' })}`;

    $('#calendar-grid').innerHTML = days.map((d) => {
      const key = dateKey(d);
      const info = byDay[key];
      const classes = ['day'];
      if (info) classes.push('has');
      if (info && info.delay) classes.push('delay');
      if (key === todayKey) classes.push('today');
      if (key === calendarSelectedDay) classes.push('selected');
      const letter = d.toLocaleDateString('en-US', { weekday: 'narrow' });
      return `<button type="button" class="${classes.join(' ')}" data-date="${key}">${letter}<b>${d.getDate()}</b></button>`;
    }).join('');

    $all('.day[data-date]').forEach((cell) => {
      cell.addEventListener('click', () => {
        calendarSelectedDay = cell.dataset.date;
        renderCalendar();
      });
    });

    const outToday = state.shipments.filter((s) => !s.archived && s.status === 'out_for_delivery').length;
    $('#calendar-alert').hidden = outToday === 0;
    $('#calendar-alert-text').textContent = `${outToday} package${outToday === 1 ? '' : 's'} out for delivery today`;

    renderCalendarDayList(byDay);
  }

  const CARRIER_CODE = { fedex: 'FDX', ups: 'UPS', dhl: 'DHL', usps: 'USPS' };

  function renderCalendarDayList(byDay) {
    const list = $('#calendar-day-list');
    const info = byDay[calendarSelectedDay];
    if (!info || !info.items.length) {
      list.innerHTML = '<div class="empty">No shipments expected this day.</div>';
      return;
    }
    list.innerHTML = info.items.map((s) => {
      const contact = state.contacts.find((c) => c.id === s.contactId);
      const pill = s.delayFlagged
        ? '<span class="badge badge-delay">Delayed</span>'
        : `<span class="badge status-${s.status}">${s.status === 'out_for_delivery' ? 'Out today' : escapeHtml(s.statusLabel || s.status)}</span>`;
      const when = s.estimatedDelivery ? `by ${fmtShort(s.estimatedDelivery)}` : '';
      const sub = [when, contact ? escapeHtml(contact.name) : ''].filter(Boolean).join(' · ') || escapeHtml(s.trackingNumber);
      return `
        <div class="cal-item" data-id="${s.id}">
          <div class="c">${CARRIER_CODE[s.carrier] || escapeHtml(String(s.carrier || '').toUpperCase().slice(0, 4))}</div>
          <div class="t"><b>${escapeHtml(s.label || s.trackingNumber)}</b><span>${sub}</span></div>
          ${pill}
        </div>
      `;
    }).join('');
    $all('.cal-item', list).forEach((card) => card.addEventListener('click', () => openShipmentDetail(card.dataset.id)));
  }

  $('#calendar-prev').addEventListener('click', () => {
    calendarCursor = new Date(calendarCursor.getFullYear(), calendarCursor.getMonth(), calendarCursor.getDate() - 7);
    renderCalendar();
  });
  $('#calendar-next').addEventListener('click', () => {
    calendarCursor = new Date(calendarCursor.getFullYear(), calendarCursor.getMonth(), calendarCursor.getDate() + 7);
    renderCalendar();
  });

  $all('.nav-btn').forEach((btn) => {
    if (btn.dataset.view === 'calendar') {
      btn.addEventListener('click', () => renderCalendar());
    }
  });

  // ---------------- shipment detail + map ----------------
  async function openShipmentDetail(id) {
    state.currentShipmentId = id;
    markSeen(id);
    showView('shipment-detail');
    renderShipmentDetail();
    startChatPolling(id);
    // Refresh this specific shipment on open, to show the latest status -
    // owner-only (a follower's account doesn't own the tracking lookup),
    // so skip it entirely for a followed shipment rather than making a
    // call that's guaranteed to fail.
    const current = state.shipments.find((s) => s.id === id);
    if (current?.viewerRole === 'follower') return;
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

  // Uses a free public QR-image API rather than vendoring a QR-generation
  // library - the encoded content is only the share link itself, already
  // meant to be handed out to anyone.
  async function showShipmentQr(id) {
    try {
      const { url } = await api(`/shipments/${id}/share`, { method: 'POST' });
      const fullUrl = location.origin + url;
      $('#qr-image').src = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(fullUrl)}`;
      $('#qr-url-display').textContent = fullUrl;
      $('#qr-modal').hidden = false;
    } catch (err) {
      toast('Could not create a QR code: ' + err.message);
    }
  }
  $('#qr-close-btn').addEventListener('click', () => { $('#qr-modal').hidden = true; });
  $('#qr-modal').addEventListener('click', (e) => { if (e.target.id === 'qr-modal') $('#qr-modal').hidden = true; });

  // Mirrors services/carrierProviders.js's own STATUS_FLOW/STATUS_LABELS
  // exactly (not a separate vocabulary) - this only visualizes the same
  // status the server already tracks, as a 5-stage timeline under the
  // tracking card.
  const STATUS_TIMELINE_FLOW = ['label_created', 'picked_up', 'in_transit', 'out_for_delivery', 'delivered'];
  const STATUS_TIMELINE_LABELS = {
    label_created: 'Label created',
    picked_up: 'Picked up',
    in_transit: 'In transit',
    out_for_delivery: 'Out for delivery',
    delivered: 'Delivered',
  };
  // Short technical time for timeline rows: clock only when it's today,
  // otherwise "Sep 18".
  function fmtShort(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    const now = new Date();
    const sameDay = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
    return sameDay
      ? d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
      : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  function renderStatusTimeline(s) {
    const currentIndex = STATUS_TIMELINE_FLOW.indexOf(s.status);
    // Statuses outside this 5-stage flow (customs holds, courier-specific
    // exception codes) don't map onto a position here - skip rather than
    // guess where they'd sit.
    if (currentIndex === -1) return '';
    const checkpoints = s.checkpoints || [];
    const timeFor = (key, i) => {
      if (i > currentIndex) return key === 'delivered' && s.estimatedDelivery ? `ETA ${fmtShort(s.estimatedDelivery)}` : '';
      const cp = checkpoints[i];
      if (cp && cp.timestamp) return fmtShort(cp.timestamp);
      if (i === 0 && s.createdAt) return fmtShort(s.createdAt);
      return '';
    };
    return `
      <div class="status-timeline">
        ${STATUS_TIMELINE_FLOW.map((key, i) => `
          <div class="status-timeline-step step-${key} ${i < currentIndex ? 'done' : i === currentIndex ? 'current' : 'pending'}">
            <span class="status-timeline-dot"></span>
            <span class="status-timeline-label">${STATUS_TIMELINE_LABELS[key]}</span>
            <span class="status-timeline-time">${escapeHtml(timeFor(key, i))}</span>
          </div>
        `).join('')}
      </div>
    `;
  }

  function renderShipmentDetail() {
    const s = state.shipments.find((x) => x.id === state.currentShipmentId);
    if (!s) return;
    const contact = state.contacts.find((c) => c.id === s.contactId);
    const costText = s.cost != null ? `${escapeHtml(s.currency || '')} ${s.cost.toFixed(2)}` : '';

    // Thread header: title, participants line, status pill.
    const others = [
      ...(s.viewerRole === 'follower' ? ['owner'] : []),
      ...new Set((s.messages || []).filter((m) => m.type !== 'system' && m.userId !== state.user?.id && m.handle).map((m) => '@' + m.handle)),
    ];
    const routeText = (() => {
      const r = s.fullRoute || [];
      if (r.length < 2) return '';
      const short = (l) => escapeHtml(String(l || '').replace(/^(Origin|Destination):\s*/i, '').split(',')[0].trim());
      return `${short(r[0].label)} → ${short(r[r.length - 1].label)}`;
    })();
    $('#thread-title').innerHTML = `
      <b>${escapeHtml(s.label || s.trackingNumber)}</b>
      <span>${escapeHtml(CARRIER_LABEL[s.carrier] || s.carrier)}${routeText ? ' · ' + routeText : ''}${others.length ? ' · you, ' + escapeHtml(others.join(', ')) : ''}</span>
    `;
    $('#thread-pill').innerHTML = `<span class="badge status-${s.status}">${escapeHtml(s.statusLabel || s.status)}</span>`;

    // Live row under the map: ETA (or last checked) + tracking number.
    const etaLabel = s.status === 'delivered' ? 'Delivered' : s.estimatedDelivery ? (isToday(s.estimatedDelivery) ? 'ETA today' : 'Estimated delivery') : 'Last checked';
    const etaValue = s.status === 'delivered'
      ? fmtDate((s.checkpoints || [])[(s.checkpoints || []).length - 1]?.timestamp || s.lastCheckedAt)
      : s.estimatedDelivery ? (isToday(s.estimatedDelivery) ? fmtShort(s.estimatedDelivery) : fmtDate(s.estimatedDelivery)) : fmtDate(s.lastCheckedAt);
    $('#live-row').innerHTML = `
      <div><span class="k">${etaLabel}</span><b>${etaValue}</b></div>
      <div class="tn">${escapeHtml(s.trackingNumber)}</div>
    `;

    $('#shipment-detail-body').innerHTML = `
      <div class="hero-tags">
        <span class="badge status-${s.status}">${escapeHtml(s.statusLabel || s.status)}</span>
        ${s.delayFlagged ? '<span class="badge badge-delay">Possible delay</span>' : ''}
        ${s.archived ? '<span class="badge">Archived</span>' : ''}
        <span class="badge">${CATEGORY_ICON[s.category] || CATEGORY_ICON.other} ${escapeHtml((CATEGORIES.find((c) => c.value === s.category) || {}).label || 'Other')}</span>
        ${costText ? `<span class="badge mono">${costText}</span>` : ''}
      </div>
      <div class="data-strip">
        <div class="data-row data-eta">
          <small class="data-label">Estimated delivery</small>
          <span class="data-value">${fmtDate(s.estimatedDelivery)}</span>
        </div>
        <div class="data-row data-tracking">
          <small class="data-label">Tracking #</small>
          <span class="tn">${escapeHtml(s.trackingNumber)}</span>
        </div>
      </div>
      ${renderStatusTimeline(s)}
      <p class="last-checked">Last checked: <span class="last-checked-value">${fmtDate(s.lastCheckedAt)}</span></p>
      ${contact ? `<p class="small" style="margin-top:10px; display:flex; align-items:center; gap:6px;">${ICONS.contact} ${escapeHtml(contact.name)}</p>` : ''}
      ${s.notes ? `<p class="small" style="margin-top:10px; white-space:pre-wrap;">${escapeHtml(s.notes)}</p>` : ''}
      ${s.photo ? `<img class="shipment-photo" src="${escapeHtml(s.photo)}" alt="Shipment photo" />` : ''}
      <div class="hero-actions">
        ${s.viewerRole === 'follower' ? `
          <button class="btn-secondary small" id="unfollow-shipment-btn">Unfollow</button>
        ` : `
          <button class="btn-secondary small" id="share-shipment-btn">Share shipping</button>
          <button class="btn-secondary small" id="qr-shipment-btn">QR code</button>
          <button class="btn-secondary small" id="archive-shipment-btn">${s.archived ? 'Unarchive' : 'Archive'}</button>
          <button class="btn-secondary small" id="delete-shipment-btn">Delete shipment</button>
        `}
      </div>
    `;

    if (s.viewerRole === 'follower') {
      guardClick($('#unfollow-shipment-btn'), async () => {
        if (!confirm('Stop following this shipment?')) return;
        await api(`/shipments/${s.id}/unfollow`, { method: 'POST' });
        toast('Unfollowed');
        state.currentShipmentId = null;
        showView('shipments');
        loadShipments();
      });
    } else {
      $('#share-shipment-btn').addEventListener('click', () => shareShipment(s.id));
      $('#qr-shipment-btn').addEventListener('click', () => showShipmentQr(s.id));

      guardClick($('#archive-shipment-btn'), async () => {
        const updated = await api(`/shipments/${s.id}/archive`, { method: 'POST' });
        const idx = state.shipments.findIndex((x) => x.id === s.id);
        if (idx >= 0) state.shipments[idx] = updated;
        toast(updated.archived ? 'Shipment archived' : 'Shipment unarchived');
        renderShipmentDetail();
      });

      guardClick($('#delete-shipment-btn'), async () => {
        if (!confirm('Delete this shipment?')) return;
        await api(`/shipments/${s.id}`, { method: 'DELETE' });
        toast('Shipment deleted');
        state.currentShipmentId = null;
        showView('shipments');
        loadShipments();
      });
    }

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
    renderChatMessages(s);
  }

  // ---------------- per-shipment chat ----------------
  let chatPollTimer = null;

  function stopChatPolling() {
    if (chatPollTimer) { clearInterval(chatPollTimer); chatPollTimer = null; }
  }

  // Polls only while this shipment's detail view is open (no websockets/
  // infra needed for a first version) - stopped by showView() as soon as
  // the user navigates away.
  function startChatPolling(id) {
    stopChatPolling();
    chatPollTimer = setInterval(async () => {
      try {
        const updated = await api(`/shipments/${id}`);
        const idx = state.shipments.findIndex((x) => x.id === id);
        if (idx >= 0) state.shipments[idx] = updated;
        if (state.currentShipmentId === id) renderChatMessages(updated);
      } catch (err) {
        // Silent - the next tick (or a manual refresh) will catch up.
      }
    }, 8000);
  }

  function renderChatMessages(s) {
    const list = $('#chat-messages');
    if (state.currentShipmentId === s.id) markSeen(s.id); // reading cursor for the inbox
    const messages = s.messages || [];
    const checkpoints = s.checkpoints || [];
    const cpLabels = new Set(checkpoints.map((c) => String(c.label || '').trim().toLowerCase()));

    // One timeline, oldest → newest: courier checkpoints (as chips) and
    // human messages (as bubbles) interleaved by time. When real
    // checkpoints exist, the server's "Status: X" system messages would
    // just repeat them, so those are dropped; other system messages
    // (delays, customs, photo notices) stay.
    const events = [
      ...checkpoints.map((c) => ({ kind: 'cp', at: c.timestamp, label: c.label, status: c.status })),
      ...messages
        .filter((m) => !(checkpoints.length && m.type === 'system' && (/^(Initial status|Status):/i.test(m.text || '') || cpLabels.has(String(m.text || '').trim().toLowerCase()))))
        .map((m) => ({ kind: m.type === 'system' ? 'sys' : 'msg', at: m.createdAt, m })),
    ].sort((a, b) => new Date(a.at) - new Date(b.at));

    if (!events.length) {
      list.innerHTML = `<div class="empty small" style="padding:16px 10px;">Nothing yet. The courier's first scan will show up here, and so will anyone you share the link with.</div>`;
      return finishChatRender(s);
    }

    const wasNearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
    const dotFor = (st) => st === 'delivered' ? 'ok' : st === 'out_for_delivery' || st === 'available_for_pickup' ? 'vio' : st === 'exception' || st === 'failed_attempt' ? 'danger' : st === 'completed' ? 'ok' : 'acc';
    let lastDay = '';
    const parts = [];
    events.forEach((ev, i) => {
      const day = new Date(ev.at).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
      if (day !== lastDay) { parts.push(`<div class="th-day">${escapeHtml(day)}</div>`); lastDay = day; }
      if (ev.kind === 'cp') {
        const isLast = i === events.length - 1 || !events.slice(i + 1).some((e) => e.kind === 'cp');
        const cls = isLast ? dotFor(s.status) : 'ok';
        parts.push(`<div class="th-sys"><i class="${cls}"></i>${escapeHtml(ev.label)}<time>${fmtShort(ev.at)}</time></div>`);
      } else if (ev.kind === 'sys') {
        const m = ev.m;
        const warn = /delay|hold|exception|failed|required|rejected/i.test(m.text || '');
        parts.push(`<div class="th-sys ${warn ? 'warn' : ''}"><i class="${warn ? 'warn' : 'acc'}"></i>${linkify(escapeHtml(m.text))}<time>${fmtShort(m.createdAt)}</time></div>`);
      } else {
        const m = ev.m;
        parts.push(`
        <div class="chat-msg ${m.userId === state.user?.id ? 'mine' : ''} ${m.photo ? 'has-photo' : ''}">
          ${m.photo ? `
            <div class="chat-msg-photo-wrap">
              <img class="chat-msg-photo" src="${escapeHtml(m.photo)}" alt="Shared photo" />
              <span class="chat-msg-photo-badge">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><rect x="3" y="11" width="18" height="10" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                Metadata removed
              </span>
            </div>
          ` : ''}
          ${m.text ? `<div class="chat-msg-text">${escapeHtml(m.text)}</div>` : ''}
          <small class="chat-msg-meta">${m.userId === state.user?.id ? 'you' : '@' + escapeHtml(m.handle)} · ${fmtShort(m.createdAt)}</small>
        </div>`);
      }
    });

    // The current milestone as a highlighted card with what to do next.
    parts.push(milestoneCard(s));

    list.innerHTML = parts.join('');
    $('.th-card-share', list)?.addEventListener('click', () => shareShipment(s.id));
    $('.th-card-reply', list)?.addEventListener('click', () => $('#chat-input').focus());
    if (wasNearBottom) list.scrollTop = list.scrollHeight;
    finishChatRender(s);
  }

  function milestoneCard(s) {
    const owner = s.viewerRole !== 'follower';
    const eta = s.estimatedDelivery ? (isToday(s.estimatedDelivery) ? fmtShort(s.estimatedDelivery) + ' today' : fmtDate(s.estimatedDelivery)) : null;
    const share = owner && s.status !== 'delivered' ? '<button type="button" class="btn-secondary small th-card-share">Share link</button>' : '';
    const reply = s.status !== 'delivered' ? '<button type="button" class="btn-primary small th-card-reply">Reply</button>' : '';
    if (s.status === 'delivered') {
      return `<div class="th-card ok"><div class="h"><b>Delivered</b><time>${fmtShort((s.checkpoints || []).slice(-1)[0]?.timestamp || s.lastCheckedAt)}</time></div><p>This thread is now read-only. The photo and messages stay here.</p></div>`;
    }
    if (s.status === 'out_for_delivery' || s.status === 'available_for_pickup') {
      return `<div class="th-card hl"><div class="h"><b>${escapeHtml(s.statusLabel || 'Out for delivery')}</b><time>${fmtShort(s.lastCheckedAt)}</time></div>
        <p>${s.currentLocation?.label ? 'Courier left ' + escapeHtml(String(s.currentLocation.label).split(':').pop().trim()) + '.' : 'The courier is on the way.'}</p>
        ${eta ? `<div class="eta"><b>${eta}</b><span>estimated</span></div>` : ''}
        <div class="act">${reply}${share}</div></div>`;
    }
    if (s.delayFlagged || s.status === 'exception' || s.status === 'failed_attempt') {
      return `<div class="th-card warn"><div class="h"><b>${s.status === 'exception' ? 'Exception' : s.status === 'failed_attempt' ? 'Delivery attempt failed' : 'Possible delay'}</b><time>${fmtShort(s.lastCheckedAt)}</time></div>
        <p>${s.delayFlagged ? 'No new scan from the courier for a while.' : 'The courier reported a problem with this shipment.'}</p><div class="act">${reply}${share}</div></div>`;
    }
    return `<div class="th-card"><div class="h"><b>${escapeHtml(s.statusLabel || 'In transit')}</b><time>${fmtShort(s.lastCheckedAt)}</time></div>
      ${eta ? `<div class="eta"><b>${eta}</b><span>estimated</span></div>` : '<p>Checked automatically every 30 minutes.</p>'}
      <div class="act">${reply}${share}</div></div>`;
  }

  function finishChatRender(s) {
    const closed = s.status === 'delivered';
    $('#chat-form').hidden = closed;
    $('#chat-closed-note').hidden = !closed;
  }

  guardSubmit($('#chat-form'), async (e) => {
    e.preventDefault();
    const input = $('#chat-input');
    const text = input.value.trim();
    const photo = $('#chat-photo-input').value || null;
    if (!text && !photo) return;
    if (!state.currentShipmentId) return;
    input.value = '';
    resetChatPhotoPicker();
    try {
      const updated = await api(`/shipments/${state.currentShipmentId}/messages`, { method: 'POST', body: { text, photo } });
      const idx = state.shipments.findIndex((x) => x.id === state.currentShipmentId);
      if (idx >= 0) state.shipments[idx] = updated;
      renderChatMessages(updated);
    } catch (err) {
      toast(err.message);
      input.value = text;
    }
  });

  // iOS doesn't reliably keep a position:fixed element (the bottom nav)
  // clear of the on-screen keyboard - hiding the nav while the chat input
  // is focused removes the thing it was colliding with, and the sticky
  // .chat-form (see style.css) then sits right above the keyboard on its
  // own. The scrollIntoView is a second safety net for the case where the
  // keyboard's opening animation still leaves the input just out of view.
  $('#chat-input').addEventListener('focus', (e) => {
    document.body.classList.add('chat-input-focused');
    setTimeout(() => e.target.scrollIntoView({ block: 'center', behavior: 'smooth' }), 300);
  });
  $('#chat-input').addEventListener('blur', () => {
    document.body.classList.remove('chat-input-focused');
  });

  // containerSel/mapKey let this be reused for the read-only shared view
  // (its own #shared-map container, its own state.sharedMap instance) as
  // well as the normal logged-in shipment detail (#map / state.map).
  function renderMap(shipment, containerSel = '#map', mapKey = 'map') {
    const container = $(containerSel);
    const route = shipment.fullRoute && shipment.fullRoute.length ? shipment.fullRoute : null;

    // Tear down any previous Leaflet instance on this container FIRST,
    // regardless of which branch below runs. Leaflet's own .remove()
    // strips the leaflet-* classes it added (including the one that
    // sets a light-grey background) - skipping this when falling back
    // to the empty/no-route state left that grey background stuck on
    // the container instead of matching the dark theme, since only
    // innerHTML was cleared, never the container's own classes.
    if (state[mapKey]) {
      state[mapKey].remove();
      state[mapKey] = null;
    }

    if (!route) {
      container.innerHTML = '<div class="empty" style="padding:20px;">The map will appear as soon as the courier reports the first checkpoint.</div>';
      return;
    }
    if (typeof L === 'undefined') {
      container.innerHTML = '<div class="empty" style="padding:20px;">Could not load the map (no connection to the map provider). The rest of the shipment info is still available below.</div>';
      return;
    }
    container.innerHTML = '';

    const map = L.map(container, { zoomControl: true, attributionControl: true });
    state[mapKey] = map;
    L.tileLayer('https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 16,
      attribution: '&copy; Esri, HERE, Garmin, &copy; OpenStreetMap contributors',
    }).addTo(map);

    const latlngs = route.map((p) => [p.lat, p.lng]);
    const doneIndex = shipment.checkpointIndex ?? -1;
    // Leaflet needs a real color string, not a CSS var - read the current
    // --accent from the page instead of hardcoding the old lime, so this
    // doesn't go stale again the next time the accent color changes.
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#5e6ad2';

    const accent2 = getComputedStyle(document.documentElement).getPropertyValue('--accent2').trim() || '#8b7cf6';
    const ok = getComputedStyle(document.documentElement).getPropertyValue('--ok').trim() || '#3ecf8e';

    // Remaining leg: faint dashed line that drifts (mockup .route-line);
    // traveled leg: 3px round-capped accent2->accent gradient, applied to
    // the SVG path after fitBounds below.
    L.polyline(latlngs, { color: 'rgba(255,255,255,.18)', weight: 2, className: 'map-route-pending' }).addTo(map);
    let donePolyline = null;
    if (doneIndex >= 0) {
      donePolyline = L.polyline(latlngs.slice(0, doneIndex + 1), { color: accent, weight: 3, lineCap: 'round', lineJoin: 'round' }).addTo(map);
    }

    route.forEach((p, i) => {
      const isDone = i <= doneIndex;
      const isCurrent = i === doneIndex;
      if (isCurrent) {
        // The current checkpoint gets a pulsing pin (DivIcon, plain CSS
        // animation) instead of a plain dot, so it's obvious at a glance
        // where the package actually is right now.
        const icon = L.divIcon({
          className: '',
          html: '<div class="map-pulse-marker"><div class="map-pulse-ring"></div><div class="map-pulse-dot"></div></div>',
          iconSize: [22, 22],
          iconAnchor: [11, 11],
        });
        const marker = L.marker([p.lat, p.lng], { icon }).addTo(map);
        marker.bindPopup(`<b>${escapeHtml(p.label)}</b>`);
        return;
      }
      // Origin reads as the green "start" dot, later done stops in accent,
      // pending stops as a hollow ring (mockup's route markers).
      const marker = L.circleMarker([p.lat, p.lng], {
        radius: 4,
        color: i === 0 ? ok : isDone ? accent : '#c7ccff',
        fillColor: i === 0 ? ok : accent,
        fillOpacity: isDone ? 1 : 0,
        weight: isDone ? 2 : 1.5,
      }).addTo(map);
      marker.bindPopup(`<b>${escapeHtml(p.label)}</b>`);
    });

    const bounds = L.latLngBounds(latlngs);
    map.fitBounds(bounds, { padding: [30, 30] });

    // Draw the "traveled so far" line in, rather than having it just
    // appear - a plain CSS stroke-dashoffset animation on the SVG path
    // Leaflet renders underneath. This has to run after fitBounds - Leaflet
    // re-applies each path's own style (including stroke-dasharray) as
    // part of that redraw, which was silently wiping this out when it ran
    // beforehand. 'moveend' doesn't reliably fire after fitBounds() on a
    // brand-new map in this app (even though fitBounds did already resize
    // the view correctly), so a short delay is used instead of that event.
    // Skipped for prefers-reduced-motion, and harmless if
    // getElement()/getTotalLength() aren't available (falls back to a
    // fully-drawn static line, same as before this was added).
    if (donePolyline) {
      const animateDrawIn = () => {
        const prefersReducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        const pathEl = donePolyline.getElement && donePolyline.getElement();
        if (!pathEl) return;
        applyRouteGradient(pathEl, accent2, accent);
        if (prefersReducedMotion || typeof pathEl.getTotalLength !== 'function') return;
        const length = pathEl.getTotalLength();
        pathEl.style.transition = 'none';
        pathEl.style.strokeDasharray = `${length} ${length}`;
        pathEl.style.strokeDashoffset = String(length);
        pathEl.getBoundingClientRect(); // force layout so the transition below doesn't get coalesced with the initial style
        pathEl.style.transition = 'stroke-dashoffset 1.4s ease-out';
        requestAnimationFrame(() => { pathEl.style.strokeDashoffset = '0'; });
      };
      setTimeout(animateDrawIn, 60);
    }
  }

  // Paints the traveled route with an SVG gradient (accent2 -> accent).
  // objectBoundingBox units survive Leaflet's zoom re-projection; a path
  // whose bbox collapses on one axis (perfectly vertical/horizontal route)
  // would render invisible with a gradient, so those keep the flat color.
  function applyRouteGradient(pathEl, fromColor, toColor) {
    const svg = pathEl.ownerSVGElement;
    if (!svg || typeof pathEl.getBBox !== 'function') return;
    const box = pathEl.getBBox();
    const horizontal = box.width >= 2;
    if (!horizontal && box.height < 2) return;
    const id = 'route-grad-' + Math.random().toString(36).slice(2, 8);
    const ns = 'http://www.w3.org/2000/svg';
    let defs = svg.querySelector('defs');
    if (!defs) { defs = document.createElementNS(ns, 'defs'); svg.insertBefore(defs, svg.firstChild); }
    const grad = document.createElementNS(ns, 'linearGradient');
    grad.setAttribute('id', id);
    grad.setAttribute('x1', '0'); grad.setAttribute('y1', '0');
    grad.setAttribute('x2', horizontal ? '1' : '0'); grad.setAttribute('y2', horizontal ? '0' : '1');
    [[0, fromColor], [1, toColor]].forEach(([offset, color]) => {
      const stop = document.createElementNS(ns, 'stop');
      stop.setAttribute('offset', String(offset));
      stop.setAttribute('stop-color', color);
      grad.appendChild(stop);
    });
    defs.appendChild(grad);
    pathEl.setAttribute('stroke', `url(#${id})`);
  }

  // Only the 6 most recent updates show by default - a shipment that's
  // changed hands a dozen times otherwise turns the whole page into a
  // wall of checkpoints. "Show earlier updates" reveals the rest without
  // a real network fetch (they're already in `shipment`), so this is a
  // plain expand/collapse rather than a real loading state.
  const CHECKPOINT_LIMIT = 6;

  function renderCheckpoints(shipment, containerSel = '#checkpoints-list') {
    const list = $(containerSel);
    list.className = 'checkpoints' + (shipment.status ? ' ship-' + shipment.status : '');
    const checkpoints = (shipment.checkpoints || []).slice().reverse();
    if (!checkpoints.length) {
      list.innerHTML = '';
      return;
    }
    let expanded = false;

    function draw() {
      const items = expanded ? checkpoints : checkpoints.slice(0, CHECKPOINT_LIMIT);
      const hiddenCount = checkpoints.length - CHECKPOINT_LIMIT;
      const rows = items.map((c, i) => `
        <div class="checkpoint${i === 0 ? ' latest' : ''}${c.status ? ' cp-' + c.status : ''}">
          <div>
            <div class="checkpoint-label">${escapeHtml(c.label)}</div>
            <div class="checkpoint-time">${fmtDate(c.timestamp)}</div>
          </div>
        </div>
      `).join('');
      const moreBtn = hiddenCount > 0
        ? `<button type="button" class="link-btn checkpoint-more-btn">${expanded ? 'Show less' : `Show ${hiddenCount} earlier update${hiddenCount === 1 ? '' : 's'}`}</button>`
        : '';
      list.innerHTML = rows + moreBtn;
      if (moreBtn) {
        $('.checkpoint-more-btn', list).addEventListener('click', () => {
          expanded = !expanded;
          draw();
        });
      }
    }
    draw();
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
          <p class="notif-time">${fmtDate(n.createdAt)}</p>
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

  guardClick($('#mark-all-read-btn'), async () => {
    await api('/notifications/read-all', { method: 'POST' });
    loadNotifications();
  });

  // ---------------- install app (Add to Home Screen) ----------------
  let deferredInstallPrompt = null;
  const isStandalone = () =>
    window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent);

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    updateInstallBlock();
  });
  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    $('#install-app-block').hidden = true;
    toast('App installed');
  });

  function updateInstallBlock() {
    const block = $('#install-app-block');
    if (isStandalone()) { block.hidden = true; return; }
    if (deferredInstallPrompt) {
      $('#install-app-hint').textContent = 'Install Sputnik Ship on this device for a faster, full-screen experience.';
      $('#install-app-btn').hidden = false;
      block.hidden = false;
    } else if (isIos()) {
      $('#install-app-hint').textContent = 'Tap the Share icon in Safari, then "Add to Home Screen".';
      $('#install-app-btn').hidden = true;
      block.hidden = false;
    } else {
      block.hidden = true; // not installable yet (browser hasn't offered the prompt) and not iOS
    }
  }

  $('#install-app-btn').addEventListener('click', async () => {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    updateInstallBlock();
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
    const hint = $('#push-unavailable-hint');
    if (!pushSupported()) {
      // On iOS, PushManager only exists once the app is running as an
      // installed, standalone PWA - opened from Safari (even "Add to
      // Home Screen" not yet done) it's silently missing. Without this
      // hint the button just never appears and nothing explains why.
      if (isIos() && !isStandalone()) {
        hint.textContent = 'To get notifications on iPhone, first install this app: tap the Share icon in Safari, then "Add to Home Screen" - then open it from there and come back here.';
        hint.hidden = false;
      }
      return;
    }
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

  guardClick($('#push-toggle-btn'), async () => {
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
      const result = await api('/push/subscribe', { method: 'POST', body: sub.toJSON() });
      updatePushButton(true);
      if (result.testPush?.ok) {
        toast('Notifications enabled - check for the test alert');
      } else {
        toast('Subscribed, but the test notification failed: ' + (result.testPush?.reason || 'unknown error'));
      }
    } catch (err) {
      toast('Could not enable notifications: ' + err.message);
    }
  });

  function escapeHtml(str) {
    return String(str ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  // Turns a bare URL inside an already-escaped string into a clickable
  // link - used for system messages like a customs hold, where the
  // courier's own status text sometimes includes a payment/info link.
  // Never called on raw text - always escapeHtml() first.
  function linkify(escapedHtml) {
    return escapedHtml.replace(/https?:\/\/[^\s<]+/g, (url) => {
      const clean = url.replace(/[.,)]+$/, '');
      return `<a href="${clean}" target="_blank" rel="noopener noreferrer">${clean}</a>`;
    });
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
          <div class="hero-tags"><span class="badge status-${s.status}">${escapeHtml(s.statusLabel || s.status)}</span></div>
          <div class="data-strip">
            <div class="data-row data-eta">
              <small class="data-label">Estimated delivery</small>
              <span class="data-value">${fmtDate(s.estimatedDelivery)}</span>
            </div>
            <div class="data-row data-tracking">
              <small class="data-label">Tracking #</small>
              <span class="tn">${escapeHtml(s.trackingNumber)}</span>
            </div>
          </div>
          ${renderStatusTimeline(s)}
          <p class="last-checked">Last checked: <span class="last-checked-value">${fmtDate(s.lastCheckedAt)}</span></p>
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

    renderSharedCta(token);
  }

  function renderSharedCta(token) {
    const cta = $('#shared-cta');

    if (state.token && state.user) {
      cta.innerHTML = `
        <div class="auth-card shared-auth-card">
          <p class="small muted" style="margin:0 0 14px;">Logged in as @${escapeHtml(state.user.handle)}</p>
          <p class="small muted" style="margin:0 0 10px;">By following, you'll get read-only access to this shipment's tracking and can message the person who shared it. You can unfollow any time.</p>
          <button type="button" class="btn-primary" id="shared-follow-btn" style="width:100%; margin-bottom:10px;">Follow &amp; chat about this shipment</button>
          <a href="/" class="btn-secondary" style="display:block; text-align:center; text-decoration:none;">Go to my shipments</a>
        </div>
      `;
      guardClick($('#shared-follow-btn'), async () => {
        try {
          const followed = await api('/shipments/follow', { method: 'POST', body: { shareToken: token } });
          toast('Now following this shipment');
          location.href = `/?openShipment=${followed.id}`;
        } catch (err) {
          toast(err.message);
        }
      });
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

    guardSubmit($('#shared-login-form'), async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const errEl = $('#shared-login-error');
      errEl.hidden = true;
      try {
        const data = await api('/auth/login', { method: 'POST', body: Object.fromEntries(fd) });
        saveSession(data.token, data.user);
        toast(`Welcome back, @${data.user.handle}`);
        renderSharedCta(token); // stays on this same page, now signed in
      } catch (err) {
        errEl.textContent = err.message;
        errEl.hidden = false;
      }
    });

    guardSubmit($('#shared-signup-form'), async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const errEl = $('#shared-signup-error');
      errEl.hidden = true;
      try {
        const data = await api('/auth/signup', { method: 'POST', body: Object.fromEntries(fd) });
        saveSession(data.token, data.user);
        toast(`Welcome, @${data.user.handle}`);
        renderSharedCta(token);
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
    loadNotifyPrefs();
    updateInstallBlock();
  }

  // ---- notification preferences ----
  const NOTIFY_TOGGLE_IDS = { status: 'notify-status', delay: 'notify-delay', customs: 'notify-customs', digest: 'notify-digest', chat: 'notify-chat' };

  async function loadNotifyPrefs() {
    try {
      const prefs = await api('/account/notify-prefs');
      for (const [type, elId] of Object.entries(NOTIFY_TOGGLE_IDS)) {
        $(`#${elId}`).checked = prefs[type] !== false;
      }
    } catch (err) {
      // Non-critical - the toggles just keep their default (checked) state.
    }
  }

  Object.entries(NOTIFY_TOGGLE_IDS).forEach(([type, elId]) => {
    $(`#${elId}`).addEventListener('change', async (e) => {
      try {
        await api('/account/notify-prefs', { method: 'PUT', body: { [type]: e.target.checked } });
      } catch (err) {
        e.target.checked = !e.target.checked; // revert on failure
        toast(err.message);
      }
    });
  });

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
  guardSubmit($('#change-password-form'), async (e) => {
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
  guardSubmit($('#regen-recovery-form'), async (e) => {
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

  // ---- delete account ----
  $('#delete-account-btn').addEventListener('click', () => {
    $('#delete-account-form').reset();
    $('#delete-account-error').hidden = true;
    $('#delete-account-modal').hidden = false;
  });
  $('#delete-account-cancel').addEventListener('click', () => { $('#delete-account-modal').hidden = true; });
  guardSubmit($('#delete-account-form'), async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target));
    const errEl = $('#delete-account-error');
    errEl.hidden = true;
    try {
      await api('/account', { method: 'DELETE', body: fd });
      $('#delete-account-modal').hidden = true;
      state.token = null;
      state.user = null;
      localStorage.removeItem('sputnikship_token');
      localStorage.removeItem('sputnikship_user');
      toast('Account deleted');
      showAuth();
    } catch (err) {
      errEl.textContent = err.message;
      errEl.hidden = false;
    }
  });

  // ---- invite / join / leave a shared space ----
  guardClick($('#invite-btn'), async () => {
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

  guardSubmit($('#join-space-form'), async (e) => {
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

  guardClick($('#leave-space-btn'), async () => {
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

  // ---------------- motion: reveal cards as they enter the viewport ----------------
  // Lists re-render via innerHTML, so a MutationObserver picks up every new
  // card and hands it to one IntersectionObserver; CSS (.rv/.rv.in) does the
  // fade + 12px lift and drops it under prefers-reduced-motion.
  (function initReveal() {
    if (!('IntersectionObserver' in window) || !('MutationObserver' in window)) return;
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const REVEAL = '.card, .cal-item, .shipment-hero, .cal-alert, .account-block, .pp-stat';
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (!e.isIntersecting) return;
        e.target.classList.add('in');
        io.unobserve(e.target);
      });
    }, { threshold: 0.08 });
    const watch = (root) => {
      if (!(root instanceof Element)) return;
      const nodes = root.matches(REVEAL) ? [root] : [];
      nodes.push(...root.querySelectorAll(REVEAL));
      nodes.forEach((el) => {
        if (el.classList.contains('rv')) return;
        el.classList.add('rv');
        io.observe(el);
      });
    };
    new MutationObserver((records) => {
      records.forEach((r) => r.addedNodes.forEach(watch));
    }).observe(document.body, { childList: true, subtree: true });
    watch(document.body);
  })();

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
