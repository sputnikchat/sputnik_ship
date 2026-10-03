// Hero globe: a dotted Earth behind the phone with shipment routes arcing
// between real hubs and a packet of light riding each one. Tablets and up
// (>640px), loaded after the page is idle (three.js is ~170 KB over the
// wire), and never for prefers-reduced-motion or without WebGL - phones and
// everyone else keep the static SVG routes.
const hero = document.querySelector('.hero');
const bg = hero && hero.querySelector('.hero-bg');
const wide = matchMedia('(min-width: 641px)').matches;
// Two-column hero: the globe sits top-right; single column (<=1024px): it
// rises behind the phone, which then sits under the text.
const twoCol = matchMedia('(min-width: 1025px)').matches;
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

function webgl() {
  try { return !!document.createElement('canvas').getContext('webgl2'); } catch (e) { return false; }
}

if (bg && wide && !reduce && webgl()) {
  const start = () => import('/vendor/three/three.module.min.js').then(build).catch(() => {});
  if ('requestIdleCallback' in window) requestIdleCallback(start, { timeout: 2500 }); else setTimeout(start, 1200);
}

// [lat, lon]
const HUB = {
  ny: [40.64, -73.78], paris: [49.01, 2.55], madrid: [40.47, -3.56], bcn: [41.3, 2.08],
  london: [51.47, -0.45], dubai: [25.25, 55.36], hk: [22.31, 113.91], szx: [22.64, 113.81],
  sin: [1.36, 103.99], tokyo: [35.55, 139.78], la: [33.94, -118.41], mex: [19.44, -99.07],
  gru: [-23.43, -46.47], lagos: [6.58, 3.32], syd: [-33.94, 151.18], mia: [25.79, -80.29],
  ein: [51.45, 5.37],
};
// Mostly medium-haul legs: ocean-spanning arcs (Tokyo-NY) loop far off the
// globe's silhouette and read as noise.
const ROUTES = [
  ['ny', 'paris'], ['dubai', 'london'], ['gru', 'bcn'], ['mia', 'mex'], ['lagos', 'paris'],
  ['ein', 'bcn'], ['ny', 'madrid'], ['hk', 'sin'], ['tokyo', 'hk'], ['la', 'mex'], ['sin', 'syd'],
];

