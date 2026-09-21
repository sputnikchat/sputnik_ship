// Server-side checks and metadata strip for uploaded photos. The client
// already re-encodes through a canvas (which drops EXIF), but a caller can
// POST a data URI directly, so the server never trusts that.

// ~2.6 MB of actual image once decoded - far above what the client's own
// compressImage() produces, well under the 5 MB JSON body limit, and small
// enough that one photo can't bloat the shared database document.
const MAX_IMAGE_BASE64_CHARS = 3500000;

const DATA_URI_RE = /^data:image\/(png|jpe?g|webp|gif);base64,([A-Za-z0-9+/]+=*)$/;

// The declared MIME type is just a string the caller typed - these are the
// file's real first bytes for each format, so "data:image/png" wrapping an
// HTML page or an executable is rejected instead of stored.
function matchesSignature(type, buf) {
  if (type === 'jpeg' || type === 'jpg') return buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  if (type === 'png') return buf.length > 8 && buf.readUInt32BE(0) === 0x89504e47 && buf.readUInt32BE(4) === 0x0d0a1a0a;
  if (type === 'gif') return buf.length > 6 && buf.toString('ascii', 0, 4) === 'GIF8';
  if (type === 'webp') return buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP';
  return false;
}

// Returns an error message for the client, or null when the image is fine.
function validateImageDataUri(dataUri) {
  if (typeof dataUri !== 'string') return 'Photo must be a valid image.';
  if (dataUri.length > MAX_IMAGE_BASE64_CHARS) return 'Photo is too large. Please use a smaller image.';
  const match = DATA_URI_RE.exec(dataUri);
  if (!match) return 'Photo must be a valid image.';
  const head = Buffer.from(match[2].slice(0, 32), 'base64');
  if (!matchesSignature(match[1], head)) return 'Photo must be a valid image.';
  return null;
}

// JPEG: removes APP1-APP15 (EXIF, XMP, ICC...) and COM segments; APP0/JFIF
// and the image data itself are kept.
function stripJpegMetadata(b64) {
  const buf = Buffer.from(b64, 'base64');
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;

  const parts = [buf.subarray(0, 2)];
  let pos = 2;
  while (pos + 4 <= buf.length && buf[pos] === 0xff) {
    const marker = buf[pos + 1];
    if (marker === 0xda) break; // start of scan: everything from here is pixel data
    const segmentEnd = pos + 2 + buf.readUInt16BE(pos + 2);
    if (segmentEnd > buf.length) break;
    const isMetadata = (marker >= 0xe1 && marker <= 0xef) || marker === 0xfe;
    if (!isMetadata) parts.push(buf.subarray(pos, segmentEnd));
    pos = segmentEnd;
  }
  parts.push(buf.subarray(pos));
  return 'data:image/jpeg;base64,' + Buffer.concat(parts).toString('base64');
}

// PNG: drops the text and metadata chunks (tEXt/zTXt/iTXt can hold
// anything a camera app or editor wrote, eXIf holds full EXIF including
// GPS, tIME the last-modified date). Every chunk carries its own CRC, so
// removing whole chunks leaves the rest of the file valid.
const PNG_METADATA_CHUNKS = new Set(['tEXt', 'zTXt', 'iTXt', 'eXIf', 'tIME']);
function stripPngMetadata(b64) {
  const buf = Buffer.from(b64, 'base64');
  if (buf.length < 8 || buf.readUInt32BE(0) !== 0x89504e47) return null;

  const parts = [buf.subarray(0, 8)];
  let pos = 8;
  let sawEnd = false;
  while (pos + 12 <= buf.length) {
    const length = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const chunkEnd = pos + 12 + length;
    if (chunkEnd > buf.length) return null; // malformed - leave the original untouched
    if (!PNG_METADATA_CHUNKS.has(type)) parts.push(buf.subarray(pos, chunkEnd));
    pos = chunkEnd;
    if (type === 'IEND') {
      sawEnd = true;
      break;
    }
  }
  if (!sawEnd) return null; // truncated file - leave the original untouched
  return 'data:image/png;base64,' + Buffer.concat(parts).toString('base64');
}

// WebP/GIF pass through unchanged: the app's own client only ever uploads
// canvas-exported JPEGs, which carry no metadata to begin with.
function stripImageMetadata(dataUri) {
  const match = DATA_URI_RE.exec(dataUri || '');
  if (!match) return dataUri;
  const type = match[1];
  let stripped = null;
  if (type === 'jpeg' || type === 'jpg') stripped = stripJpegMetadata(match[2]);
  else if (type === 'png') stripped = stripPngMetadata(match[2]);
  return stripped || dataUri;
}

module.exports = { stripImageMetadata, validateImageDataUri };
