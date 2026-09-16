(() => {
'use strict';
const $ = id => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const wrapAngle = a => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };
const fmt = t => { if (t == null || !isFinite(t)) return '–'; const m = Math.floor(t / 60); const s = t - m * 60; return m + ':' + (s < 10 ? '0' : '') + s.toFixed(3); };

/* ---------------- Track definitions ---------------- */
function stadium() {
  const R = 120, S = 260, a = [[R, 0]];
  for (let i = 0; i <= 8; i++) { const t = i / 8 * Math.PI; a.push([R * Math.cos(t), -S - R * Math.sin(t)]); }
  a.push([-R, 0]);
  for (let i = 0; i <= 8; i++) { const t = i / 8 * Math.PI; a.push([-R * Math.cos(t), S + R * Math.sin(t)]); }
  return a;
}
const TRACKS = {
  oval: { name: 'Starter Oval', desc: 'Two straights, two long bends. Learn the car here.', width: 24, scale: 1, laps: 5, barrier: 9, pts: stadium() },
  monza: { name: 'Monza', desc: 'Flat-out straights broken by tight chicanes.', width: 18, scale: 1.25, laps: 3, barrier: 7,
    pts: [[0,300],[0,-250],[16,-282],[-6,-306],[6,-340],[40,-480],[120,-560],[220,-560],[252,-522],[238,-490],[266,-458],[322,-400],[340,-330],[382,-298],[432,-300],[452,-250],[440,-100],[420,20],[442,60],[410,100],[422,140],[400,300],[340,420],[220,452],[100,422],[30,370]] },
  monaco: { name: 'Monaco', desc: 'Narrow, walled, and unforgiving. Precision over power.', width: 14, scale: 1.7, laps: 3, barrier: 3.5,
    pts: [[0,0],[0,-120],[-20,-160],[40,-200],[120,-280],[160,-300],[200,-280],[210,-240],[180,-210],[200,-170],[170,-150],[150,-170],[130,-130],[150,-90],[260,-60],[330,-20],[310,20],[330,40],[260,80],[200,60],[160,90],[120,70],[80,110],[40,90],[20,40]] }
};

/* ---------------- Three.js setup ---------------- */
const SKY = 0x9fd3ef;
const scene = new THREE.Scene();
scene.background = new THREE.Color(SKY);
scene.fog = new THREE.Fog(SKY, 350, 2600);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.prepend(renderer.domElement);
const camera = new THREE.PerspectiveCamera(65, innerWidth / innerHeight, 0.3, 6000);
addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });

scene.add(new THREE.HemisphereLight(0xe6f6ff, 0x6f8f5e, 0.78));
const sun = new THREE.DirectionalLight(0xfff3dc, 0.95);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -70, right: 70, top: 70, bottom: -70, near: 1, far: 400 });
sun.shadow.bias = -0.0008;
scene.add(sun, sun.target);

const M = (c, o) => new THREE.MeshStandardMaterial(Object.assign({ color: c, flatShading: true, roughness: 0.85, metalness: 0 }, o || {}));
const VCOL = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.9, side: THREE.DoubleSide });

const ground = new THREE.Mesh(new THREE.PlaneGeometry(9000, 9000), M(0xb7dd98));
ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);

