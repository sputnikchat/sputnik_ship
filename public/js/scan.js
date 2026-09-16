// Shipping label scanner: pulls a tracking number, recipient name and
// address out of a shipping label. Everything runs client-side in the
// browser (OCR via Tesseract.js, barcode decoding via ZXing) - no image
// or video frame is ever uploaded anywhere.
//
// Two entry points on window.LabelScanner:
//   scanShippingLabel(file) -> Promise<Result>
//     One-shot extraction from a single photo (file picker / native camera app).
//   startLiveScan(videoEl, { onResult, onError }) -> Promise<{ stop() }>
//     Opens the device camera into videoEl and keeps scanning every frame
//     (barcode continuously, OCR on a short interval) until stop() is
//     called. onResult(partial) fires every time a pass finds something.
//
// Result / partial shape: { trackingNumber, recipientName, address, rawText }
// Pure extraction only - no DOM writes beyond the <video> feed, no API
// calls, no carrier detection (the caller reuses the app's own
// detectCarrier() for that, see public/js/app.js).
//
// Honest limitation: the big square barcode on FedEx/UPS labels (PDF417)
// encodes the full shipment record in each carrier's own proprietary
// internal format - there's no public spec to parse that into clean
// fields. This only uses the decoded PDF417/1D barcode *text* as a
// tracking-number source (barcodes read exact digits, which OCR can get
// wrong). Structured fields (name, address) come from OCR + regex
// heuristics on the printed text, which won't be perfect on every frame
// (glare, skew, angle, motion blur) - callers should treat the result as
// a draft to review, not a guaranteed-correct value.

