// GARGANTUA — shared parameter / quality / view definitions.

export const PARAM_DEFS = [
  { id: 'timeScale', label: 'Time flow', min: 0, max: 3, step: 0.05, def: 1.75 },
  { id: 'exposure', label: 'Exposure', min: 0.2, max: 3, step: 0.05, def: 0.6 },
  { id: 'diskBrightness', label: 'Disk luminance', min: 0, max: 3, step: 0.05, def: 2.8 },
  { id: 'diskTemp', label: 'Disk temperature', min: 0.4, max: 2.5, step: 0.05, def: 1.9 },
  { id: 'doppler', label: 'Doppler boost', min: 0, max: 2, step: 0.05, def: 0.8 },
  { id: 'redshift', label: 'Grav. redshift', min: 0, max: 2, step: 0.05, def: 1.2 },
  { id: 'innerR', label: 'Inner radius (M)', min: 2.5, max: 6, step: 0.1, def: 3.1 },
  { id: 'outerR', label: 'Outer radius (M)', min: 6, max: 30, step: 0.5, def: 14.0 },
  { id: 'thickness', label: 'Disk thickness', min: 0.1, max: 3, step: 0.05, def: 0.25 },
  { id: 'flare', label: 'Disk flare', min: 0, max: 2, step: 0.05, def: 1.65 },
  { id: 'turbulence', label: 'Turbulence', min: 0, max: 3, step: 0.05, def: 1.5 },
  { id: 'mass', label: 'Mass scale', min: 0.3, max: 2, step: 0.05, def: 0.85 },
  { id: 'stars', label: 'Star density', min: 0, max: 2, step: 0.05, def: 1.5 },
  { id: 'milkyStars', label: 'Milky Way stars', min: 0, max: 3, step: 0.05, def: 0.6 },
  { id: 'galaxy', label: 'Galaxy band', min: 0, max: 2, step: 0.05, def: 1.2 },
  { id: 'bloom', label: 'Bloom', min: 0, max: 2.5, step: 0.05, def: 0.55 },
  { id: 'bloomThreshold', label: 'Bloom threshold', min: 0.2, max: 3, step: 0.05, def: 0.85 },
  { id: 'vignette', label: 'Vignette', min: 0, max: 1, step: 0.05, def: 0.55 },
  { id: 'grain', label: 'Film grain', min: 0, max: 2, step: 0.05, def: 0.8 },
  { id: 'aberration', label: 'Chromatic aberr.', min: 0, max: 3, step: 0.1, def: 1.9 },
  { id: 'rays', label: 'Ray steps ×', min: 0.4, max: 2, step: 0.05, def: 0.95 },
  { id: 'volume', label: 'Music volume', min: 0, max: 1, step: 0.01, def: 0.5 },
];

export const QUALITY = {
  standard: { label: 'Standard', steps: 720, dpr: 2.0, taa: false },
  high: { label: 'High', steps: 1500, dpr: 2.0, taa: true },
  cinematic: { label: 'Cinematic', steps: 2600, dpr: 2.5, taa: true },
};

export const VIEWS = [
  { name: 'Interstellar', pos: [0, 3.2, 27] },
  { name: 'Grazing dive', pos: [16.5, 1.1, 6.5] },
  { name: 'Photon ring', pos: [0, 0.9, 8.2] },
  { name: 'Overhead', pos: [0, 21, 0.4] },
];

export const DEBUG_NAMES = [
  'Final image',
  'Integration steps',
  'g-factor',
  'Doppler mu',
  'Optical depth',
  'Unlensed background',
  'Critical surface',
  'Disk temperature',
  'Linear HDR',
  'Final ray dir',
];

export function defaultParams() {
  const o = {};
  for (const d of PARAM_DEFS) o[d.id] = d.def;
  return o;
}
