# GARGANTUA — Schwarzschild Black Hole Raytracer

Full-screen, real-time Schwarzschild null-geodesic raytracer. Every pixel integrates the
geodesic equation of the Schwarzschild metric (RK4) on the GPU — no black sphere, no
plane sprites, no textures, no video. Volumetric flared accretion disk (multiple lensed
crossings), photon ring & critical structure, procedural starfield + Milky Way band,
gravitational lensing, Doppler beaming, gravitational redshift, animated disk turbulence.

Post pipeline: HDR (half-float) → multi-scale Bloom → ACES → vignette → film grain →
radial chromatic aberration. TAA on High/Cinematic quality.

Pure vanilla HTML/CSS/JS + ES modules + local three.js vendor. **No build step, no
dependencies** — runs from any static server and directly on GitHub Pages.

## Run

Requires Node.js 18+ (or any static server):

```
node tools/serve.mjs        # → http://127.0.0.1:8090
# or
python -m http.server 8090
# or double-click start.bat (Windows)
```

Optional: regenerate the ambient music (60 s seamless loop, procedural, no deps):

```
node tools/gen-audio.mjs
```

## Controls

| Key | Action |
| --- | --- |
| drag / wheel / pinch | orbit / zoom (OrbitControls) |
| `1`–`4` | view presets: Interstellar · Grazing dive · Photon ring · Overhead |
| `Tab` then `0`–`9` | debug views (final · steps · g-factor · Doppler μ · optical depth · unlensed bg · critical surface · disk T · linear HDR · ray dir) |
| `C` | cinematic camera loop on/off |
| `Q` | cycle quality: Standard → High → Cinematic |
| `H` | toggle HUD |
| `B` | toggle parameter panel |
| `M` | ambient music on/off |
| `Space` | pause time |
| `R` | reset view |
| `S` | PNG screenshot |
| `E` | copy stateful URL |

21 parameters live in the right panel (disk physics, turbulence, background,
post-processing, ray budget, music). State auto-persists to `localStorage`
(`?fresh=1` to ignore it).

## URL / screenshot automation

```
?quality=standard|high|cinematic
&view=0..3 &debug=0..9 &cinematic=0|1
&params=doppler:1.5,innerR:3.0,outerR:16   (any of the 21 ids)
&shot=1 &delay=120 &headless=1
```

`?shot=1` renders for `delay` frames, then writes `document.title = "GARGANTUA:SHOT_READY"`
and logs a console marker (with `headless=1`) or downloads a PNG.
JS API: `window.GARGANTUA.{screenshot,setParam,getParams,setQuality,setView,setDebug,pause,resume,getState}`.

## Quality tiers

| Tier | Geodesic steps | DPR cap | TAA |
| --- | --- | --- | --- |
| Standard | 720 | 2.0 | off |
| High | 1500 | 2.0 | on |
| Cinematic | 2600 | 2.5 | on |

Mobile (coarse pointer / < 720 px) auto-selects Standard with a 1.5 DPR cap.

## Physics

Units: `G = c = M = 1`, so `r_s = 2`. Ray state `(p, k)` is integrated with RK4 under

```
d²x/dλ² = −(3/2)·(r_s·|x|² − (x·b)²)·x / |x|⁵,   b = x₀ × k₀
```

with adaptive step size (refined near the photon sphere `r = 1.5 r_s` and inside the
disk volume). Disk emission: Shakura–Sunyaev `T(r) ∝ r^(−3/4)` blackbody; local
circular-orbit speed `v = 1/√(r − r_s)`; frequency shift
`g = (1 − r_s/r)^(κ/2) / (γ(1 − v·μ))`; radiance scales as `g⁴` (Doppler beaming).
The disk is a **volumetric** flared Gaussian slab (`H(r) ∝ r^0.55`) with an inner
puff torus, fbm turbulence and per-sample optical depth — the ray can cross it
multiple times through lensing.

## Layout

```
index.html  css/style.css
js/main.js        app: renderer, RTs, loop, camera, API, persistence
js/shaders.js     all GLSL (scene geodesic integrator, TAA, bright, blur, composite)
js/params.js      21 params, quality tiers, views, debug names
js/hud.js         HUD + panel
vendor/           three.module.js + OrbitControls.js (pinned r164.1, import patched)
audio/ambient.wav procedural 60 s ambient drone (loop-safe)
tools/serve.mjs   zero-dep static server
tools/gen-audio.mjs audio generator
test/run-test.mjs headless-Chrome console + screenshot verifier
```

## Test

```
node tools/serve.mjs &     # keep server up
node test/run-test.mjs view    # headless Chrome: console errors + black-screen check
node test/run-test.mjs shot    # ?shot=1 automation path
```

Verified: headless Chrome (SwiftShader) boots with zero console errors, renders a
non-black frame at 1280×720 / Standard quality, and the `?shot=1` pipeline reports
ready.

## GitHub Pages

Static, no redirects, relative paths only — push this folder as a repo (or to a
subfolder) and enable Pages; it works from any base path.
