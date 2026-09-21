// Small input-validation helpers shared by the routes. Everything in
// req.body is attacker-controlled: it can be a string, but also a number,
// an array, a nested object or a multi-megabyte blob. Without a type check
// a value like {"name": {"x": 1}} gets stored as-is and later crashes code
// that assumes a string (e.g. .localeCompare() while sorting), and without
// a length cap one request can bloat the single-row JSON document every
// other request has to read.
class ValidationError extends Error {}

// Optional text field: '' when missing, trimmed and capped at `max`
// characters when it's a string (a finite number is accepted as text),
// ValidationError for anything else.
function optionalText(value, max) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'number' && Number.isFinite(value)) value = String(value);
  if (typeof value !== 'string') throw new ValidationError('Invalid field format.');
  return value.trim().slice(0, max);
}

function requiredText(value, max, message) {
  const text = optionalText(value, max);
  if (!text) throw new ValidationError(message);
  return text;
}

module.exports = { ValidationError, optionalText, requiredText };
