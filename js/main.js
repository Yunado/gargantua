// GARGANTUA — Schwarzschild Black Hole Raytracer.
// Native ES modules, local three.js vendor, no build step.

import * as THREE from '../vendor/three.module.js';
import { OrbitControls } from '../vendor/OrbitControls.js';
import { VS_FULL, SCENE_FRAG, TAA_FRAG, BRIGHT_FRAG, BLUR_FRAG, COMPOSITE_FRAG } from './shaders.js';
import { PARAM_DEFS, QUALITY, VIEWS, DEBUG_NAMES, defaultParams } from './params.js';
import { createHUD } from './hud.js';

// ----------------------------------------------------------------------------- state
const isMobile = matchMedia('(pointer: coarse)').matches || innerWidth < 720;
const url = new URL(location.href);
const wantFresh = url.searchParams.has('fresh');

const state = {
  params: defaultParams(),
  quality: isMobile ? 'standard' : 'high',
  view: 0,
  debug: 0,
  paused: false,
  cinematic: true,
  hudVisible: true,
  music: !isMobile,
  simTime: 0,
  frame: 0,
  taaReset: 0,
  taaFlip: false,
};

// ----------------------------------------------------------------------------- url + persistence
const STORE = 'gargantua.v3';
function loadState() {
  if (!wantFresh) {
    try {
      const s = JSON.parse(localStorage.getItem(STORE));
      if (s && s.params) {
        for (const d of PARAM_DEFS) if (typeof s.params[d.id] === 'number') state.params[d.id] = s.params[d.id];
        if (QUALITY[s.quality]) state.quality = s.quality;
        if (typeof s.view === 'number') state.view = s.view;
        if (typeof s.debug === 'number' && s.debug >= 0 && s.debug <= 9) state.debug = s.debug;
        // cinematic is NOT persisted: every load starts in the cinematic loop (grab / C is per-session)
        if (typeof s.music === 'boolean') state.music = s.music;
      }
    } catch { /* ignore */ }
  }
  const q = url.searchParams;
  if (q.has('params')) {
    for (const kv of q.get('params').split(',')) {
      const [k, v] = kv.split(':');
      if (k && v && typeof state.params[k] === 'number') {
        const n = parseFloat(v);
        if (isFinite(n)) state.params[k] = n;
      }
    }
  }
  if (q.has('quality') && QUALITY[q.get('quality')]) state.quality = q.get('quality');
  if (q.has('view') && +q.get('view') >= 0 && +q.get('view') <= 3) state.view = +q.get('view');
  if (q.has('debug') && +q.get('debug') >= 0 && +q.get('debug') <= 9) state.debug = +q.get('debug');
  if (q.has('cinematic')) state.cinematic = q.get('cinematic') !== '0';
  state.shot = q.has('shot') || q.has('screenshot');
  state.shotHeadless = q.get('headless') === '1';
  state.shotDelay = Math.max(1, parseInt(q.get('delay') || '120', 10) || 120);
}
let saveTimer = 0;
function saveState() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      const o = { params: state.params, quality: state.quality, view: state.view, debug: state.debug, music: state.music };
      localStorage.setItem(STORE, JSON.stringify(o));
    } catch { /* ignore */ }
  }, 300);
}
function exportUrl() {
  const p = new URL(location.href);
  p.search = '';
  const q = p.searchParams;
  q.set('quality', state.quality);
  q.set('view', String(state.view));
  q.set('debug', String(state.debug));
  q.set('cinematic', state.cinematic ? '1' : '0');
  q.set('params', PARAM_DEFS.map(d => `${d.id}:${(+state.params[d.id]).toFixed(3)}`).join(','));
  const s = p.toString();
  if (navigator.clipboard) navigator.clipboard.writeText(s).catch(() => {});
  console.info('[GARGANTUA] state url:', s);
}

loadState();

// ----------------------------------------------------------------------------- renderer
const canvas = document.getElementById('gl');
const overlay = document.getElementById('overlay');
function showOverlay(msg, retry) {
  overlay.classList.remove('hidden');
  overlay.querySelector('div').textContent = msg;
  const btn = overlay.querySelector('button');
  if (btn) { btn.hidden = !retry; btn.onclick = () => location.reload(); }
}

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
} catch (e) {
  showOverlay('WebGL unavailable: ' + e.message, true);
  throw e;
}
renderer.autoClear = true;

