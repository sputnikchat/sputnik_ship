// Landing gate: someone with an active session doesn't need the marketing
// page - send them straight to the app (same check app.js boots on).
(function () {
  try {
    if (localStorage.getItem('sputnikship_token') && localStorage.getItem('sputnikship_user')) {
      location.replace('/app' + location.search);
    }
  } catch (e) { /* storage blocked: just show the landing */ }
})();
