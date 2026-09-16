// A "space" is the simple co-ownership model: every user starts solo (their
// own spaceId === their own id). Joining someone's invite code just points
// your spaceId at theirs - from then on, everyone sharing a spaceId sees
// and can manage the exact same contacts/shipments, and gets notified of
// the exact same status changes. No separate "household" entity, no
// per-item permissions - full parity between co-owners, matching the
// user's own call ("simple: co-owner of the account").

function spaceIdOf(user) {
  return user.spaceId || user.id;
}

// Returns every user id sharing `userId`'s space, `userId` included.
function getSpaceUserIds(db, userId) {
  const user = db.users.find((u) => u.id === userId);
  if (!user) return [userId];
  const spaceId = spaceIdOf(user);
  return db.users.filter((u) => spaceIdOf(u) === spaceId).map((u) => u.id);
}

module.exports = { spaceIdOf, getSpaceUserIds };