canvas.addEventListener('webglcontextlost', (e) => {
  e.preventDefault();
  showOverlay('Graphics context lost — recovering…', false);
});
canvas.addEventListener('webglcontextrestored', () => {
  rebuildTargets();
  overlay.classList.add('hidden');
});

const halfFloat = renderer.capabilities.isWebGL2 ? THREE.HalfFloatType : THREE.UnsignedByteType;

// fullscreen triangle
const quadGeo = new THREE.BufferGeometry();
quadGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
quadGeo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 2, 0, 0, 2]), 2));
const quadScene = new THREE.Scene();
const quadCam = new THREE.Camera();
const quadMesh = new THREE.Mesh(quadGeo, null);
quadMesh.frustumCulled = false;
quadScene.add(quadMesh);

function makeMat(frag, uniforms) {
  return new THREE.ShaderMaterial({
    vertexShader: VS_FULL,
    fragmentShader: frag,
    uniforms,
    depthTest: false,
    depthWrite: false,
  });
}

// ----------------------------------------------------------------------------- scene pass
const sceneMat = makeMat(SCENE_FRAG, {
  uRes: { value: new THREE.Vector2(1, 1) },
  uAspect: { value: 1 },
  uFocal: { value: 1 },
  uCamPos: { value: new THREE.Vector3() },
  uCamMat: { value: new THREE.Matrix4() },
  uTime: { value: 0 },
  uJitter: { value: new THREE.Vector2(0, 0) },
  uSteps: { value: 720 },
  uDebug: { value: 0 },
  uDiskBrightness: { value: 1 },
  uDiskTemp: { value: 1 },
  uDoppler: { value: 1 },
  uRedshift: { value: 1 },
  uInnerR: { value: 3 },
  uOuterR: { value: 14 },
  uThickness: { value: 1 },
  uFlare: { value: 1 },
  uTurb: { value: 1 },
  uMass: { value: 1 },
  uStarDensity: { value: 1 },
  uMilkyStars: { value: 1 },
  uGalaxy: { value: 1 },
  uExposure: { value: 1 },
  uTimeScale: { value: 1 },
});

// ----------------------------------------------------------------------------- camera / controls
const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 500);
camera.position.set(...VIEWS[0].pos);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 3.6;
controls.maxDistance = 160;
controls.target.set(0, 0, 0);

// ----------------------------------------------------------------------------- post pipeline targets
let targets = {};
function makeRT(w, h) {
  return new THREE.WebGLRenderTarget(w, h, {
    type: halfFloat,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: false,
    stencilBuffer: false,
  });
}
function rebuildTargets() {
  for (const k of Object.keys(targets)) targets[k].dispose();
  const w = renderer.getSize(new THREE.Vector2()).x;
  const h = renderer.getSize(new THREE.Vector2()).y;
  targets = {
    scene: makeRT(w, h),
    acc: makeRT(w, h),
    acc2: makeRT(w, h),
    bA1: makeRT(w >> 1, h >> 1), bB1: makeRT(w >> 1, h >> 1),
    bA2: makeRT(w >> 2, h >> 2), bB2: makeRT(w >> 2, h >> 2),
    bA3: makeRT(w >> 3, h >> 3), bB3: makeRT(w >> 3, h >> 3),
    bA4: makeRT(w >> 4, h >> 4), bB4: makeRT(w >> 4, h >> 4),
  };
  state.taaReset = 0;
}

const taaMat = makeMat(TAA_FRAG, { tAcc: { value: null }, tScene: { value: null }, uDecay: { value: 0.86 } });
const brightMat = makeMat(BRIGHT_FRAG, { tSrc: { value: null }, uThreshold: { value: 1.0 } });
const blurMat = makeMat(BLUR_FRAG, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uDir: { value: new THREE.Vector2() } });
const compMat = makeMat(COMPOSITE_FRAG, {
  tScene: { value: null },
  tB1: { value: null }, tB2: { value: null }, tB3: { value: null }, tB4: { value: null },
  uRes: { value: new THREE.Vector2(1, 1) },
  uTime: { value: 0 },
  uBloom: { value: 1.1 },
  uVignette: { value: 0.5 },
  uGrain: { value: 0.8 },
  uAberration: { value: 0.6 },
});