/* ---------------- Track building ---------------- */
let track = null;
function buildTrack(key) {
  if (track) { scene.remove(track.group); track.group.traverse(o => { if (o.geometry) o.geometry.dispose(); }); }
  const def = TRACKS[key];
  const pts = def.pts.map(([x, z]) => new THREE.Vector3(x * def.scale, 0, z * def.scale));
  const curve = new THREE.CatmullRomCurve3(pts, true, 'centripetal');
  const L = curve.getLength();
  const N = Math.max(300, Math.round(L / 2));
  const sp = curve.getSpacedPoints(N);
  const P = [], T = [], Nrm = [];
  for (let i = 0; i < N; i++) P.push(new THREE.Vector3(sp[i].x, 0, sp[i].z));
  for (let i = 0; i < N; i++) {
    const t = new THREE.Vector3().subVectors(P[(i + 1) % N], P[(i - 1 + N) % N]).setY(0).normalize();
    T.push(t); Nrm.push(new THREE.Vector3(t.z, 0, -t.x));
  }
  const step = L / N;
  const k = Math.max(2, Math.round(7 / step));
  const kappa = [], vCorner = [];
  for (let i = 0; i < N; i++) {
    const ta = T[(i - k + N) % N], tb = T[(i + k) % N];
    const d = Math.abs(wrapAngle(Math.atan2(tb.x, tb.z) - Math.atan2(ta.x, ta.z)));
    const kap = d / (2 * k * step);
    kappa.push(kap);
    const R = kap > 1e-5 ? 1 / kap : 1e5;
    vCorner.push(clamp((R - 6.4) / 0.534, 12, 120));
  }
  const vc2 = vCorner.slice();
  for (let i = 0; i < N; i++) { let m = vCorner[i]; for (let j = -k; j <= k; j++) m = Math.min(m, vCorner[(i + j + N) % N]); vc2[i] = m; }

  const t = { key, def, curve, L, N, step, P, T, Nrm, kappa, vCorner: vc2, width: def.width, half: def.width / 2, barrier: def.barrier, group: new THREE.Group() };
  const half = t.half, kerbW = 1.6;

  const strip = (a, b, y, colorFn) => {
    const pos = [], col = [], c3 = new THREE.Color();
    for (let i = 0; i < N; i++) {
      const c = colorFn(i); if (c == null) continue;
      const j = (i + 1) % N, pi = P[i], pj = P[j], ni = Nrm[i], nj = Nrm[j];
      const ax = pi.x + ni.x * a, az = pi.z + ni.z * a, bx = pi.x + ni.x * b, bz = pi.z + ni.z * b;
      const cx = pj.x + nj.x * a, cz = pj.z + nj.z * a, dx = pj.x + nj.x * b, dz = pj.z + nj.z * b;
      pos.push(ax, y, az, cx, y, cz, bx, y, bz, bx, y, bz, cx, y, cz, dx, y, dz);
      c3.set(c); for (let q = 0; q < 6; q++) col.push(c3.r, c3.g, c3.b);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, VCOL); m.receiveShadow = true; t.group.add(m); return m;
  };
  const wall = (off, y0, y1, colorFn) => {
    const pos = [], col = [], c3 = new THREE.Color();
    for (let i = 0; i < N; i++) {
      const j = (i + 1) % N, pi = P[i], pj = P[j], ni = Nrm[i], nj = Nrm[j];
      const ax = pi.x + ni.x * off, az = pi.z + ni.z * off, cx = pj.x + nj.x * off, cz = pj.z + nj.z * off;
      pos.push(ax, y0, az, cx, y0, cz, ax, y1, az, ax, y1, az, cx, y0, cz, cx, y1, cz);
      c3.set(colorFn(i)); for (let q = 0; q < 6; q++) col.push(c3.r, c3.g, c3.b);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, VCOL); m.castShadow = true; m.receiveShadow = true; t.group.add(m);
  };

  const b = half + t.barrier;
  strip(half + kerbW, b, 0.03, () => '#d8dcc6');
  strip(-b, -half - kerbW, 0.03, () => '#d8dcc6');
  strip(-half, half, 0.05, i => (Math.floor(i / 10) % 2 ? '#4b5362' : '#474f5d'));
  strip(half - 0.55, half - 0.25, 0.06, () => '#f4f6f8');
  strip(-half + 0.25, -half + 0.55, 0.06, () => '#f4f6f8');
  strip(-0.18, 0.18, 0.06, i => (i % 8 < 3 ? '#e8ecef' : null));
  const kerb = i => (kappa[i] > 1 / 140 ? (Math.floor(i / 2) % 2 ? '#e3313d' : '#f7f7f7') : '#9aa3ad');
  strip(half, half + kerbW, 0.07, kerb);
  strip(-half - kerbW, -half, 0.07, kerb);
  const bc = i => (Math.floor(i / 6) % 2 ? '#f2f4f7' : '#2f6fd6');
  [1, -1].forEach(s => {
    wall(s * b, 0, 1.3, bc); wall(s * (b + 0.8), 0, 1.3, bc);
    strip(Math.min(s * b, s * (b + 0.8)), Math.max(s * b, s * (b + 0.8)), 1.3, () => '#dfe4ea');
  });

  // start line + gantry
  const h0 = Math.atan2(T[0].x, T[0].z);
  const cv = document.createElement('canvas'); cv.width = 128; cv.height = 32;
  const cx = cv.getContext('2d');
  for (let x = 0; x < 16; x++) for (let y = 0; y < 4; y++) { cx.fillStyle = (x + y) % 2 ? '#111' : '#fff'; cx.fillRect(x * 8, y * 8, 8, 8); }
  const tex = new THREE.CanvasTexture(cv); tex.magFilter = THREE.NearestFilter;
  const line = new THREE.Mesh(new THREE.PlaneGeometry(t.width, 2.4), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 }));
  line.rotation.order = 'YXZ'; line.rotation.set(-Math.PI / 2, h0, 0);
  line.position.set(P[0].x, 0.08, P[0].z); line.receiveShadow = true; t.group.add(line);
  const gantry = new THREE.Group();
  const gm = M(0x2b3440), gw = t.width + 6;
  [-1, 1].forEach(s => { const p = new THREE.Mesh(new THREE.BoxGeometry(0.7, 9, 0.7), gm); p.position.set(s * gw / 2, 4.5, 0); p.castShadow = true; gantry.add(p); });
  const beam = new THREE.Mesh(new THREE.BoxGeometry(gw, 1.6, 1), M(0xe3313d)); beam.position.y = 9; beam.castShadow = true; gantry.add(beam);
  gantry.rotation.y = h0; gantry.position.copy(P[0]); t.group.add(gantry);
  // grandstand beside the start straight, facing the track
  const gs = new THREE.Group();
  for (let r = 0; r < 4; r++) {
    const s = new THREE.Mesh(new THREE.BoxGeometry(70, 2.2 + r * 2.2, 5), M([0xf2f4f7, 0x3d8bff, 0xf2f4f7, 0xffc23d][r]));
    s.position.set(0, (2.2 + r * 2.2) / 2, -r * 5); s.castShadow = true; s.receiveShadow = true; gs.add(s);
  }
  const gOff = -(b + 10);
  gs.position.set(P[0].x + Nrm[0].x * gOff, 0, P[0].z + Nrm[0].z * gOff);
  const toTrack = new THREE.Vector3().subVectors(P[0], gs.position).normalize();
  gs.rotation.y = Math.atan2(toTrack.x, toTrack.z);
  t.group.add(gs);

  // scenery
  let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
  P.forEach(p => { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z); });
  const treeGeo = new THREE.ConeGeometry(4, 11, 6), trunkGeo = new THREE.CylinderGeometry(0.6, 0.8, 3, 5);
  const leafM = [M(0x4f9a52), M(0x3f8a4a), M(0x6db35a)], trunkM = M(0x7a5a3c);
  const clear = b + 10;
  let placed = 0, tries = 0;
  while (placed < 170 && tries < 3000) {
    tries++;
    const x = minX - 220 + Math.random() * (maxX - minX + 440), z = minZ - 220 + Math.random() * (maxZ - minZ + 440);
    let ok = true;
    for (let i = 0; i < N; i += 3) { const dx = P[i].x - x, dz = P[i].z - z; if (dx * dx + dz * dz < clear * clear) { ok = false; break; } }
    if (!ok) continue;
    const s = 0.7 + Math.random() * 0.8;
    const tr = new THREE.Mesh(treeGeo, leafM[placed % 3]); tr.position.set(x, 1.5 * s + 5.5 * s, z); tr.scale.setScalar(s); tr.castShadow = true;
    const tk = new THREE.Mesh(trunkGeo, trunkM); tk.position.set(x, 1.5 * s, z); tk.scale.setScalar(s);
    t.group.add(tr, tk); placed++;
  }
  const cxm = (minX + maxX) / 2, czm = (minZ + maxZ) / 2;
  const hillM = [M(0x8fb6a8), M(0x7ea79c), M(0x9cc0b3)];
  for (let i = 0; i < 28; i++) {
    const a = i / 28 * Math.PI * 2 + Math.random() * 0.1, r = 1900 + Math.random() * 500;
    const h = 120 + Math.random() * 220;
    const hill = new THREE.Mesh(new THREE.ConeGeometry(160 + Math.random() * 140, h, 5), hillM[i % 3]);
    hill.position.set(cxm + Math.cos(a) * r, h / 2 - 5, czm + Math.sin(a) * r); hill.rotation.y = Math.random() * 3;
    t.group.add(hill);
  }

  // fuel burn tuned so Standard lasts ~1.1 race distances
  const estTime = L * def.laps / 52;
  t.burn = 130 / estTime;
  scene.add(t.group);
  track = t;
}

