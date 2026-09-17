const jwt = require('jsonwebtoken');

// Accepts the token from either place: an httpOnly cookie (the main web
// app, set by routes/auth.js - not readable by JS, so it survives an XSS
// bug that a header stashed in localStorage wouldn't) or an Authorization
// header (the browser extension and the public share page's own client,
// which aren't in a position to receive a same-site cookie from a plain
// login response the way the main app's own pages are).
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = (header.startsWith('Bearer ') ? header.slice(7) : null) || req.cookies?.sputnikship_token || null;
  if (!token) return res.status(401).json({ error: 'Not authenticated. Missing token.' });

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = payload; // { id, handle }
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token.' });
  }
}

module.exports = { requireAuth };
