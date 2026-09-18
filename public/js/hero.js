// Landing hero: dot-matrix North Atlantic map behind the NY → Paris route.
// Same drawing as docs/design/sputnik-hero.html; purely decorative.
(function () {
  var cv = document.querySelector('.hero-mapcanvas');
  if (!cv || !cv.getContext) return;
  var ctx = cv.getContext('2d'), W = cv.width, H = cv.height, s = 2;
  function X(lon) { return (lon + 100) * 2.89 * s; }
  function Y(lat) { return (70 - lat) * 4.545 * s; }
  ctx.fillStyle = '#0a0c14'; ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = 'rgba(255,255,255,.045)'; ctx.lineWidth = 1;
  for (var lon = -100; lon <= 30; lon += 10) { ctx.beginPath(); ctx.moveTo(X(lon), 0); ctx.lineTo(X(lon), H); ctx.stroke(); }
  for (var lat = 20; lat <= 70; lat += 10) { ctx.beginPath(); ctx.moveTo(0, Y(lat)); ctx.lineTo(W, Y(lat)); ctx.stroke(); }
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
  function trace() {
    ctx.beginPath();
    land.forEach(function (poly) {
      poly.forEach(function (pt, i) { i ? ctx.lineTo(X(pt[0]), Y(pt[1])) : ctx.moveTo(X(pt[0]), Y(pt[1])); });
      ctx.closePath();
    });
  }
  ctx.save(); trace(); ctx.fillStyle = '#12141f'; ctx.fill(); ctx.clip();
  ctx.fillStyle = 'rgba(160,166,190,.42)';
  for (var y = 3; y < H; y += 6 * s) { for (var x = 3; x < W; x += 6 * s) { ctx.beginPath(); ctx.arc(x, y, 1.3 * s, 0, 6.283); ctx.fill(); } }
  ctx.restore();
  trace(); ctx.strokeStyle = 'rgba(139,124,246,.22)'; ctx.lineWidth = 1.2 * s; ctx.stroke();
  var g = ctx.createRadialGradient(W * 0.5, H * 0.35, H * 0.2, W * 0.5, H * 0.35, W * 0.75);
  g.addColorStop(0, 'rgba(7,8,12,0)'); g.addColorStop(1, 'rgba(7,8,12,.55)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
})();