function sampleAt(s) {
  const t = track, u = ((s % t.L) + t.L) % t.L, f = u / t.step, i = Math.floor(f) % t.N, j = (i + 1) % t.N, a = f - Math.floor(f);
  return {
    i,
    pos: new THREE.Vector3().lerpVectors(t.P[i], t.P[j], a),
    tan: new THREE.Vector3().lerpVectors(t.T[i], t.T[j], a).normalize(),
    nrm: new THREE.Vector3().lerpVectors(t.Nrm[i], t.Nrm[j], a).normalize()
  };
}
function nearest(pos, hint) {
  const t = track; let best = -1, bd = Infinity;
  const scan = i => { const p = t.P[i], dx = p.x - pos.x, dz = p.z - pos.z, d = dx * dx + dz * dz; if (d < bd) { bd = d; best = i; } };
  if (hint < 0) for (let i = 0; i < t.N; i++) scan(i);
  else for (let o = -45; o <= 45; o++) scan((hint + o + t.N) % t.N);
  const p = t.P[best], n = t.Nrm[best];
  return { i: best, lat: (pos.x - p.x) * n.x + (pos.z - p.z) * n.z };
}

/* ---------------- Car model ---------------- */
function makeCar(color, accent) {
  const g = new THREE.Group();
  const body = M(color, { roughness: 0.55 }), dark = M(0x1b1e24), acc = M(accent, { roughness: 0.55 }), tyre = M(0x16181c, { roughness: 1 }), rim = M(0xb8c0c8);
  const add = (geo, m, x, y, z, parent) => { const me = new THREE.Mesh(geo, m); me.position.set(x, y, z); me.castShadow = true; (parent || g).add(me); return me; };
  add(new THREE.BoxGeometry(1.7, 0.12, 4.4), dark, 0, 0.2, -0.1);           // floor
  add(new THREE.BoxGeometry(0.82, 0.46, 3.0), body, 0, 0.5, 0.15);          // monocoque
  const nose = new THREE.CylinderGeometry(0.1, 0.42, 2.0, 4); nose.rotateX(Math.PI / 2); nose.rotateZ(Math.PI / 4); nose.scale(1, 0.55, 1);
  add(nose, body, 0, 0.42, 2.6);                                            // nosecone
  [-1, 1].forEach(s => {
    add(new THREE.BoxGeometry(0.5, 0.42, 1.7), body, s * 0.64, 0.44, -0.25); // sidepods
    add(new THREE.BoxGeometry(0.44, 0.3, 0.12), dark, s * 0.64, 0.5, 0.62);  // intakes
  });
  const cover = new THREE.CylinderGeometry(0.18, 0.4, 1.6, 4); cover.rotateX(-Math.PI / 2); cover.rotateZ(Math.PI / 4); cover.scale(1, 1.2, 1);
  add(cover, acc, 0, 0.72, -1.2);                                           // engine cover
  add(new THREE.BoxGeometry(0.32, 0.36, 0.55), dark, 0, 0.98, -0.45);       // airbox
  add(new THREE.BoxGeometry(0.52, 0.08, 0.8), dark, 0, 0.74, 0.55);         // cockpit
  add(new THREE.IcosahedronGeometry(0.22, 0), acc, 0, 0.9, 0.42);           // helmet
  add(new THREE.BoxGeometry(0.06, 0.06, 0.9), dark, 0, 1.12, 0.55);         // halo
  add(new THREE.BoxGeometry(2.1, 0.06, 0.55), acc, 0, 0.18, 3.25);          // front wing
  add(new THREE.BoxGeometry(1.9, 0.05, 0.3), acc, 0, 0.3, 3.05);
  [-1, 1].forEach(s => add(new THREE.BoxGeometry(0.05, 0.32, 0.65), dark, s * 1.05, 0.28, 3.2));
  [-1, 1].forEach(s => add(new THREE.BoxGeometry(0.06, 0.7, 0.8), dark, s * 0.74, 0.9, -2.3)); // rear endplates
  add(new THREE.BoxGeometry(0.1, 0.5, 0.3), dark, 0, 0.62, -2.2);
  add(new THREE.BoxGeometry(1.46, 0.07, 0.45), acc, 0, 0.9, -2.35);         // rear main plane
  const flapPivot = new THREE.Group(); flapPivot.position.set(0, 1.08, -2.12); g.add(flapPivot);
  add(new THREE.BoxGeometry(1.46, 0.05, 0.36), body, 0, 0, -0.18, flapPivot); // DRS flap
  flapPivot.rotation.x = 0.6;
  const wf = new THREE.CylinderGeometry(0.36, 0.36, 0.36, 10); wf.rotateZ(Math.PI / 2);
  const wr = new THREE.CylinderGeometry(0.4, 0.4, 0.46, 10); wr.rotateZ(Math.PI / 2);
  const hub = new THREE.CylinderGeometry(0.16, 0.16, 0.02, 6); hub.rotateZ(Math.PI / 2);
  const wheels = [], steers = [];
  [-1, 1].forEach(s => {
    const st = new THREE.Group(); st.position.set(s * 0.98, 0.36, 1.75); g.add(st); steers.push(st);
    const w = add(wf, tyre, 0, 0, 0, st); add(hub, rim, s * 0.19, 0, 0, w); wheels.push(w);
    const r = add(wr, tyre, s * 0.98, 0.4, -1.65); add(hub, rim, s * 0.24, 0, 0, r); wheels.push(r);
  });
  g.userData = { flapPivot, wheels, steers };
  scene.add(g);
  return g;
}

