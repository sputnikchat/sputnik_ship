// Field-level encryption at rest for the shipment's most sensitive fields
// (photo, declared value) - protects against someone reading the raw
// Supabase database (a leaked DATABASE_URL, a backup, a compromised
// Supabase account), not against the Sputnik Ship server itself. That's a
// deliberate, honest scope: real end-to-end encryption (where even this
// server can never read the data) would also have to cover the
// server-generated system messages in the chat, which by definition are
// authored by the server - the two goals conflict, so this picks the one
// that's actually achievable without redesigning the chat.
//
// AES-256-GCM with a single server-held key (ENCRYPTION_KEY in .env, same
// pattern as JWT_SECRET). Each value gets a fresh random IV; the GCM auth
// tag is stored alongside the ciphertext so tampering is detectable, not
// just invisible.

const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const PREFIX = 'enc:v1:';

const KEY_HEX = process.env.ENCRYPTION_KEY;
if (!KEY_HEX || Buffer.from(KEY_HEX, 'hex').length !== 32) {
  throw new Error(
    'ENCRYPTION_KEY is not set (or isn\'t a 32-byte hex string). Generate one with: ' +
      `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))" and put it in your .env.`
  );
}
const KEY = Buffer.from(KEY_HEX, 'hex');

// Returns the plain value unchanged for null/undefined/empty string, so
// callers don't need an if-check at every use site.
function encryptField(plaintext) {
  if (plaintext === null || plaintext === undefined || plaintext === '') return plaintext;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, KEY, iv);
  const ciphertext = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString('base64')}:${authTag.toString('base64')}:${ciphertext.toString('base64')}`;
}

// Values written before this feature shipped are still plain text in the
// database - passing those through unchanged (instead of throwing) means
// old shipments keep working without a data migration.
function decryptField(value) {
  if (typeof value !== 'string' || !value.startsWith(PREFIX)) return value;
  const [ivB64, tagB64, dataB64] = value.slice(PREFIX.length).split(':');
  const iv = Buffer.from(ivB64, 'base64');
  const authTag = Buffer.from(tagB64, 'base64');
  const ciphertext = Buffer.from(dataB64, 'base64');
  const decipher = crypto.createDecipheriv(ALGORITHM, KEY, iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString('utf8');
}

module.exports = { encryptField, decryptField };