function blit(mat, dst) {
  quadMesh.material = mat;
  renderer.setRenderTarget(dst);
  renderer.render(quadScene, quadCam);
}

// ----------------------------------------------------------------------------- quality / resize
function applyQuality() {
  const q = QUALITY[state.quality];
  const dpr = Math.min(devicePixelRatio || 1, q.dpr, isMobile ? 1.5 : 3);
  renderer.setPixelRatio(dpr);
  resize();
  state.taaReset = 1;
  state.taaFlip = false;
}
function resize() {
  const w = Math.max(2, Math.floor(innerWidth * renderer.getPixelRatio()));
  const h = Math.max(2, Math.floor(innerHeight * renderer.getPixelRatio()));
  renderer.setSize(w, h, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  sceneMat.uniforms.uRes.value.set(w, h);
  sceneMat.uniforms.uAspect.value = w / h;
  sceneMat.uniforms.uFocal.value = 1 / Math.tan(THREE.MathUtils.degToRad(camera.fov) * 0.5);
  compMat.uniforms.uRes.value.set(w, h);
  rebuildTargets();
}
addEventListener('resize', () => { resize(); });

// ----------------------------------------------------------------------------- view transitions
let viewAnim = null;
function setView(i, instant) {
  state.view = i;
  hud.setView && hud.setView();
  const to = new THREE.Vector3(...VIEWS[i].pos);
  const from = camera.position.clone();
  if (instant || state.cinematic === false && from.lengthSq() === 0) {
    camera.position.copy(to);
    return;
  }
  viewAnim = { t: 0, dur: 1.4, from, to };
  // presets do NOT turn cinematic off — only C / the Cinematic button do
}
function animateView(dt) {
  if (!viewAnim) return false;
  viewAnim.t += dt;
  const x = Math.min(viewAnim.t / viewAnim.dur, 1);
  const e = x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
  const dA = viewAnim.from.clone().normalize();
  const dB = viewAnim.to.clone().normalize();
  const d = dA.multiplyScalar(1 - e).add(dB.multiplyScalar(e)).normalize();
  const r = THREE.MathUtils.lerp(viewAnim.from.length(), viewAnim.to.length(), e);
  camera.position.copy(d.multiplyScalar(r));
  if (x >= 1) viewAnim = null;
  return true;
}

// cinematic camera path
function cinematicPos(t) {
  const th = t * 0.09 + 0.8 * Math.sin(t * 0.017);
  const R = 24 + 13 * Math.sin(t * 0.031);
  const y = 3.2 * Math.sin(t * 0.043) + 1.4;
  return new THREE.Vector3(R * Math.cos(th), y, R * Math.sin(th));
}
// user drag state: while the pointer is down the user owns the camera; on release
// the cinematic path smoothly glides the camera position back. Cinematic never
// locks the view direction — the current look direction is preserved (the black
// hole and background nebula drift through the frame as the path moves).
let userDrag = false;
const _zero = new THREE.Vector3();
const _cam = new THREE.Vector3();
// 镜头死角 threshold (bigger = more parallax flow, which looks better). A smooth
// gaussian lift (not a hard clamp) keeps the 360° path out of the edge-on band
// without pinning the camera on a flat ring (no collapse). Manual presets may
// still be edge-on — this only guards the cinematic auto-motion.
const DEAD_Y = 2.0;  // edge-on band half-height to lift out of
const DEAD_SIGMA = 1.3; // lift width (wide enough to stay monotonic -> no jitter)
function updateCamera(dt) {
  if (animateView(dt)) {
    controls.update(); // preset flight owns the camera
    return;
  }
  if (state.cinematic && !userDrag) {
    // The camera rides the drifting path (left-right lateral drift + radius/height
    // breathing) and keeps looking at the black hole, so the starfield/nebula flows
    // by with parallax. Drag temporarily takes over; on release it glides back.
    const k = 1 - Math.exp(-2.5 * dt);
    _cam.copy(cinematicPos(state.simTime));
    const ay = Math.abs(_cam.y);
    const w = Math.exp(-(ay * ay) / (2 * DEAD_SIGMA * DEAD_SIGMA));
    _cam.y += Math.sign(_cam.y || 1) * DEAD_Y * w; // smooth dead-zone lift (monotonic)
    _cam.multiplyScalar(camera.position.length() / _cam.length()); // path = direction only; zoom distance stays the user's
    camera.position.lerp(_cam, k);
    controls.target.lerp(_zero, k); // black hole stays at the screen center
  }
  controls.update();
}

// ----------------------------------------------------------------------------- HUD
const hud = createHUD(document.getElementById('hud'), {
  state,
  onParam(id, v) {
    state.params[id] = v;
    if (id === 'innerR' && v >= state.params.outerR - 2) state.params.outerR = v + 2;
    if (id === 'outerR' && v <= state.params.innerR + 2) state.params.innerR = v - 2;
    if (id === 'volume') audioApply();
    if (id === 'rays') state.taaReset = 1;
    saveState();
  },
  onAction(type, arg) {
    switch (type) {
      case 'view': setView(arg); break;
      case 'quality': state.quality = arg; applyQuality(); hud.setQuality(); saveState(); break;
      case 'debug': state.debug = arg; hud.updateDebug(); saveState(); break;
      case 'music': toggleMusic(); saveState(); break;
      case 'hud': state.hudVisible = !state.hudVisible; hud.setHud(); saveState(); break;
      case 'panel': hud.togglePanel(); break;
      case 'pause': togglePause(); break;
      case 'reset': setView(0); break;
      case 'screenshot': doScreenshot(); break;
      case 'export': exportUrl(); break;
    }
  },
});
hud.setCinematic();
hud.setHud();
hud.applyParams(state.params);

// ----------------------------------------------------------------------------- audio
let audio = null;
function audioApply() {
  if (audio) audio.volume = Math.max(0, Math.min(1, state.params.volume));
}
function ensureAudio() {
  if (audio) return;
  audio = new Audio('audio/ambient.wav');
  audio.loop = true;
  audio.volume = state.params.volume;
  audioApply();
}
function toggleMusic() {
  state.music = !state.music;
  if (state.music) {
    ensureAudio();
    audio.play().catch(() => {});
  } else if (audio) {
    audio.pause();
  }
  hud.setMusic();
}
if (state.music) {
  ensureAudio(); // preload in the background — first gesture then starts playback instantly
  audio.play().catch(() => {}); // works immediately on returning visits (Chrome autoplay allowance); rejected otherwise — gesture kick below covers first visits
  let done = false;
  const kick = () => {
    if (!state.music || done) return;
    ensureAudio();
    audio.play().then(() => {
      done = true;
      removeEventListener('pointerdown', kick, true);
      removeEventListener('keydown', kick, true);
    }).catch(() => {}); // rejected (no gesture yet / autoplay policy) — keep retrying on next gesture
  };
  addEventListener('pointerdown', kick, { capture: true, passive: true });
  addEventListener('keydown', kick, { capture: true });
}
hud.setMusic();

// ----------------------------------------------------------------------------- keyboard
function togglePause() {
  state.paused = !state.paused;
  hud.setPaused();
}
let debugMode = false;
function setDebug(n) {
  state.debug = n;
  hud.updateDebug();
  saveState();
}
addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' && e.target.type === 'range') e.target.blur();
  switch (e.code) {
    case 'Space': e.preventDefault(); togglePause(); break;
    case 'KeyH': hud.onAction('hud'); break;
    case 'KeyB': hud.onAction('panel'); break;
    case 'KeyM': hud.onAction('music'); break;
    case 'KeyQ': {
      const order = ['standard', 'high', 'cinematic'];
      state.quality = order[(order.indexOf(state.quality) + 1) % 3];
      applyQuality();
      hud.setQuality();
      saveState();
      break;
    }
    case 'KeyR': setView(0); break;
    case 'KeyS': doScreenshot(); break;
    case 'KeyE': exportUrl(); break;
    case 'Tab': e.preventDefault(); debugMode = !debugMode; hud.setDebugMode(debugMode); break;
    case 'Digit0': setDebug(0); break;
    case 'Digit1': if (debugMode) setDebug(1); else setView(0); break;
    case 'Digit2': if (debugMode) setDebug(2); else setView(1); break;
    case 'Digit3': if (debugMode) setDebug(3); else setView(2); break;
    case 'Digit4': if (debugMode) setDebug(4); else setView(3); break;
    case 'Digit5': if (debugMode) setDebug(5); break;
    case 'Digit6': if (debugMode) setDebug(6); break;
    case 'Digit7': if (debugMode) setDebug(7); break;
    case 'Digit8': if (debugMode) setDebug(8); break;
    case 'Digit9': if (debugMode) setDebug(9); break;
  }
});
controls.enabled = true; // orbit works in all modes; cinematic only turns off via C / button
canvas.addEventListener('pointerdown', () => { userDrag = true; }, { passive: true });
addEventListener('pointerup', () => { userDrag = false; }, { passive: true });
addEventListener('pointercancel', () => { userDrag = false; }, { passive: true });

