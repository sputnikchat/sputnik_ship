// Sessions: short-lived access tokens plus rotating refresh tokens.
//
// A login used to hand out one JWT that worked, unchanged, for 30 days -
// whoever got hold of it (a shared computer, a leaked cookie) kept access
// for that whole month and nothing could cut it short except a password
// change. Now:
// - the access token (JWT) lives 15 minutes;
// - a refresh token, stored only as a hash on the user's session, mints a
//   new access token and is itself replaced on every use (rotation);
// - presenting an already-rotated refresh token outside a short grace
//   window means it was copied - the whole session is revoked;
// - a session dies after 14 days unused and 30 days after login no matter
//   what, so nobody keeps access forever after logging in once;
// - logout, a password change/recovery and account deletion revoke sessions
//   server-side, and every request checks its session still exists.
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const ACCESS_TTL_SECONDS = 15 * 60;
const IDLE_MS = 14 * 24 * 60 * 60 * 1000;
const ABSOLUTE_MS = 30 * 24 * 60 * 60 * 1000;
// Several requests can leave the page at once with the same expired access
// token; the first rotates the refresh token, the others arrive holding the
// previous one. Within this window that's treated as a race, not a theft.
const ROTATION_GRACE_MS = 30 * 1000;
const MAX_SESSIONS_PER_USER = 10;

const ACCESS_COOKIE = 'sputnikship_token';
const REFRESH_COOKIE = 'sputnikship_refresh';

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const newSecret = () => crypto.randomBytes(32).toString('base64url');

function signAccess(user, sessionId) {
  return jwt.sign(
    // tv = the user's tokenVersion (bumped by password change/recovery);
    // sid = the session this token belongs to.
    { id: user.id, handle: user.handle, tv: user.tokenVersion || 0, sid: sessionId },
    process.env.JWT_SECRET,
    { algorithm: 'HS256', expiresIn: ACCESS_TTL_SECONDS }
  );
}

// The refresh token names its user and session so lookup doesn't scan
// every user; only the secret part is verified (against its hash).
function packRefresh(userId, sessionId, secret) {
  return `${userId}.${sessionId}.${secret}`;
}
function unpackRefresh(token) {
  const parts = typeof token === 'string' ? token.split('.') : [];
  if (parts.length !== 3 || parts.some((p) => !p)) return null;
  return { userId: parts[0], sessionId: parts[1], secret: parts[2] };
}

// Must run inside store.update(): mutates `user`.
function createSession(user, userAgent) {
  const now = Date.now();
  const secret = newSecret();
  const session = {
    id: crypto.randomUUID(),
    refreshHash: sha256(secret),
    prevRefreshHash: null,
    rotatedAt: now,
    createdAt: now,
    lastUsedAt: now,
    absoluteExpiresAt: now + ABSOLUTE_MS,
    userAgent: String(userAgent || '').slice(0, 120),
  };
  user.sessions = (user.sessions || []).filter((s) => isAlive(s, now));
  user.sessions.push(session);
  // Oldest sessions beyond the cap are dropped (logged out).
  if (user.sessions.length > MAX_SESSIONS_PER_USER) {
    user.sessions.sort((a, b) => a.lastUsedAt - b.lastUsedAt);
    user.sessions = user.sessions.slice(-MAX_SESSIONS_PER_USER);
  }
  return {
    accessToken: signAccess(user, session.id),
    refreshToken: packRefresh(user.id, session.id, secret),
    session,
  };
}

function isAlive(session, now = Date.now()) {
  return now < session.absoluteExpiresAt && now - session.lastUsedAt < IDLE_MS;
}

function findSession(user, sessionId) {
  const s = (user?.sessions || []).find((x) => x.id === sessionId);
  return s && isAlive(s) ? s : null;
}

// Must run inside store.update(). Returns { accessToken, refreshToken? }
// or null when the refresh token is invalid/expired/reused.
function rotate(data, refreshToken) {
  const parsed = unpackRefresh(refreshToken);
  if (!parsed) return null;
  const user = data.users.find((u) => u.id === parsed.userId);
  const session = (user?.sessions || []).find((s) => s.id === parsed.sessionId);
  const now = Date.now();
  if (!session || !isAlive(session, now)) return null;

  const hash = sha256(parsed.secret);
  if (hash === session.refreshHash) {
    const secret = newSecret();
    session.prevRefreshHash = session.refreshHash;
    session.refreshHash = sha256(secret);
    session.rotatedAt = now;
    session.lastUsedAt = now;
    return {
      user,
      accessToken: signAccess(user, session.id),
      refreshToken: packRefresh(user.id, session.id, secret),
    };
  }
  if (hash === session.prevRefreshHash) {
    if (now - session.rotatedAt < ROTATION_GRACE_MS) {
      // Concurrent request racing the rotation: it gets an access token,
      // but the refresh cookie already set by the winner stays in place.
      session.lastUsedAt = now;
      return { user, accessToken: signAccess(user, session.id), refreshToken: null };
    }
    // An old refresh token came back long after it was replaced: someone
    // has a copy. Kill the session for both holders.
    console.warn(`Refresh token reuse detected for user ${user.id}; session revoked.`);
  }
  user.sessions = user.sessions.filter((s) => s.id !== session.id);
  return null;
}

// Must run inside store.update(). Ends the session the refresh token
// belongs to - only if its secret checks out, so knowing a session's id
// isn't enough to log someone else out.
function revokeByRefresh(data, refreshToken) {
  const parsed = unpackRefresh(refreshToken);
  if (!parsed) return;
  const user = data.users.find((u) => u.id === parsed.userId);
  const hash = sha256(parsed.secret);
  const match = (s) => s.id === parsed.sessionId && (s.refreshHash === hash || s.prevRefreshHash === hash);
  if (user?.sessions?.some(match)) user.sessions = user.sessions.filter((s) => !match(s));
}

function cookieOptions(req, maxAgeMs, path = '/') {
  return { httpOnly: true, secure: req.secure, sameSite: 'lax', path, maxAge: maxAgeMs };
}

function setSessionCookies(req, res, { accessToken, refreshToken }) {
  res.cookie(ACCESS_COOKIE, accessToken, cookieOptions(req, ACCESS_TTL_SECONDS * 1000));
  // Only the API ever needs the refresh token, so the browser sends it
  // nowhere else.
  if (refreshToken) res.cookie(REFRESH_COOKIE, refreshToken, cookieOptions(req, IDLE_MS, '/api/'));
}

function clearSessionCookies(req, res) {
  const { maxAge, ...base } = cookieOptions(req, 0);
  res.clearCookie(ACCESS_COOKIE, base);
  res.clearCookie(REFRESH_COOKIE, { ...base, path: '/api/' });
}

module.exports = {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  createSession,
  findSession,
  rotate,
  revokeByRefresh,
  setSessionCookies,
  clearSessionCookies,
};