(() => {
  'use strict';

  const SCRIPTS = {
    Tesseract: 'https://cdnjs.cloudflare.com/ajax/libs/tesseract.js/7.0.0/tesseract.min.js',
    ZXing: 'https://cdn.jsdelivr.net/npm/@zxing/library@latest/umd/index.min.js',
  };
  const loaded = {};
  function loadScript(globalName) {
    if (window[globalName]) return Promise.resolve();
    if (loaded[globalName]) return loaded[globalName];
    loaded[globalName] = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = SCRIPTS[globalName];
      script.onload = () => resolve();
      script.onerror = () => reject(new Error(`Could not load ${globalName}.`));
      document.head.appendChild(script);
    });
    return loaded[globalName];
  }

  function loadImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Could not read that image.'));
      img.src = url;
    });
  }

  function zxingHints() {
    const hints = new Map();
    hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, [
      ZXing.BarcodeFormat.PDF_417,
      ZXing.BarcodeFormat.CODE_128,
      ZXing.BarcodeFormat.CODE_39,
    ]);
    return hints;
  }

  // Tries PDF417 first (the big square barcode most shipping labels
  // have), then falls back to common 1D formats (the thin linear
  // barcode that usually just encodes the tracking number).
  async function decodeBarcode(img) {
    try {
      await loadScript('ZXing');
    } catch (err) {
      return null; // barcode decoding is a bonus, not a hard requirement
    }
    try {
      const reader = new ZXing.BrowserMultiFormatReader(zxingHints());
      const result = await reader.decodeFromImageElement(img);
      return result ? result.getText() : null;
    } catch (err) {
      // ZXing throws when it simply can't find a barcode in the image -
      // that's an expected outcome, not an error worth surfacing.
      return null;
    }
  }

  async function runOcr(file) {
    await loadScript('Tesseract');
    const { data } = await Tesseract.recognize(file, 'eng');
    return data && data.text ? data.text : '';
  }

  // Field markers that show up on shipping labels but are never part of
  // the recipient's name/address - filtered out of the address block.
  const NOISE_LINE = /^(REF|INV|PO|DEPT|TRK#?|ORIGIN ID|SHIP DATE|ACTWGT|CAD|DIMS|BILL SENDER|NO EEI|SIGN|PM|AM)\b/i;

  function parseTrackingNumber(rawText, barcodeText) {
    // A barcode reads exact digits; OCR can misread similar-looking
    // characters, so prefer the barcode when we have one.
    if (barcodeText) {
      const digits = barcodeText.replace(/\D/g, '');
      if (digits.length >= 8) return digits;
    }
    const match = rawText.match(/TRK#?\s*[:\s]*([\d\s]{8,})/i);
    if (match) return match[1].replace(/\s+/g, '');
    // Fallback: a long run of digits (10+) is very likely the tracking number.
    const longDigits = rawText.match(/\b\d[\d\s]{9,}\d\b/);
    return longDigits ? longDigits[0].replace(/\s+/g, '') : '';
  }

  function parseRecipient(lines) {
    const toIndex = lines.findIndex((l) => /^TO\b/i.test(l.trim()));
    if (toIndex === -1) return { name: '', address: '' };

    const toLine = lines[toIndex].trim();
    const sameLineMatch = toLine.match(/^TO\s+(.+)/i);
    let nameLineIndex = toIndex;
    let name = sameLineMatch ? sameLineMatch[1].trim() : '';

    if (!name) {
      // "TO" was on its own line - the name is the next non-empty line.
      for (let i = toIndex + 1; i < lines.length; i++) {
        if (lines[i].trim()) {
          name = lines[i].trim();
          nameLineIndex = i;
          break;
        }
      }
    }

    // Address: the non-empty, non-noise lines after the name, up to the
    // line that looks like the city/state/postal/country line (ends in
    // a 2-3 letter country code in parens, or has a postal-code-like
    // token), inclusive of that line.
    const addressLines = [];
    for (let i = nameLineIndex + 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line || NOISE_LINE.test(line)) continue;
      addressLines.push(line);
      if (/\(\s*[A-Z]{2,3}\s*\)\s*$/.test(line) || /\b\d{4,6}\b/.test(line)) break;
      if (addressLines.length >= 4) break; // safety cap
    }

    return { name, address: addressLines.join(', ') };
  }

  function parseFields(rawText, barcodeText, source) {
    const lines = rawText.split('\n').map((l) => l.trim()).filter(Boolean);
    const trackingNumber = parseTrackingNumber(rawText, barcodeText);
    const { name: recipientName, address } = parseRecipient(lines);
    return { trackingNumber, recipientName, address, rawText, source };
  }

  async function scanShippingLabel(file) {
    if (!file) throw new Error('No image provided.');
    const img = await loadImage(file);
    const [barcodeText, rawText] = await Promise.all([
      decodeBarcode(img).catch(() => null),
      runOcr(file).catch(() => ''),
    ]);
    URL.revokeObjectURL(img.src);
    return parseFields(rawText, barcodeText, 'photo');
  }

  // ---------------- live camera scan ----------------

  function captureFrame(videoEl) {
    const canvas = document.createElement('canvas');
    canvas.width = videoEl.videoWidth || 1280;
    canvas.height = videoEl.videoHeight || 720;
    canvas.getContext('2d').drawImage(videoEl, 0, 0, canvas.width, canvas.height);
    return canvas;
  }

  // Opens the device camera straight into `videoEl` and keeps scanning
  // every frame until stop() is called: barcodes are decoded continuously
  // (ZXing's own frame loop), OCR runs on a fixed interval (it's far too
  // slow to run every frame). Every time either pass turns up something,
  // onResult(partial) fires with whatever's known so far - the caller
  // decides when it has "enough" (e.g. a tracking number) to stop.
  async function startLiveScan(videoEl, { onResult, onError } = {}) {
    await Promise.all([loadScript('ZXing'), loadScript('Tesseract')]);

    let lastBarcodeText = '';
    let stopped = false;
    let ocrBusy = false;

    const zxingReader = new ZXing.BrowserMultiFormatReader(zxingHints());
    const worker = await Tesseract.createWorker('eng');

    // decodeFromConstraints opens the camera (rear/environment on phones),
    // attaches the stream to videoEl, and keeps calling back on every
    // frame - a result when a barcode is found, a (harmless, expected)
    // NotFoundException otherwise.
    const constraints = { video: { facingMode: { ideal: 'environment' } } };
    await zxingReader.decodeFromConstraints(constraints, videoEl, (result) => {
      if (stopped || !result) return;
      lastBarcodeText = result.getText();
      onResult && onResult(parseFields('', lastBarcodeText, 'barcode'));
    });

    const ocrTimer = setInterval(async () => {
      if (stopped || ocrBusy) return;
      if (!videoEl.videoWidth) return; // stream not actually flowing yet
      ocrBusy = true;
      try {
        const canvas = captureFrame(videoEl);
        const { data } = await worker.recognize(canvas);
        if (stopped) return;
        const rawText = (data && data.text) || '';
        onResult && onResult(parseFields(rawText, lastBarcodeText, 'ocr'));
      } catch (err) {
        onError && onError(err);
      } finally {
        ocrBusy = false;
      }
    }, 1300);

    function stop() {
      if (stopped) return;
      stopped = true;
      clearInterval(ocrTimer);
      try { zxingReader.reset(); } catch (err) { /* already stopped */ }
      worker.terminate().catch(() => {});
    }

    return { stop };
  }

  window.LabelScanner = { scanShippingLabel, startLiveScan };
  // Back-compat alias for the previous single-function global.
  window.scanShippingLabel = scanShippingLabel;
})();