/* ---------------- Race state ---------------- */
const GRID = [
  { name: 'You', color: 0xe3313d, accent: 0xf4f6f8, ai: false, off: 18, lane: 1 },
  { name: 'Vortex', color: 0xff8a1f, accent: 0x1b1e24, ai: true, off: 8, lane: -1, skill: 0.9, top: 88 },
  { name: 'Halcyon', color: 0x19b5a5, accent: 0xffffff, ai: true, off: 28, lane: -1, skill: 0.86, top: 86 },
  { name: 'Violet', color: 0x7a4dff, accent: 0xffd23d, ai: true, off: 38, lane: 1, skill: 0.83, top: 85 }
];
let cars = [], player = null, state = 'menu', raceTime = 0, cd = { t: 0, goAt: 0 }, finishCount = 0, resultsTimer = -1;
let selected = 'oval', camYaw = 0, hintTimeout = null;
const keys = {};

function setupRace() {
  cars.forEach(c => scene.remove(c.mesh));
  buildTrack(selected);
  const laneW = Math.min(3.5, track.half - 2);
  cars = GRID.map(g => {
    const s = -g.off;
    const smp = sampleAt(s);
    const c = {
      name: g.name, color: g.color, isAI: g.ai, skill: g.skill || 1, top: g.top || 90,
      mesh: makeCar(g.color, g.accent), s, lane: g.lane * laneW, laneTarget: g.lane * laneW,
      speed: 0, steer: 0, heading: Math.atan2(smp.tan.x, smp.tan.z),
      pos: smp.pos.clone().addScaledVector(smp.nrm, g.lane * laneW),
      idx: smp.i, lapStart: 0, lastLap: null, bestLap: null, finished: false, finishTime: 0,
      drs: false, ers: 100, fuel: 100, strat: 2, boosting: false, wallHit: 0
    };
    placeMesh(c);
    return c;
  });
  player = cars[0];
  camYaw = player.heading;
  camera.position.set(player.pos.x - Math.sin(camYaw) * 11, 4.4, player.pos.z - Math.cos(camYaw) * 11);
  raceTime = 0; finishCount = 0; resultsTimer = -1;
  cd = { t: 0, goAt: 5.4 + Math.random() * 0.8 };
  state = 'countdown';
  $('lights').classList.remove('hidden');
  [...$('lights').children].forEach(l => l.classList.remove('on'));
  setStrat(2, true);
  $('hud').classList.remove('hidden');
  $('hint').style.opacity = 1;
  clearTimeout(hintTimeout);
  hintTimeout = setTimeout(() => { $('hint').style.opacity = 0; }, 10000);
}

