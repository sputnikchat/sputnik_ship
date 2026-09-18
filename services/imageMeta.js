// Server-side metadata strip for uploaded photos. The client already
// re-encodes through a canvas (which drops EXIF), but a caller can POST a
// data URI directly, so the server never trusts that: every JPEG that gets
// stored goes through here first. Removes APP1-APP15 (EXIF, XMP, ICC...)
// and COM segments; APP0/JFIF and the image data itself are kept. PNG/WebP/
// GIF pass through unchanged (they carry no EXIF from a canvas export).
function stripImageMetadata(dataUri) {
  const match = /^data:image\/jpe?g;base64,([A-Za-z0-9+/]+=*)$/.exec(dataUri || '');
  if (!match) return dataUri;
  const buf = Buffer.from(match[1], 'base64');
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return dataUri;

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

module.exports = { stripImageMetadata };