// ----------------------------------------------------------------------------- screenshot
function doScreenshot() {
  const dataUrl = canvas.toDataURL('image/png');
  if (state.shotHeadless) {
    console.info('[GARGANTUA] shot ready, dataUrl length=' + dataUrl.length);
  } else {
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = `gargantua-${Date.now()}.png`;
    a.click();
    console.info('[GARGANTUA] screenshot saved');
  }
  document.title = 'GARGANTUA:SHOT_READY';
}

// ----------------------------------------------------------------------------- TAA jitter
function halton(idx, base) {
  let f = 1, r = 0, i = idx;
  while (i > 0) { f /= base; r += f * (i % base); i = Math.floor(i / base); }
  return r;
}

// ----------------------------------------------------------------------------- main loop
let lastNow = performance.now();
let fpsEma = 60;
let fpsTimer = 0;
let frameErrorCount = 0;

function syncUniforms() {
  const p = state.params;
  const u = sceneMat.uniforms;
  u.uTime.value = state.simTime;
  u.uSteps.value = Math.round(QUALITY[state.quality].steps * p.rays);
  u.uDebug.value = state.debug;
  u.uDiskBrightness.value = p.diskBrightness;
  u.uDiskTemp.value = p.diskTemp;
  u.uDoppler.value = p.doppler;
  u.uRedshift.value = p.redshift;
  u.uInnerR.value = p.innerR;
  u.uOuterR.value = p.outerR;
  u.uThickness.value = p.thickness;
  u.uFlare.value = p.flare;
  u.uTurb.value = p.turbulence;
  u.uMass.value = p.mass;
  u.uStarDensity.value = p.stars;
  u.uMilkyStars.value = p.milkyStars;
  u.uGalaxy.value = p.galaxy;
  u.uExposure.value = p.exposure;
  u.uTimeScale.value = p.timeScale;
  brightMat.uniforms.uThreshold.value = p.bloomThreshold;
  compMat.uniforms.uBloom.value = p.bloom;
  compMat.uniforms.uVignette.value = p.vignette;
  compMat.uniforms.uGrain.value = p.grain;
  compMat.uniforms.uAberration.value = p.aberration;
  compMat.uniforms.uTime.value = performance.now() * 0.001;
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastNow) / 1000, 0.1);
  lastNow = now;
  fpsEma = fpsEma * 0.92 + (dt > 0 ? 1 / dt : 60) * 0.08;
  fpsTimer += dt;
  if (fpsTimer > 0.5) { fpsTimer = 0; hud.updateFps(Math.round(fpsEma)); }

  try {
    if (!state.paused) state.simTime += dt * state.params.timeScale;
    updateCamera(dt);
    camera.updateMatrixWorld();
    sceneMat.uniforms.uCamPos.value.copy(camera.position);
    sceneMat.uniforms.uCamMat.value.copy(camera.matrixWorld);

    const q = QUALITY[state.quality];
    state.frame++;
    if (q.taa) {
      const fi = state.frame % 997;
      sceneMat.uniforms.uJitter.value.set(halton(fi + 1, 2) - 0.5, halton(fi + 1, 3) - 0.5);
    } else {
      sceneMat.uniforms.uJitter.value.set(0, 0);
    }
    syncUniforms();

    // 1) scene
    blit(sceneMat, targets.scene);
    // 2) TAA accumulate (optional, ping-pong to avoid read/write of same RT)
    let sceneSrc = targets.scene;
    if (q.taa) {
      const src = state.taaFlip ? targets.acc2 : targets.acc;
      const dst = state.taaFlip ? targets.acc : targets.acc2;
      taaMat.uniforms.tAcc.value = src.texture;
      taaMat.uniforms.tScene.value = targets.scene.texture;
      taaMat.uniforms.uDecay.value = state.taaReset ? 0 : 0.86;
      blit(taaMat, dst);
      state.taaFlip = !state.taaFlip;
      sceneSrc = dst;
    }
    state.taaReset = 0;
    // 3) bright pass -> L1
    brightMat.uniforms.tSrc.value = sceneSrc.texture;
    blit(brightMat, targets.bA1);
    // 4) blur chain + downsample
    const levels = [[targets.bA1, targets.bB1], [targets.bA2, targets.bB2], [targets.bA3, targets.bB3], [targets.bA4, targets.bB4]];
    let prev = targets.bA1;
    for (let li = 0; li < 4; li++) {
      const [A, B] = levels[li];
      blurMat.uniforms.tSrc.value = A.texture;
      blurMat.uniforms.uTexel.value.set(1 / A.width, 1 / A.height);
      blurMat.uniforms.uDir.value.set(1, 0);
      blit(blurMat, B);
      blurMat.uniforms.tSrc.value = B.texture;
      blurMat.uniforms.uDir.value.set(0, 1);
      blit(blurMat, A);
      if (li < 3) {
        const nextA = levels[li + 1][0];
        blurMat.uniforms.tSrc.value = A.texture;
        blurMat.uniforms.uTexel.value.set(0, 0);
        blurMat.uniforms.uDir.value.set(0, 0);
        blit(blurMat, nextA);
      }
    }
    // 5) composite
    compMat.uniforms.tScene.value = sceneSrc.texture;
    compMat.uniforms.tB1.value = targets.bA1.texture;
    compMat.uniforms.tB2.value = targets.bA2.texture;
    compMat.uniforms.tB3.value = targets.bA3.texture;
    compMat.uniforms.tB4.value = targets.bA4.texture;
    blit(compMat, null);

    if (state.shot && state.frame >= state.shotDelay && !state.shotDone) {
      state.shotDone = true;
      doScreenshot();
    }
    frameErrorCount = 0;
  } catch (e) {
    console.error('[GARGANTUA] frame error:', e);
    frameErrorCount++;
    if (frameErrorCount > 8) {
      frameErrorCount = 0;
      showOverlay('Render loop error — reload to recover.', true);
    }
  }
}

// ----------------------------------------------------------------------------- public API (screenshot automation)
window.GARGANTUA = {
  screenshot: doScreenshot,
  setParam(id, v) { hud.onParam(id, typeof v === 'number' ? v : parseFloat(v)); },
  getParams: () => ({ ...state.params }),
  setQuality(q) { if (QUALITY[q]) { state.quality = q; applyQuality(); hud.setQuality(); saveState(); } },
  setView(i) { setView(i); },
  setDebug(n) { setDebug(n); },
  pause: () => togglePause(),
  resume: () => togglePause(),
  getState: () => ({ quality: state.quality, view: state.view, debug: state.debug, paused: state.paused, cinematic: state.cinematic }),
};

// ----------------------------------------------------------------------------- boot
applyQuality();
setView(state.view, true);
camera.position.multiplyScalar(1.35); // start a bit farther out: the scene reads smaller on screen
controls.update();
hud.setQuality();
hud.setCinematic();
hud.updateDebug();
overlay.classList.add('hidden');
console.info(`[GARGANTUA] boot: quality=${state.quality} webgl2=${renderer.capabilities.isWebGL2} dpr=${renderer.getPixelRatio()} halfFloat=${halfFloat === THREE.HalfFloatType}`);
requestAnimationFrame(frame);