function placeMesh(c) {
  c.mesh.position.set(c.pos.x, 0, c.pos.z);
  c.mesh.rotation.y = c.heading;
}

/* ---------------- Input ---------------- */
const down = (...codes) => codes.some(k => keys[k]);
addEventListener('keydown', e => {
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code) && state !== 'menu') e.preventDefault();
  if (!keys[e.code]) onPress(e.code);
  keys[e.code] = true;
});
addEventListener('keyup', e => { keys[e.code] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

function onPress(code) {
  if (code === 'KeyP' || code === 'Escape') { togglePause(); return; }
  if (state !== 'race' && state !== 'countdown') return;
  if (code === 'Space' || code === 'KeyE') {
    if (player.finished) return;
    if (state !== 'race') { flash('DRS disabled'); return; }
    player.drs = !player.drs;
  }
  if (code === 'Digit1') setStrat(1);
  if (code === 'Digit2') setStrat(2);
  if (code === 'Digit3') setStrat(3);
  if (code === 'KeyR' && state === 'race') resetPlayer();
}
function setStrat(n, quiet) {
  if (!player) return;
  player.strat = n;
  const b = $('b-strat'); b.className = 'badge s' + n; b.textContent = 'Strat ' + n;
  if (!quiet) flash(['', 'Strat 1: party mode', 'Strat 2: standard', 'Strat 3: lean'][n]);
}
function resetPlayer() {
  const nr = nearest(player.pos, -1);
  const smp = sampleAt(nr.i * track.step);
  player.pos.copy(smp.pos); player.heading = Math.atan2(smp.tan.x, smp.tan.z);
  player.speed = 0; player.steer = 0; player.idx = nr.i; player.drs = false;
  flash('Reset');
}
function togglePause() {
  if (state === 'race' || state === 'countdown') { state = 'paused:' + state; $('pause').classList.remove('hidden'); $('resume').focus(); }
  else if (state.startsWith('paused:')) { state = state.slice(7); $('pause').classList.add('hidden'); last = performance.now(); }
}

if ('ontouchstart' in window || navigator.maxTouchPoints > 0) {
  $('touch').classList.remove('hidden');
  document.querySelectorAll('#touch button').forEach(bt => {
    const k = bt.dataset.k, tap = bt.dataset.tap;
    bt.addEventListener('pointerdown', e => { e.preventDefault(); bt.classList.add('down'); if (k) keys[k] = true; if (tap) onPress(tap); });
    const up = () => { bt.classList.remove('down'); if (k) keys[k] = false; };
    bt.addEventListener('pointerup', up); bt.addEventListener('pointercancel', up); bt.addEventListener('pointerleave', up);
  });
}

/* ---------------- HUD ---------------- */
for (let i = 0; i < 15; i++) $('rpm').appendChild(document.createElement('span'));
const rpmCells = [...$('rpm').children];
let msgTimer = 0;
function flash(text, dur) { const m = $('msg'); m.textContent = text; m.style.opacity = 1; msgTimer = dur || 1.4; }
const GEARS = [0, 95, 135, 170, 205, 240, 275, 305, 360];

function updateHUD(dt) {
  const c = player, kmh = Math.abs(c.speed) * 3.6;
  let gear = 'N', rpm = 3800;
  if (c.speed < -0.5) { gear = 'R'; rpm = 4000 + kmh * 150; }
  else if (kmh > 1 || (state === 'race' && down('ArrowUp', 'KeyW'))) {
    let g = 1; while (g < 8 && kmh >= GEARS[g]) g++;
    const lo = GEARS[g - 1], hi = GEARS[g];
    rpm = 3800 + clamp((kmh - lo) / (hi - lo), 0, 1) * 8700; gear = String(g);
  }
  const lit = Math.round(clamp((rpm - 3800) / 8700, 0, 1) * 15);
  rpmCells.forEach((cell, i) => {
    cell.style.background = i < lit ? (i < 6 ? '#4dff7a' : i < 11 ? '#ff3b4a' : '#6fb3ff') : 'rgba(255,255,255,.15)';
  });
  $('speed').innerHTML = Math.round(kmh) + '<small>km/h</small>';
  $('gear').textContent = gear;
  $('ers-t').textContent = Math.round(c.ers) + '%'; $('ers-f').style.width = c.ers + '%';
  $('fuel-t').textContent = Math.round(c.fuel) + '%'; $('fuel-f').style.width = c.fuel + '%';
  $('fuel-f').style.background = c.fuel < 15 ? 'var(--red)' : 'var(--fuel)';
  $('b-drs').classList.toggle('on', c.drs);
  $('b-ers').classList.toggle('on', c.boosting);

  const laps = track.def.laps, lapNo = clamp(Math.floor(c.s / track.L) + 1, 1, laps);
  $('lap').textContent = c.finished ? 'Finished' : 'Lap ' + lapNo + '/' + laps;
  $('laptime').textContent = fmt(c.finished ? c.lastLap : (state === 'race' ? raceTime - c.lapStart : 0));
  $('last').textContent = fmt(c.lastLap); $('best').textContent = fmt(c.bestLap);
  const order = standings();
  $('pos').textContent = 'P' + (order.indexOf(c) + 1) + '/' + cars.length;
  $('standings').innerHTML = order.map((o, i) =>
    '<div class="' + (o === c ? 'me' : '') + '"><span class="num" style="width:22px">P' + (i + 1) + '</span><i style="background:#' + o.color.toString(16).padStart(6, '0') + '"></i>' + o.name + '</div>').join('');
  if (msgTimer > 0) { msgTimer -= dt; if (msgTimer <= 0) $('msg').style.opacity = 0; }
}
function standings() {
  return cars.slice().sort((a, b) => {
    if (a.finished && b.finished) return a.finishTime - b.finishTime;
    if (a.finished) return -1; if (b.finished) return 1;
    return b.s - a.s;
  });
}

/* ---------------- Lap bookkeeping ---------------- */
function advance(c, newS) {
  const L = track.L, prev = Math.floor(c.s / L);
  c.s = newS;
  const now = Math.floor(c.s / L);
  if (now > prev && prev >= 0 && !c.finished) {
    const lt = raceTime - c.lapStart;
    c.lastLap = lt; c.lapStart = raceTime;
    if (c.bestLap == null || lt < c.bestLap) c.bestLap = lt;
    if (now >= track.def.laps) {
      c.finished = true; c.finishTime = raceTime; finishCount++;
      if (c === player) {
        c.drs = false;
        flash(finishCount === 1 ? 'Victory!' : 'Finished P' + finishCount, 3);
        resultsTimer = 3;
      }
    } else if (c === player) {
      flash((now === track.def.laps - 1 ? 'Final lap  ' : 'Lap ' + (now + 1) + '  ') + fmt(lt), 2);
    }
  }
}

/* ---------------- Physics ---------------- */
const tmp = new THREE.Vector3();
function updatePlayer(dt) {
  const c = player, racing = state === 'race' && !c.finished;
  let thr = racing && down('ArrowUp', 'KeyW') ? 1 : 0;
  let brk = state === 'race' && down('ArrowDown', 'KeyS') ? 1 : 0;
  if (c.finished) { thr = 0; brk = c.speed > 30 ? 0.4 : 0; }
  const v = c.speed;

  const maxSt = 0.5 / (1 + Math.abs(v) / 12);
  const input = (down('ArrowLeft', 'KeyA') ? 1 : 0) - (down('ArrowRight', 'KeyD') ? 1 : 0);
  c.steer += (input * maxSt - c.steer) * Math.min(1, dt * 8);

  const nr = nearest(c.pos, c.idx);
  const offTrack = Math.abs(nr.lat) > track.half + 1.6;

  const mapMul = [0, 1.15, 1, 0.86][c.strat];
  let acc = 0;
  if (thr) acc += 15 * mapMul * (c.fuel > 0 ? 1 : 0.35);
  c.boosting = racing && thr > 0 && c.ers > 0 && down('ShiftLeft', 'ShiftRight', 'KeyK');
  if (c.boosting) { acc += 9; c.ers = Math.max(0, c.ers - 22 * dt); }
  else if (state === 'race') c.ers = Math.min(100, c.ers + (brk && v > 5 ? 12 : 3.5) * dt);
  if (thr && c.fuel > 0) {
    const before = c.fuel;
    c.fuel = Math.max(0, c.fuel - track.burn * [0, 1.45, 1, 0.65][c.strat] * dt);
    if (c.fuel === 0) flash('Out of fuel: limp mode', 2.5);
    else if (before >= 15 && c.fuel < 15) flash('Fuel low', 1.8);
  }
  if (c.drs && (brk || offTrack)) c.drs = false;

  const k = 0.00176 * (c.drs ? 0.76 : 1);
  let dv = acc - k * v * Math.abs(v) - 0.4 * Math.sign(v);
  if (offTrack) dv -= 1.3 * v;
  if (brk) dv -= v > 0.5 ? 34 * brk : 7;
  if (thr && v < 0) dv += 20;
  dv -= Math.abs(c.steer) * v * 0.35;
  c.speed = Math.max(-10, v + dv * dt);
  if (!thr && !brk && Math.abs(c.speed) < 0.4) c.speed = 0;
  if (state === 'countdown') c.speed = 0;

  c.heading += c.speed / 3.2 * Math.tan(c.steer) * dt;
  c.pos.x += Math.sin(c.heading) * c.speed * dt;
  c.pos.z += Math.cos(c.heading) * c.speed * dt;

  // barrier contact
  const nr2 = nearest(c.pos, nr.i);
  const limit = track.half + track.barrier - 1.2;
  if (Math.abs(nr2.lat) > limit) {
    const n = track.Nrm[nr2.i], push = nr2.lat - Math.sign(nr2.lat) * limit;
    c.pos.x -= n.x * push; c.pos.z -= n.z * push;
    const tg = track.T[nr2.i], tgYaw = Math.atan2(tg.x, tg.z);
    const fwd = Math.abs(wrapAngle(tgYaw - c.heading)) < Math.PI / 2 ? tgYaw : tgYaw + Math.PI;
    c.heading += wrapAngle(fwd - c.heading) * Math.min(1, dt * 6);
    if (c.wallHit <= 0 && Math.abs(c.speed) > 15) { c.speed *= 0.55; c.drs = false; }
    else c.speed *= 1 - 1.5 * dt;
    c.wallHit = 0.3;
  }
  c.wallHit -= dt;

  let di = nr2.i - c.idx;
  if (di > track.N / 2) di -= track.N;
  if (di < -track.N / 2) di += track.N;
  c.idx = nr2.i;
  advance(c, c.s + di * track.step);
}

function updateAI(c, dt) {
  const t = track;
  if (state === 'race') {
    const i0 = Math.floor((((c.s % t.L) + t.L) % t.L) / t.step) % t.N;
    const top = c.top * (c.drs ? 1.08 : 1) * (c.finished ? 0.45 : 1);
    let vt = top;
    for (let d = 0; d < 200; d += 4) {
      const j = (i0 + Math.round(d / t.step)) % t.N;
      const vc = t.vCorner[j] * c.skill;
      const allowed = Math.sqrt(vc * vc + 2 * 24 * d);
      if (allowed < vt) vt = allowed;
    }
    c.drs = !c.finished && vt >= top * 0.99 && c.speed > 55 && t.kappa[i0] < 1 / 400;
    if (c.speed < vt) c.speed = Math.min(vt, c.speed + Math.max(1, 14 - 0.0014 * c.speed * c.speed) * dt);
    else c.speed = Math.max(vt, c.speed - 26 * dt);

    const laneW = Math.min(3.5, t.half - 2);
    for (const o of cars) {
      if (o === c) continue;
      const gap = o.s - c.s;
      if (gap > 0 && gap < 14) {
        const oLane = o.isAI ? o.lane : nearest(o.pos, o.idx).lat;
        if (Math.abs(oLane - c.laneTarget) < 2.6 && o.speed < c.speed + 2) c.laneTarget = oLane > 0 ? -laneW : laneW;
        if (gap < 6 && Math.abs(oLane - c.lane) < 2.2) c.speed = Math.max(0, Math.min(c.speed, o.speed - 1));
      }
    }
    if (Math.random() < dt * 0.15) c.laneTarget = clamp(c.laneTarget + (Math.random() - 0.5) * 3, -laneW, laneW);
    c.lane += (c.laneTarget - c.lane) * Math.min(1, dt * 1.2);
  }
  const prevHeading = c.heading;
  advance(c, c.s + c.speed * dt);
  const smp = sampleAt(c.s);
  c.pos.copy(smp.pos).addScaledVector(smp.nrm, c.lane);
  c.heading = Math.atan2(smp.tan.x, smp.tan.z);
  c.steer = clamp(wrapAngle(c.heading - prevHeading) / Math.max(dt, 1e-3) * 0.12, -0.35, 0.35);
}

function collide() {
  for (let a = 1; a < cars.length; a++) {
    const o = cars[a];
    tmp.subVectors(player.pos, o.pos); tmp.y = 0;
    const d = tmp.length();
    if (d < 3.4 && d > 0.001) {
      tmp.multiplyScalar((3.4 - d) / d);
      player.pos.add(tmp);
      if (o.s > player.s) player.speed *= 0.96; else o.speed *= 0.94;
    }
  }
}

function animateCar(c, dt) {
  placeMesh(c);
  const u = c.mesh.userData;
  u.wheels.forEach(w => { w.rotation.x += c.speed * dt / 0.38; });
  u.steers.forEach(s => { s.rotation.y = c.steer * 1.4; });
  const target = c.drs ? 0 : 0.6;
  u.flapPivot.rotation.x += (target - u.flapPivot.rotation.x) * Math.min(1, dt * 12);
}

/* ---------------- Loop ---------------- */
let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (!track) return;
  if (state === 'menu' || state === 'done' || state.startsWith('paused')) {
    if (state === 'menu') { const a = now * 0.00005; camera.position.set(Math.sin(a) * 700, 220, Math.cos(a) * 700); camera.lookAt(0, 0, 0); }
    renderer.render(scene, camera); return;
  }

  if (state === 'countdown') {
    cd.t += dt;
    const lit = Math.min(5, Math.floor(cd.t));
    [...$('lights').children].forEach((l, i) => l.classList.toggle('on', i < lit));
    if (cd.t >= cd.goAt) {
      state = 'race'; raceTime = 0;
      [...$('lights').children].forEach(l => l.classList.remove('on'));
      flash('Go!', 1);
      setTimeout(() => $('lights').classList.add('hidden'), 900);
    }
  } else if (state === 'race') raceTime += dt;

  updatePlayer(dt);
  cars.forEach(c => { if (c.isAI) updateAI(c, dt); });
  collide();
  cars.forEach(c => animateCar(c, dt));

  camYaw += wrapAngle(player.heading - camYaw) * Math.min(1, dt * 4.5);
  const fx = Math.sin(camYaw), fz = Math.cos(camYaw);
  const want = new THREE.Vector3(player.pos.x - fx * 11, 4.4, player.pos.z - fz * 11);
  camera.position.lerp(want, 1 - Math.exp(-dt * 7));
  camera.lookAt(player.pos.x + fx * 5, 1.3, player.pos.z + fz * 5);
  const fov = 62 + Math.abs(player.speed) * 0.13 + (player.boosting ? 4 : 0);
  if (Math.abs(camera.fov - fov) > 0.05) { camera.fov += (fov - camera.fov) * Math.min(1, dt * 4); camera.updateProjectionMatrix(); }

  sun.position.set(player.pos.x + 60, 110, player.pos.z + 35);
  sun.target.position.set(player.pos.x, 0, player.pos.z);

  updateHUD(dt);
  if (resultsTimer > 0) { resultsTimer -= dt; if (resultsTimer <= 0) showResults(); }
  renderer.render(scene, camera);
}
requestAnimationFrame(frame);

function showResults() {
  state = 'done';
  const order = standings(), p = order.indexOf(player) + 1;
  $('res-title').textContent = p === 1 ? 'You won ' + track.def.name : 'Finished P' + p;
  const winner = order[0];
  $('res-table').innerHTML = order.map((c, i) => {
    const time = c.finished ? (i === 0 ? fmt(c.finishTime) : '+' + (c.finishTime - winner.finishTime).toFixed(3) + 's') : 'Running';
    return '<tr' + (c === player ? ' style="font-weight:600"' : '') + '><td>P' + (i + 1) + '</td><td>' + c.name + '</td><td class="num">' + time + '</td><td class="num">Best ' + fmt(c.bestLap) + '</td></tr>';
  }).join('');
  $('results').classList.remove('hidden');
  $('again').focus();
}

/* ---------------- Menu ---------------- */
const list = $('tracklist');
Object.entries(TRACKS).forEach(([key, t]) => {
  const b = document.createElement('button');
  b.className = 'trk' + (key === selected ? ' sel' : '');
  b.innerHTML = '<strong>' + t.name + '</strong><span>' + t.desc + ' ' + t.laps + ' laps.</span>';
  b.onclick = () => { selected = key; [...list.children].forEach(x => x.classList.remove('sel')); b.classList.add('sel'); buildTrack(key); cars.forEach(c => scene.remove(c.mesh)); cars = []; };
  list.appendChild(b);
});
const toMenu = () => {
  state = 'menu';
  ['pause', 'results'].forEach(id => $(id).classList.add('hidden'));
  $('hud').classList.add('hidden');
  $('menu').classList.remove('hidden');
};
$('start').onclick = () => { $('menu').classList.add('hidden'); $('start').blur(); setupRace(); };
$('again').onclick = () => { $('results').classList.add('hidden'); $('again').blur(); setupRace(); };
$('resume').onclick = togglePause;
$('quit1').onclick = toMenu;
$('quit2').onclick = toMenu;

buildTrack('oval');
})();
