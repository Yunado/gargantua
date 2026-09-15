// GARGANTUA — HUD & control panel.

import { PARAM_DEFS, QUALITY, VIEWS, DEBUG_NAMES } from './params.js';

export function createHUD(root, { state, onParam, onAction }) {
  const api = {
    cinematicButton: null,
    musicButton: null,
    hudButton: null,
    pauseButton: null,
    onAction,
    setDebugMode(on) {
      if (typeof dbgSec !== 'undefined') {
        dbgSec.textContent = on ? 'DEBUG MODE — keys 0–9 select view (Tab to exit)' : 'DEBUG VIEWS — Tab then keys 0–9';
      }
    },
  };

  const top = document.createElement('div');
  top.className = 'hud-top';
  top.innerHTML = `
    <div class="title">GARGANTUA <span>Schwarzschild raytracer</span></div>
    <div class="meta"></div>`;
  const meta = top.querySelector('.meta');

  function metaLine() {
    const fpsEl = top.querySelector('.fps');
    const parts = [
      VIEWS[state.view].name,
      QUALITY[state.quality].label,
      state.cinematic ? 'cinematic' : 'orbit',
      state.paused ? 'PAUSED' : '',
      state.debug > 0 ? `debug ${state.debug}: ${DEBUG_NAMES[state.debug]}` : '',
    ].filter(Boolean).join(' · ');
    meta.innerHTML = `<span class="fps"></span> ${parts}`;
    return fpsEl;
  }
  let fpsVal = null;
  api.updateFps = (n) => {
    fpsVal = n;
    const el = top.querySelector('.fps');
    if (el) el.textContent = `${n} fps · `;
  };
  api.updateDebug = () => { refreshMeta(); };
  function refreshMeta() {
    meta.innerHTML = '';
    const old = fpsVal;
    metaLine();
    if (old != null) { const el = top.querySelector('.fps'); if (el) el.textContent = `${old} fps · `; }
  }
  api.updateFps = (n) => { fpsVal = n; refreshMeta(); };

  // ------------------------------------------------------------- panel
  const panel = document.createElement('div');
  panel.className = 'panel';

  function sec(title) {
    const d = document.createElement('div');
    d.className = 'p-sec';
    d.textContent = title;
    panel.appendChild(d);
    return d;
  }
  function buttonRow(parent, items, cls) {
    const row = document.createElement('div');
    row.className = 'p-row';
    parent.appendChild(row);
    for (const it of items) {
      const b = document.createElement('button');
      b.className = 'p-btn' + (cls ? ' ' + cls : '');
      b.textContent = it.label;
      b.addEventListener('click', () => { b.blur(); if (it.fn) it.fn(); });
      row.appendChild(b);
      it.el = b;
    }
    return items;
  }

  sec('VIEW — keys 1·2·3·4');
  const viewBtns = buttonRow(panel, VIEWS.map((v, i) => ({ label: `${i + 1} ${v.name}`, fn: () => onAction('view', i) })), 'view');
  api.setView = () => {
    viewBtns.forEach((it, i) => it.el.classList.toggle('on', i === state.view));
    refreshMeta();
  };

  sec('QUALITY — key Q cycles');
  const qualBtns = buttonRow(panel, Object.keys(QUALITY).map((k) => ({ label: QUALITY[k].label, fn: () => onAction('quality', k) })), 'quality');
  api.setQuality = () => {
    qualBtns.forEach((it, i) => it.el.classList.toggle('on', Object.keys(QUALITY)[i] === state.quality));
    refreshMeta();
  };

  const dbgSec = sec('DEBUG VIEWS — Tab then keys 0–9');
  const dbgBtns = buttonRow(panel, DEBUG_NAMES.map((n, i) => ({ label: `${i}`, fn: () => onAction('debug', i) })), 'debug');
  dbgBtns.forEach((it, i) => { it.el.title = DEBUG_NAMES[i]; it.el.classList.toggle('on', i === state.debug); });
  api.updateDebug = () => {
    dbgBtns.forEach((it, i) => it.el.classList.toggle('on', i === state.debug));
    refreshMeta();
  };

  sec('ACTIONS');
  const actItems = [
    { label: 'Cinematic (C)', fn: () => onAction('cinematic'), ref: 'cinematicButton' },
    { label: 'Music (M)', fn: () => onAction('music'), ref: 'musicButton' },
    { label: 'HUD (H)', fn: () => onAction('hud'), ref: 'hudButton' },
    { label: 'Pause (Space)', fn: () => onAction('pause'), ref: 'pauseButton' },
    { label: 'Shot (S)', fn: () => onAction('screenshot') },
    { label: 'Export (E)', fn: () => onAction('export') },
    { label: 'Reset (R)', fn: () => onAction('reset') },
  ];
  buttonRow(panel, actItems, 'act');
  for (const it of actItems) api[it.ref] = it.el;
  api.setCinematic = () => { api.cinematicButton.classList.toggle('on', state.cinematic); refreshMeta(); };
  api.setMusic = () => { api.musicButton.classList.toggle('on', state.music); };
  api.setHud = () => { root.classList.toggle('no-hud', !state.hudVisible); api.hudButton.classList.toggle('on', state.hudVisible); };
  api.setPaused = () => { api.pauseButton.classList.toggle('on', state.paused); refreshMeta(); };

  sec(`PARAMETERS · ${PARAM_DEFS.length}`);
  const sliders = {};
  for (const d of PARAM_DEFS) {
    const row = document.createElement('div');
    row.className = 'p-param';
    row.innerHTML = `<span class="plabel">${d.label}</span><span class="pval"></span>`;
    const input = document.createElement('input');
    input.type = 'range';
    input.min = d.min; input.max = d.max; input.step = d.step;
    input.value = d.def;
    row.insertBefore(input, row.querySelector('.pval'));
    const val = row.querySelector('.pval');
    const fmt = (v) => (d.id === 'innerR' || d.id === 'outerR') ? (+v).toFixed(1) : (+v).toFixed(2);
    const paint = () => { val.textContent = fmt(input.value); };
    input.addEventListener('input', () => { paint(); onParam(d.id, parseFloat(input.value)); });
    panel.appendChild(row);
    sliders[d.id] = { input, paint };
    paint();
  }
  api.applyParams = (p) => {
    for (const d of PARAM_DEFS) {
      const s = sliders[d.id];
      if (typeof p[d.id] === 'number' && p[d.id] !== +s.input.value) {
        s.input.value = p[d.id];
        s.paint();
      }
    }
  };
  api.togglePanel = () => { panel.classList.toggle('open'); };

  // ------------------------------------------------------------- hint bar
  const hint = document.createElement('div');
  hint.className = 'hint';
  hint.textContent = 'drag orbit · wheel zoom · 1-4 views · Tab→0-9 debug · C cinematic · Q quality · H hud · M music · Space pause · S shot';

  const panelToggle = document.createElement('button');
  panelToggle.className = 'panel-toggle';
  panelToggle.textContent = '≡';
  panelToggle.addEventListener('click', () => { panelToggle.blur(); panel.classList.toggle('open'); });

  root.appendChild(top);
  root.appendChild(panelToggle);
  root.appendChild(panel);
  root.appendChild(hint);

  refreshMeta();
  return api;
}