function build(THREE) {
  const canvas = document.createElement('canvas');
  canvas.className = 'globe';
  canvas.setAttribute('aria-hidden', 'true');
  const stage = hero.querySelector('.stage');
  if (twoCol || !stage) bg.appendChild(canvas); else stage.prepend(canvas);

  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 20);
  camera.position.set(0, 0, 4.2);

  const globe = new THREE.Group();
  globe.rotation.x = 0.8; // tilt the north toward the viewer so the mid-latitude routes ride above the phone
  scene.add(globe);

  const toVec = ([lat, lon], r = 1) => {
    const phi = (90 - lat) * Math.PI / 180, th = (lon + 180) * Math.PI / 180;
    return new THREE.Vector3(-r * Math.sin(phi) * Math.cos(th), r * Math.cos(phi), r * Math.sin(phi) * Math.sin(th));
  };

  // Dark body that hides the far side's dots and arcs.
  globe.add(new THREE.Mesh(new THREE.SphereGeometry(0.992, 64, 48), new THREE.MeshBasicMaterial({ color: 0x07080d })));

  // Evenly spread dots (Fibonacci sphere) - a calm graticule, no coastline data needed.
  const N = 2200, dots = new Float32Array(N * 3), golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < N; i++) {
    const y = 1 - (i / (N - 1)) * 2, r = Math.sqrt(1 - y * y), a = golden * i;
    dots.set([Math.cos(a) * r, y, Math.sin(a) * r], i * 3);
  }
  const dotGeo = new THREE.BufferGeometry();
  dotGeo.setAttribute('position', new THREE.BufferAttribute(dots, 3));
  globe.add(new THREE.Points(dotGeo, new THREE.PointsMaterial({ color: 0x8a90b8, size: 0.015, transparent: true, opacity: 0.7, depthWrite: false })));

  // Indigo rim: a fresnel shell slightly larger than the body.
  globe.add(new THREE.Mesh(new THREE.SphereGeometry(1.06, 64, 48), new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.BackSide, blending: THREE.AdditiveBlending,
    uniforms: { c: { value: new THREE.Color(0x5e6ad2) } },
    vertexShader: 'varying vec3 n; void main(){ n = normalize(normalMatrix * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }',
    fragmentShader: 'uniform vec3 c; varying vec3 n; void main(){ float f = pow(0.62 - dot(n, vec3(0.,0.,1.)), 4.); gl_FragColor = vec4(c, 1.) * f * 0.55; }',
  })));

  // Hubs.
  const hubPos = new Float32Array(Object.keys(HUB).length * 3);
  Object.values(HUB).forEach((ll, i) => hubPos.set(toVec(ll, 1.003).toArray(), i * 3));
  const hubGeo = new THREE.BufferGeometry();
  hubGeo.setAttribute('position', new THREE.BufferAttribute(hubPos, 3));
  globe.add(new THREE.Points(hubGeo, new THREE.PointsMaterial({ color: 0xc3c8f0, size: 0.03, transparent: true, opacity: 0.9 })));

  // Routes: a great-circle arc lifted off the surface, built as a thin tube
  // (WebGL lines are always 1px - too faint to read on the dark globe).
  const SEG = 64, RADIAL = 6;
  const arcs = ROUTES.map(([from, to]) => {
    const a = toVec(HUB[from]), b = toVec(HUB[to]);
    const lift = 0.025 + a.angleTo(b) * 0.06;
    const pts = [];
    for (let i = 0; i <= SEG; i++) {
      const t = i / SEG;
      pts.push(new THREE.Vector3().copy(a).lerp(b, t).normalize().multiplyScalar(1 + Math.sin(Math.PI * t) * lift));
    }
    const geo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), SEG, 0.004, RADIAL, false);
    geo.setDrawRange(0, 0);
    const line = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xa99cff, transparent: true, opacity: 0, depthWrite: false }));
    const pkt = new THREE.Points(new THREE.BufferGeometry().setFromPoints([pts[0]]), new THREE.PointsMaterial({ color: 0x3ecf8e, size: 0.05, transparent: true, opacity: 0 }));
    pkt.frustumCulled = false; // its single vertex moves; the cached bounds don't
    globe.add(line, pkt);
    return { pts, line, pkt, born: -1 };
  });

  // One new route every 1.3 s; each draws in, carries its packet, fades out.
  const LIFE = 7, DRAW = 1.6;
  let next = 0, last = 0, clock = 0, spin = 0, scrollSpin = 0;
  function tickArcs(t) {
    if (t - last > 1.3) { arcs[next].born = t; next = (next + 1) % arcs.length; last = t; }
    for (const arc of arcs) {
      if (arc.born < 0) continue;
      const age = t - arc.born;
      if (age > LIFE) { arc.born = -1; arc.line.material.opacity = 0; arc.pkt.material.opacity = 0; continue; }
      const drawn = Math.min(1, age / DRAW), fade = age > LIFE - 1 ? LIFE - age : 1;
      arc.line.geometry.setDrawRange(0, Math.round(drawn * SEG) * RADIAL * 6);
      arc.line.material.opacity = 0.85 * fade;
      const p = ((age * 0.42) % 1);
      arc.pkt.geometry.attributes.position.array.set(arc.pts[Math.round(p * SEG)].toArray());
      arc.pkt.geometry.attributes.position.needsUpdate = true;
      arc.pkt.material.opacity = drawn < 1 ? 0 : fade * Math.sin(Math.PI * p);
    }
  }

  function resize() {
    const s = canvas.clientWidth;
    if (!s) return;
    renderer.setSize(s, s, false);
    camera.aspect = 1;
    camera.updateProjectionMatrix();
  }
  addEventListener('resize', resize);
  resize();

  // Scrolling the hero away turns the globe and lets it sink.
  if (window.gsap && window.ScrollTrigger) {
    gsap.registerPlugin(ScrollTrigger);
    const st = { v: 0 };
    gsap.to(st, {
      v: 1, ease: 'none',
      scrollTrigger: { trigger: hero, start: 'top top', end: 'bottom top', scrub: 0.6 },
      onUpdate: () => {
        scrollSpin = st.v * 1.4;
        canvas.style.opacity = String(1 - st.v * 0.85);
        canvas.style.translate = `0 ${st.v * 120}px`;
      },
    });
  }

  let visible = true, prev = performance.now();
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; }).observe(hero);
  renderer.setAnimationLoop((now) => {
    const dt = Math.min(0.05, (now - prev) / 1000);
    prev = now;
    if (!visible || document.hidden) return;
    clock += dt;
    spin += dt * 0.03;
    globe.rotation.y = -1.45 + spin + scrollSpin;
    tickArcs(clock);
    renderer.render(scene, camera);
  });

  requestAnimationFrame(() => hero.classList.add('has-globe'));
}
