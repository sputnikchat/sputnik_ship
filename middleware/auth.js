const jwt = require('jsonwebtoken');
const { readDB } = require('../services/store');

// Accepts the token from either place: an httpOnly cookie (the main web
// app, set by routes/auth.js - not readable by JS, so it survives an XSS
// bug that a header stashed in localStorage wouldn't) or an Authorization
// header (the browser extension and the public share page's own client,
// which aren't in a position to receive a same-site cookie from a plain
// login response the way the main app's own pages are).
async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = (header.startsWith('Bearer ') ? header.slice(7) : null) || req.cookies?.sputnikship_token || null;
  if (!token) return res.status(401).json({ error: 'Not authenticated. Missing token.' });

  let payload;
  try {
    // Pinning the algorithm means a token can never talk the server into
    // verifying it some other way than the one it was signed with.
    payload = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token.' });
  }

  // A valid signature only proves the token was issued at some point -
  // not that it should still work. A deleted account's token, or one
  // issued before a password change/recovery (the whole point of which
  // may be kicking out someone who had the old password), is rejected
  // here: every user carries a tokenVersion that those actions bump, and
  // each token records the version it was signed with. Tokens from
  // before this check existed carry no version and match a user who has
  // never bumped theirs, so nobody gets logged out by the deploy itself.
  try {
    const db = await readDB();
    const user = db.users.find((u) => u.id === payload.id);
    if (!user || (user.tokenVersion || 0) !== (payload.tv || 0)) {
      return res.status(401).json({ error: 'Session expired. Please log in again.' });
    }
  } catch (err) {
    console.error('Auth check could not reach the database:', err.message);
    return res.status(503).json({ error: 'Service temporarily unavailable. Please try again.' });
  }

  req.user = { id: payload.id, handle: payload.handle };
  next();
}

module.exports = { requireAuth };
