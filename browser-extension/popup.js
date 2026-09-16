(() => {
  'use strict';

  // Personal-use extension for one Sputnik Ship deployment - point this
  // at your own instance if it's not this one.
  const API_BASE = 'https://sputnik-ship.onrender.com/api';

  const CARRIER_LABEL = { fedex: 'FedEx', ups: 'UPS', dhl: 'DHL', usps: 'USPS' };

  function $(sel) { return document.querySelector(sel); }

  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { el.hidden = true; }, 2200);
  }

  async function api(path, { method = 'GET', body, token } = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(API_BASE + path, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Network error');
    return data;
  }

  function getSession() {
    return new Promise((resolve) => {
      chrome.storage.local.get(['token', 'handle'], (r) => resolve(r));
    });
  }
  function setSession(token, handle) {
    return new Promise((resolve) => chrome.storage.local.set({ token, handle }, resolve));
  }
  function clearSession() {
    return new Promise((resolve) => chrome.storage.local.remove(['token', 'handle'], resolve));
  }

  // Same carrier patterns as public/js/app.js's detectCarrier() - kept in
  // sync by hand. Bare-digit formats (FedEx/DHL) are ambiguous on a
  // random web page (could be a phone number, a price, an order ID), so
  // those only count when a shipping-related word appears nearby; the
  // distinctive-prefix formats (UPS, USPS) are trusted on their own.
  function findTrackingCandidates(text) {
    const found = new Map();
    let m;

    const upsRe = /\b1Z[0-9A-Z]{16}\b/g;
    while ((m = upsRe.exec(text))) found.set(m[0], 'ups');

    const usps1Re = /\b(94|93|92|82|EC|CP)\d{18,20}\b/g;
    while ((m = usps1Re.exec(text))) found.set(m[0], 'usps');
    const usps2Re = /\b[A-Z]{2}\d{9}US\b/g;
    while ((m = usps2Re.exec(text))) found.set(m[0], 'usps');

    const contextRe = /\b(tracking|track|shipment|package|parcel|courier|delivery|gu[ií]a|seguimiento|env[ií]o|rastre)/i;
    const digitRunRe = /\b\d{10,20}\b/g;
    while ((m = digitRunRe.exec(text))) {
      const digits = m[0];
      const context = text.slice(Math.max(0, m.index - 60), m.index + digits.length + 60);
      if (!contextRe.test(context)) continue;
      if (/^\d{12}$|^\d{15}$/.test(digits)) found.set(digits, 'fedex');
      else if (/^\d{10}$|^\d{11}$/.test(digits)) found.set(digits, 'dhl');
    }

    return Array.from(found, ([trackingNumber, carrier]) => ({ trackingNumber, carrier }));
  }

  async function scanActiveTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return [];
    try {
      const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => document.body ? document.body.innerText : '',
      });
      return findTrackingCandidates(result || '');
    } catch (err) {
      // Common on chrome:// pages, the Chrome Web Store, or PDFs - scripting is blocked there.
      return [];
    }
  }

  function renderResults(candidates, token) {
    const list = $('#results-list');
    $('#scan-status').textContent = candidates.length
      ? `Found ${candidates.length} on this page`
      : 'No tracking numbers found on this page';

    if (!candidates.length) {
      list.innerHTML = '<div class="empty">Browse to an order confirmation or tracking page and hit Rescan.</div>';
      return;
    }

    list.innerHTML = candidates.map((c, i) => `
      <div class="result-card">
        <div class="result-tn">${escapeHtml(c.trackingNumber)}</div>
        <span class="result-courier">${CARRIER_LABEL[c.carrier] || c.carrier.toUpperCase()}</span>
        <button type="button" class="result-add-btn" data-i="${i}">+ Add to Sputnik Ship</button>
      </div>
    `).join('');

    list.querySelectorAll('.result-add-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const c = candidates[Number(btn.dataset.i)];
        btn.disabled = true;
        btn.textContent = 'Adding…';
        try {
          await api('/shipments', {
            method: 'POST',
            token,
            body: { carrier: c.carrier, trackingNumber: c.trackingNumber },
          });
          btn.textContent = '✓ Added';
          btn.classList.add('added');
        } catch (err) {
          btn.disabled = false;
          btn.textContent = '+ Add to Sputnik Ship';
          toast(err.message);
        }
      });
    });
  }

  function escapeHtml(str) {
    return String(str ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  async function showScanView(token, handle) {
    $('#login-view').hidden = true;
    $('#scan-view').hidden = false;
    $('#current-handle').textContent = handle;
    $('#scan-status').textContent = 'Scanning this page…';
    $('#results-list').innerHTML = '';
    const candidates = await scanActiveTab();
    renderResults(candidates, token);
  }

  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target));
    const errEl = $('#login-error');
    errEl.hidden = true;
    try {
      const data = await api('/auth/login', { method: 'POST', body: fd });
      await setSession(data.token, data.user.handle);
      showScanView(data.token, data.user.handle);
    } catch (err) {
      errEl.textContent = err.message;
      errEl.hidden = false;
    }
  });

  $('#logout-btn').addEventListener('click', async () => {
    await clearSession();
    $('#scan-view').hidden = true;
    $('#login-view').hidden = false;
  });

  $('#rescan-btn').addEventListener('click', async () => {
    const { token } = await getSession();
    if (token) showScanView(token, $('#current-handle').textContent);
  });

  (async () => {
    const { token, handle } = await getSession();
    if (token && handle) {
      showScanView(token, handle);
    } else {
      $('#login-view').hidden = false;
    }
  })();
})();
