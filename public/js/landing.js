(function(){
  document.documentElement.classList.add('js');
  var reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (!reduce) document.documentElement.classList.add('motion');

  // scroll reveal - items inside a group (cards, features, story rows)
  // arrive one after another instead of all at once
  ['.cards', '.fgrid', '.story .srow', '.cta .wrap', '.signal .wrap'].forEach(function(sel){
    document.querySelectorAll(sel).forEach(function(group){
      var items = group.querySelectorAll(':scope > .rv');
      items.forEach(function(el, i){ el.style.transitionDelay = Math.min(i, 6) * 80 + 'ms'; });
    });
  });
  var els = document.querySelectorAll('.rv');
  if ('IntersectionObserver' in window && !reduce) {
    var io = new IntersectionObserver(function(en){ en.forEach(function(e){ if(e.isIntersecting){ e.target.classList.add('in'); io.unobserve(e.target);} }); },{threshold:.12, rootMargin:'0px 0px -6% 0px'});
    els.forEach(function(el){ io.observe(el); });
    var tr = document.getElementById('track');
    var io2 = new IntersectionObserver(function(en){ en.forEach(function(e){ if(e.isIntersecting){ tr.classList.add('inview'); io2.disconnect(); } }); },{threshold:.3});
    io2.observe(tr);
  } else {
    els.forEach(function(el){ el.classList.add('in'); });
    document.getElementById('track').classList.add('inview');
  }
  // hero elements visible at rest
  document.querySelectorAll('.hero .rv').forEach(function(el){ el.classList.add('in'); });

  // world map (North Atlantic, dot-matrix continents) behind the route
  (function drawMap(){
    var cv = document.querySelector('.mapcanvas'); if(!cv) return;
    var ctx = cv.getContext('2d'), W = cv.width, H = cv.height, s = 2;
    function X(lon){ return (lon+100)*2.89*s; } function Y(lat){ return (70-lat)*4.545*s; }
    ctx.fillStyle = '#0a0c14'; ctx.fillRect(0,0,W,H);
    // graticule
    ctx.strokeStyle = 'rgba(255,255,255,.045)'; ctx.lineWidth = 1;
    for(var lon=-100; lon<=30; lon+=10){ ctx.beginPath(); ctx.moveTo(X(lon),0); ctx.lineTo(X(lon),H); ctx.stroke(); }
    for(var lat=20; lat<=70; lat+=10){ ctx.beginPath(); ctx.moveTo(0,Y(lat)); ctx.lineTo(W,Y(lat)); ctx.stroke(); }
    var land = [
      [[-100,72],[-85,70],[-75,64],[-64,60],[-56,52],[-53,47],[-60,46],[-66,44.5],[-70,42],[-74,40.5],[-75.5,38],[-76,35],[-79,33],[-81,30],[-80,25.5],[-82,27],[-84,30],[-89,30],[-94,29],[-97.5,26],[-100,20]],
      [[-56,60],[-44,60],[-40,65],[-22,70],[-20,74],[-60,74]],
      [[-24,63.5],[-14,64],[-13,66],[-22,66.5]],
      [[-5.5,50],[1.5,51],[1.7,53],[-2,56],[-3,58.6],[-6.2,58],[-5,54.5],[-3.2,53.5],[-5,51.5]],
      [[-10.3,51.6],[-6,52],[-5.5,55],[-8,55.3],[-10.3,54]],
      [[-9.5,43.5],[-1.5,43.4],[-2,47],[-4.7,48.5],[-1.5,49.6],[2,51],[4.5,53.2],[8.5,54],[8.2,57],[10.5,57.7],[12.5,56],[13,55.5],[18,58.5],[22,63],[25,65.5],[30,70],[30,45],[18,40],[16,38],[12,42],[10,44],[7,43.7],[3.5,43.3],[3,42],[0,38.5],[-2,36.7],[-6,36],[-9,37]],
      [[-17,14],[-17,21],[-13,28],[-10,31],[-6,35.5],[-2,35],[10,37],[11,33],[20,31],[30,31],[30,14]],
      [[-85,22],[-75,20],[-74,21.5],[-84,23]]
    ];
    ctx.save();
    ctx.beginPath();
    land.forEach(function(poly){ poly.forEach(function(pt,i){ i?ctx.lineTo(X(pt[0]),Y(pt[1])):ctx.moveTo(X(pt[0]),Y(pt[1])); }); ctx.closePath(); });
    ctx.fillStyle = '#12141f'; ctx.fill();
    ctx.clip();
    ctx.fillStyle = 'rgba(160,166,190,.42)';
    for(var y=3; y<H; y+=6*s){ for(var x=3; x<W; x+=6*s){ ctx.beginPath(); ctx.arc(x,y,1.3*s,0,6.283); ctx.fill(); } }
    ctx.restore();
    // coast glow
    ctx.beginPath();
    land.forEach(function(poly){ poly.forEach(function(pt,i){ i?ctx.lineTo(X(pt[0]),Y(pt[1])):ctx.moveTo(X(pt[0]),Y(pt[1])); }); ctx.closePath(); });
    ctx.strokeStyle = 'rgba(139,124,246,.22)'; ctx.lineWidth = 1.2*s; ctx.stroke();
    // vignette
    var g = ctx.createRadialGradient(W*0.5,H*0.35,H*0.2,W*0.5,H*0.35,W*0.75);
    g.addColorStop(0,'rgba(7,8,12,0)'); g.addColorStop(1,'rgba(7,8,12,.55)');
    ctx.fillStyle = g; ctx.fillRect(0,0,W,H);
  })();

  // command bar demo: typewriter, then result
  var cmd = document.getElementById('cmd'), input = document.getElementById('tn'), form = document.getElementById('cmd-form');
  var demo = '7749 0213 8850', typing = true, i = 0;
  function type(){
    if(!typing) return;
    if(i <= demo.length){ input.value = demo.slice(0,i); i++; setTimeout(type, 70 + Math.random()*60); }
    else { setTimeout(function(){ if(typing) cmd.classList.add('open'); }, 350); }
  }
  if(!reduce){ setTimeout(type, 900); } else { input.value = demo; cmd.classList.add('open'); }
  input.addEventListener('focus', function(){ typing = false; });
  input.addEventListener('input', function(){ typing = false; cmd.classList.remove('open'); });
  // A real number goes to the app, which opens the new-shipment form with
  // it filled in (see showApp in app.js); the fake "found" result above is
  // only ever shown for the demo number that types itself.
  form.addEventListener('submit', function(e){
    e.preventDefault(); typing = false;
    var v = input.value.trim();
    location.href = v && v !== demo ? '/app?track=' + encodeURIComponent(v) : '/app';
  });

  // ---------- motion helpers ----------
  function easeInOut(t){ return t < .5 ? 4*t*t*t : 1 - Math.pow(-2*t + 2, 3) / 2; }
  // Runs fn(progress) over ms on animation frames; resolves when done.
  function tween(ms, fn){
    return new Promise(function(done){
      var start = null;
      function step(now){
        if (start === null) start = now;
        var t = Math.min(1, (now - start) / ms);
        fn(t);
        if (t < 1) requestAnimationFrame(step); else done();
      }
      requestAnimationFrame(step);
    });
  }
  function wait(ms){ return new Promise(function(r){ setTimeout(r, ms); }); }
  // Only animate what's on screen and in a visible tab.
  function watchVisible(el, cb){
    if (!('IntersectionObserver' in window)) { cb(true); return; }
    new IntersectionObserver(function(en){ en.forEach(function(e){ cb(e.isIntersecting); }); }, { threshold: .15 }).observe(el);
  }
  var tabVisible = !document.hidden;
  document.addEventListener('visibilitychange', function(){ tabVisible = !document.hidden; });

  // ---------- 2 · hero: the live route ----------
  (function heroRoute(){
    var svg = document.querySelector('.phone .map svg');
    if (!svg || reduce) return;
    var fill = svg.querySelector('.route-fill');
    var circles = svg.querySelectorAll('circle');
    var ring = svg.querySelector('.pin');           // pulsing halo
    var dot = ring && ring.nextElementSibling;      // white pin
    if (!fill || !ring || !dot || typeof fill.getTotalLength !== 'function') return;
    var total = fill.getTotalLength();
    // The traveled leg ends where the pin sits ("In flight · N. Atlantic").
    var px = +dot.getAttribute('cx'), py = +dot.getAttribute('cy'), best = 0, bestD = 1e9;
    for (var l = 0; l <= total; l += 2) { var q = fill.getPointAtLength(l); var d = (q.x-px)*(q.x-px)+(q.y-py)*(q.y-py); if (d < bestD) { bestD = d; best = l; } }
    var traveled = best;
    svg.parentNode.classList.add('js-route');
    fill.style.strokeDasharray = total + ' ' + total;
    fill.style.strokeDashoffset = total;
    function pinAt(len){ var q = fill.getPointAtLength(len); ring.setAttribute('cx', q.x); ring.setAttribute('cy', q.y); dot.setAttribute('cx', q.x); dot.setAttribute('cy', q.y); }
    pinAt(0);

    var tl = document.querySelectorAll('.phone .tl > div'), msg = document.querySelector('.phone .msg');
    var floats = document.querySelectorAll('.hero .float');
    var cur = document.querySelector('.phone .tl .cur');
    function on(el){ if (el) el.classList.add('on'); }
    // Every beat of the story lands in step with the pin.
    wait(500).then(function(){ on(floats[0]); on(tl[0]); return wait(500); })
      .then(function(){
        return tween(2600, function(t){
          var len = traveled * easeInOut(t);
          fill.style.strokeDashoffset = total - len;
          pinAt(len);
          if (t > .38) { on(tl[1]); on(floats[1]); }
        });
      })
      .then(function(){ on(cur); on(tl[3]); on(floats[2]); return wait(700); })
      .then(function(){ on(msg); packets(); });

    // Afterwards a small packet of light keeps travelling the flown leg
    // - the "live" in live tracking - only while the hero is on screen.
    function packets(){
      var ns = 'http://www.w3.org/2000/svg';
      var pk = document.createElementNS(ns, 'circle');
      pk.setAttribute('r', '2.6'); pk.setAttribute('class', 'pkt'); pk.style.opacity = 0;
      svg.insertBefore(pk, ring);
      var visible = true;
      watchVisible(svg, function(v){ visible = v; });
      (function loop(){
        if (!visible || !tabVisible) { setTimeout(loop, 600); return; }
        tween(1500, function(t){
          var q = fill.getPointAtLength(traveled * t);
          pk.setAttribute('cx', q.x); pk.setAttribute('cy', q.y);
          pk.style.opacity = t < .1 ? t * 10 : t > .85 ? (1 - t) / .15 : 1;
        }).then(function(){ setTimeout(loop, 2600); });
      })();
    }
  })();

  // Background routes behind the hero: the solid one draws in, then a
  // faint package drifts along each of them, on a slow loop.
  (function heroBackground(){
    var svg = document.querySelector('.hero-bg .route');
    if (!svg || reduce) return;
    var ns = 'http://www.w3.org/2000/svg';
    var paths = svg.querySelectorAll('path');
    var visible = true;
    watchVisible(document.querySelector('.hero'), function(v){ visible = v; });
    paths.forEach(function(path, i){
      if (typeof path.getTotalLength !== 'function') return;
      var L = path.getTotalLength();
      if (!path.classList.contains('route-line')) {
        path.style.strokeDasharray = L + ' ' + L;
        path.style.strokeDashoffset = L;
        tween(2400, function(t){ path.style.strokeDashoffset = L * (1 - easeInOut(t)); });
      }
      var pk = document.createElementNS(ns, 'circle');
      pk.setAttribute('r', i ? '2' : '2.6'); pk.setAttribute('class', 'bg-pkt');
      svg.appendChild(pk);
      var dur = i ? 16000 : 11000, offset = i ? .45 : 0, start = null;
      (function frame(now){
        if (visible && tabVisible) {
          if (start === null) start = now - offset * dur;
          var t = ((now - start) % dur) / dur;
          var q = path.getPointAtLength(L * t);
          pk.setAttribute('cx', q.x); pk.setAttribute('cy', q.y);
          pk.style.opacity = (Math.sin(Math.PI * t) * .8).toFixed(3);
        } else start = null;
        requestAnimationFrame(frame);
      })(performance.now());
    });
  })();

  // ---------- 3 · automatic demo: courier updates arrive one by one ----------
  (function trackDemo(){
    var box = document.querySelector('.card .status');
    if (!box || reduce) return;
    var rows = Array.prototype.slice.call(box.children);
    var typing = document.createElement('div');
    typing.className = 'typing'; typing.setAttribute('aria-hidden', 'true');
    typing.innerHTML = '<b></b><b></b><b></b>';
    box.classList.add('demo');
    box.appendChild(typing);
    var visible = false, running = false;
    watchVisible(box, function(v){ visible = v; if (v && !running) run(); });
    function run(){
      running = true;
      rows.forEach(function(r){ r.classList.remove('on-seen', 'on'); box.appendChild(r); });
      box.appendChild(typing);
      var i = 0;
      (function next(){
        if (i >= rows.length) {
          return wait(3600).then(function(){
            rows.forEach(function(r){ r.classList.remove('on-seen'); });
            return wait(500);
          }).then(function(){ running = false; if (visible) run(); });
        }
        box.insertBefore(typing, rows[i]);
        typing.classList.add('show');
        wait(i ? 650 : 350).then(function(){
          typing.classList.remove('show');
          rows.forEach(function(r){ r.classList.remove('on'); });
          rows[i].classList.add('on-seen');
          rows[i].classList.add('on'); // the newest update is the live one
          i++;
          box.appendChild(typing);
          return wait(700);
        }).then(next);
      })();
    }
  })();

  // The photo thread plays its conversation once, the first time it
  // scrolls into view.
  (function chatDemo(){
    var chat = document.querySelector('#photo .chat');
    if (!chat || reduce) return;
    var items = Array.prototype.slice.call(chat.children);
    chat.classList.add('demo');
    var typing = document.createElement('div');
    typing.className = 'typing'; typing.setAttribute('aria-hidden', 'true');
    typing.innerHTML = '<b></b><b></b><b></b>';
    var done = false;
    watchVisible(chat, function(v){
      if (!v || done) return;
      done = true;
      var i = 0;
      (function next(){
        if (i >= items.length) { typing.remove(); return; }
        var el = items[i];
        var theirs = el.classList.contains('them');
        var p = theirs ? (chat.insertBefore(typing, el), typing.classList.add('show'), wait(900)) : wait(i ? 500 : 200);
        p.then(function(){
          typing.classList.remove('show');
          if (typing.parentNode) typing.remove();
          el.classList.add('shown');
          i++;
          return wait(650);
        }).then(next);
      })();
    });
  })();

  // ---------- 4 · pointer spotlight on cards (real pointers only) ----------
  if (!reduce && matchMedia('(hover: hover) and (pointer: fine)').matches) {
    document.querySelectorAll('.card, .feat').forEach(function(el){
      var raf = 0, x = 0, y = 0;
      el.addEventListener('pointermove', function(e){
        var r = el.getBoundingClientRect(); x = e.clientX - r.left; y = e.clientY - r.top;
        if (!raf) raf = requestAnimationFrame(function(){ raf = 0; el.style.setProperty('--mx', x + 'px'); el.style.setProperty('--my', y + 'px'); });
      }, { passive: true });
    });
  }

  // Same service worker as the app, registered once the page is idle: the
  // next visit (and the jump to /app) opens from cache, even while the
  // server is still waking up.
  if ('serviceWorker' in navigator) {
    addEventListener('load', function(){
      setTimeout(function(){ navigator.serviceWorker.register('/service-worker.js').catch(function(){}); }, 2000);
    });
  }
})();
