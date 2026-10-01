const rateLimit = require('express-rate-limit');

// For routes that check the account's current password (change password,
// new recovery code, delete account). They sit behind a session, so the
// per-IP login limits don't cover them - and someone holding a stolen
// session could otherwise use them to guess the real password at the
// global API rate. Counted per account, not per IP.
const passwordCheckLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  keyGenerator: (req) => `user:${req.user.id}`,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please wait a few minutes and try again.' },
});

module.exports = { passwordCheckLimiter };
