// Runs in <head>, before first paint (an external file so the CSP can keep
// forbidding inline scripts). A signed-in visit gets the logo splash while
// the rest of the scripts load, instead of the login hero flashing past;
// app.js clears the class the moment it has decided what to show.
try {
  if (localStorage.getItem('sputnikship_token') && localStorage.getItem('sputnikship_user') && !/^\/s\//.test(location.pathname)) {
    document.documentElement.classList.add('boot-app');
  }
} catch (e) { /* storage blocked: boot straight to the login screen */ }
