const jwt = require('jsonwebtoken');
const { readDB, update } = require('../services/store');
const {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  createSession,
  findSession,
  rotate,
  setSessionCookies,
  clearSessionCookies,
} = require('../services/sessions');

// Accepts the access token from either place: an httpOnly cookie (the main
// web app, set by routes/auth.js - not readable by JS, so it survives an
// XSS bug that a header stashed in localStorage wouldn't) or an
// Authorization header (the browser extension, which isn't in a position
// to receive a same-site cookie from a plain login response).
//
// Access tokens last 15 minutes (see services/sessions.js). When the web
// app's one has expired, the refresh cookie is rotated right here and the
// request carries on - the page never notices.
function verify(token) {
  try {
    // Pinning the algorithm means a token can never talk the server into
    // verifying it some other way than the one it was signed with.
    return jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
  } catch (err) {
    return null;
  }
}

async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const bearer = header.startsWith('Bearer ') ? header.slice(7) : null;
  const token = bearer || req.cookies?.[ACCESS_COOKIE] || null;
  const payload = token ? verify(token) : null;

  try {
    if (payload) {
      const db = await readDB();
      const user = db.users.find((u) => u.id === payload.id);
      // A valid signature only proves the token was issued at some point,
      // not that it should still work: a deleted account, a token from
      // before a password change/recovery (tokenVersion), or a session
      // that was logged out / expired is rejected here.
      const versionOk = user && (user.tokenVersion || 0) === (payload.tv || 0);
      if (versionOk && payload.sid && findSession(user, payload.sid)) {
        req.user = { id: user.id, handle: user.handle, sessionId: payload.sid };
        return next();
      }
      if (versionOk && !payload.sid && !bearer) {
        // A 30-day cookie from before sessions existed: swap it for a real
        // session once, so nobody is logged out by this deploy.
        const fresh = await update((data) => {
          const u = data.users.find((x) => x.id === user.id);
          return u ? createSession(u, req.headers['user-agent']) : null;
        });
        if (fresh) {
          setSessionCookies(req, res, fresh);
          req.user = { id: user.id, handle: user.handle, sessionId: fresh.session.id };
          return next();
        }
      }
      if (versionOk && !payload.sid && bearer) {
        // Legacy extension token: still honoured until its own expiry
        // (at most 30 days); the extension moves to sessions at next login.
        req.user = { id: user.id, handle: user.handle };
        return next();
      }
    }

    // No usable access token: try the web app's refresh cookie.
    const refreshToken = !bearer && req.cookies?.[REFRESH_COOKIE];
    if (refreshToken) {
      // Password change/recovery wipe the user's sessions (routes/auth.js),
      // so a surviving session is always on the current tokenVersion.
      const rotated = await update((data) => {
        const r = rotate(data, refreshToken);
        return r && { ...r, user: { id: r.user.id, handle: r.user.handle } };
      });
      if (rotated) {
        setSessionCookies(req, res, rotated);
        const p = verify(rotated.accessToken);
        req.user = { id: rotated.user.id, handle: rotated.user.handle, sessionId: p?.sid };
        return next();
      }
      clearSessionCookies(req, res);
    }
  } catch (err) {
    console.error('Auth check could not reach the database:', err.message);
    return res.status(503).json({ error: 'Service temporarily unavailable. Please try again.' });
  }

  return res.status(401).json({ error: token ? 'Session expired. Please log in again.' : 'Not authenticated. Missing token.' });
}

module.exports = { requireAuth };
