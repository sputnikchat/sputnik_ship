// Shipping label scanner: pulls a tracking number, recipient name and
// address out of a photo of a label. Everything runs client-side in the
// browser (OCR via Tesseract.js, barcode decoding via ZXing) - the image
// is never uploaded anywhere.
//
// Exposes a single entry point: window.scanShippingLabel(file) -> Promise
// resolving to { trackingNumber, recipientName, address, rawText }.
// Pure extraction only - no DOM writes, no API calls, no carrier
// detection (the caller re-uses the app's own detectCarrier() for that,
// see public/js/app.js).
//
// Honest limitation: the big square barcode on FedEx/UPS labels (PDF417)
// encodes the full shipment record in each carrier's own proprietary
// internal format - there's no public spec to parse that into clean
// fields. This only uses the decoded PDF417/1D barcode *text* as a
// tracking-number fallback when OCR can't read the printed digits
// reliably. Structured fields (name, address) come from OCR + regex
// heuristics on the printed text, which won't be perfect on every photo
// (glare, skew, angle) - callers should treat the result as a draft to
// review, not a guaranteed-correct value.

(() => {
  'use strict';

  // Tesseract.js and ZXing are heavy (OCR is a multi-MB WASM engine) and
  // most page loads never use the scanner, so they're fetched lazily on
  // first use instead of blocking every page load like Leaflet does.
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
      const hints = new Map();
      hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, [
        ZXing.BarcodeFormat.PDF_417,
        ZXing.BarcodeFormat.CODE_128,
        ZXing.BarcodeFormat.CODE_39,
      ]);
      const reader = new ZXing.BrowserMultiFormatReader(hints);
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

  async function scanShippingLabel(file) {
    if (!file) throw new Error('No image provided.');
    const img = await loadImage(file);
    const [barcodeText, rawText] = await Promise.all([
      decodeBarcode(img).catch(() => null),
      runOcr(file).catch(() => ''),
    ]);
    URL.revokeObjectURL(img.src);

    const lines = rawText.split('\n').map((l) => l.trim()).filter(Boolean);
    const trackingNumber = parseTrackingNumber(rawText, barcodeText);
    const { name: recipientName, address } = parseRecipient(lines);

    return { trackingNumber, recipientName, address, rawText };
  }

  window.scanShippingLabel = scanShippingLabel;
})();
