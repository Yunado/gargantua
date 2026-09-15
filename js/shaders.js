// GARGANTUA — shader sources.
// Scene pass: real-time Schwarzschild null-geodesic integration (RK4) per pixel,
// volumetric flared accretion disk with Doppler + gravitational redshift,
// procedural starfield & milky-way band, 10 debug views.

export const VS_FULL = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

export const SCENE_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;

uniform vec2  uRes;        // drawing buffer size, px
uniform float uAspect;
uniform float uFocal;      // 1/tan(fov/2)
uniform vec3  uCamPos;
uniform mat4  uCamMat;     // camera.matrixWorld
uniform float uTime;
uniform vec2  uJitter;     // TAA sub-pixel jitter, px
uniform int   uSteps;
uniform int   uDebug;

uniform float uDiskBrightness;
uniform float uDiskTemp;
uniform float uDoppler;
uniform float uRedshift;
uniform float uInnerR;
uniform float uOuterR;
uniform float uThickness;
uniform float uFlare;
uniform float uTurb;
uniform float uMass;
uniform float uStarDensity;
uniform float uGalaxy;
uniform float uExposure;
uniform float uTimeScale;

#define MAXSTEPS 5200

// ---------------------------------------------------------------- hashes / noise
float hash11(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}
float hash12(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
vec3 hash33(vec3 p) {
  p = fract(p * vec3(443.8975, 441.4260, 437.1951));
  p += dot(p, p.yzx + 19.19);
  return fract((p.xxy + p.yxx) * p.zyx);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash12(i);
  float b = hash12(i + vec2(1.0, 0.0));
  float c = hash12(i + vec2(0.0, 1.0));
  float d = hash12(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 4; i++) {
    v += amp * vnoise(p);
    p = p * 2.03 + 11.7;
    amp *= 0.5;
  }
  return v;
}
// 3D noise / fbm — seamless on the unit sphere (for the galaxy band; an
// atan-azimuth 2D domain has a wrap seam at ang = ±pi that lensing warps into
// a visible curved seam near the black hole).
float hash13(vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise3(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash13(i), hash13(i + vec3(1.0, 0.0, 0.0)), u.x),
        mix(hash13(i + vec3(0.0, 1.0, 0.0)), hash13(i + vec3(1.0, 1.0, 0.0)), u.x), u.y),
    mix(mix(hash13(i + vec3(0.0, 0.0, 1.0)), hash13(i + vec3(1.0, 0.0, 1.0)), u.x),
        mix(hash13(i + vec3(0.0, 1.0, 1.0)), hash13(i + vec3(1.0, 1.0, 1.0)), u.x), u.y),
    u.z);
}
float fbm3(vec3 p) {
  float v = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 4; i++) {
    v += amp * vnoise3(p);
    p = p * 2.03 + 7.7;
    amp *= 0.5;
  }
  return v;
}

// ---------------------------------------------------------------- starfield (3D cells, 3 octaves)
vec3 starfield(vec3 d) {
  vec3 col = vec3(0.0);
  float cell = 150.0;
  for (int i = 0; i < 3; i++) {
    vec3 q = d * cell;
    vec3 id = floor(q);
    vec3 f = fract(q) - 0.5;
    vec3 h = hash33(id + float(i) * 17.13);
    vec3 sp = (h - 0.5) * 0.7;
    vec3 df = f - sp;
    float dist2 = dot(df, df);
    float star = exp(-dist2 * 420.0);
    star = pow(star, 1.4 + 2.4 * h.z);
    float bright = hash11(h.x * 57.13 + h.y * 13.7);
    float on = step(0.52, h.y);
    vec3 tint = mix(vec3(0.65, 0.78, 1.0), vec3(1.0, 0.92, 0.72), h.x);
    col += star * on * (0.35 + 1.9 * bright) * tint * (1.0 - 0.35 * float(i));
    if (h.z > 0.965) {
      col += exp(-dist2 * 90.0) * tint * 1.6; // rare bright star
    }
    cell *= 0.42;
  }
  return col * uStarDensity;
}

// ---------------------------------------------------------------- milky way band
vec3 galaxyBand(vec3 d) {
  vec3 gN = normalize(vec3(0.42, 1.0, -0.28));
  float a = acos(clamp(dot(d, gN), -1.0, 1.0));
  float band = exp(-a * a * 15.0);
  // seam-free 3D domain: circumferential features on the sphere (d * 2.2) plus the
  // band-radial offset along the band normal — no atan, no wrap seam.
  vec3 q = d * 2.2 + gN * ((a - 0.52) * 5.5);
  float neb = fbm3(q + 4.7) * 0.75 + fbm3(q * 1.5 - 2.2) * 0.35;
  neb = pow(clamp(neb, 0.0, 1.25), 1.7);
  float dust = fbm3(q * 1.2 + 11.3);
  float lanes = smoothstep(0.50, 0.64, dust) * 0.9;
  vec3 col = vec3(0.85, 0.78, 1.0) * neb * 0.55
           + vec3(1.0, 0.60, 0.40) * pow(neb, 3.0) * 0.9;
  col *= 1.0 - lanes * smoothstep(0.0, 0.5, a);
  col += vec3(1.0, 0.85, 0.60) * exp(-a * a * 70.0) * 0.55; // bulge
  return col * band * uGalaxy;
}
vec3 background(vec3 d) {
  return starfield(d) + galaxyBand(d) + vec3(0.004, 0.005, 0.008);
}

// ---------------------------------------------------------------- blackbody (Tanner Helland incandescence approx)
vec3 blackbody(float T) {
  float x = clamp(T, 900.0, 40000.0) * 0.01;
  float r = (x <= 66.0) ? 1.0
           : clamp(329.698727446 * pow(max(x - 60.0, 1.0), -0.1332047592) / 255.0, 0.0, 1.0);
  float g = (x <= 66.0) ? clamp((99.4708025861 * log(max(x, 2.0)) - 161.1195681601) / 255.0, 0.0, 1.0)
           : clamp(288.1221695283 * pow(max(x - 60.0, 1.0), -0.0755148492) / 255.0, 0.0, 1.0);
  float b = (x < 19.0) ? 0.0
           : (x <= 66.0) ? clamp((138.5177312231 * log(max(x - 10.0, 1.0)) - 305.0447927307) / 255.0, 0.0, 1.0)
           : 1.0;
  return vec3(r, g, b);
}

// ---------------------------------------------------------------- volumetric flared disk
float diskH(float r) {
  return 0.34 * uThickness * pow(r / 3.0, 0.55 * uFlare + 0.15);
}
// p: point in world (disk in xz plane). k: ray direction (for grazing-angle detail).
// Outputs: local temp boost, phi basis, orbital speed.
float diskSample(vec3 p, vec3 k, out float tBoost, out vec3 ePhi, out float vMag) {
  tBoost = 1.0;
  ePhi = vec3(0.0);
  vMag = 0.0;
  float r = length(p.xz);
  if (r < uInnerR - 0.4 || r > uOuterR + 0.5) return 0.0;
  float H = diskH(r);
  float z = p.y / H;
  if (abs(z) > 3.0) return 0.0;
  float radial = smoothstep(uInnerR - 0.4, uInnerR + 0.7, r)
               * (1.0 - smoothstep(uOuterR - 2.0, uOuterR + 0.5, r));
  float prof = exp(-0.5 * z * z);
  float ang = atan(p.z, p.x);
  // Keplerian differential advection: every ring rotates at its local orbital
  // angular velocity (inner faster). Noise sampled in the rotated Cartesian
  // frame (continuous, no 2*pi atan seam) at high angular frequency so the
  // disk keeps swirling cloud structure instead of concentric bands.
  float omega = 1.0 / (r * sqrt(max(r - 2.0 * uMass, 0.5)));
  float rot = omega * uTime * 4.0;
  float ca = cos(ang - rot), sa = sin(ang - rot);
  vec2 rp = vec2(ca * p.x - sa * p.z, sa * p.x + ca * p.z);
  // grazing-angle low-pass: when the ray crosses the disk plane edge-on the fine
  // angular octaves alias into radial spikes (starburst) — blend to the coarse octave.
  float detail = smoothstep(0.02, 0.22, abs(k.y));
  float n = fbm(rp * (0.45 + 0.95 * detail) + fbm(rp * 2.6 - uTime * 0.06) * 1.2 * detail);
  n = clamp(n, 0.0, 1.0);
  float den = radial * prof * (0.62 + uTurb * (n * 1.4 - 0.5));
  // inner puff torus: extra 3D volume hugging the inner edge
  float pr = r - (uInnerR + 0.9);
  den += radial * exp(-pr * pr * 0.28) * exp(-abs(p.y) / (0.55 * max(uThickness, 0.1))) * 0.55;
  den *= 0.5 + 0.5 * smoothstep(2.0, 3.2, r);
  den = max(den, 0.0);
  float rF = length(p);
  vMag = min(0.99, 1.0 / sqrt(max(rF - 2.0 * uMass, 0.05)));
  ePhi = normalize(vec3(p.z, 0.0, -p.x));
  tBoost = 1.0 + uTurb * max(n - 0.55, 0.0) * 2.2;
  return den;
}

// ---------------------------------------------------------------- geodesic
vec3 accel(vec3 p, vec3 b, float rs) {
  float r2 = dot(p, p);
  float pb = dot(p, b);
  return -1.5 * rs * (r2 - pb * pb) * p / pow(r2, 2.5);
}

vec3 heat(float x) {
  x = clamp(x, 0.0, 1.0);
  vec3 c = mix(vec3(0.05, 0.10, 0.35), vec3(0.10, 0.50, 0.90), smoothstep(0.0, 0.4, x));
  c = mix(c, vec3(0.95, 0.95, 0.20), smoothstep(0.4, 0.7, x));
  c = mix(c, vec3(1.0, 0.20, 0.10), smoothstep(0.7, 1.0, x));
  return c;
}
vec3 gmap(float g) {
  return mix(vec3(0.15, 0.30, 1.0), vec3(1.0, 0.45, 0.15), smoothstep(0.3, 1.5, g)) * clamp(g, 0.0, 1.2);
}

void main() {
  vec2 frag = gl_FragCoord.xy + uJitter;
  vec2 uv = frag / uRes;
  vec2 cc = uv * 2.0 - 1.0;
  cc.x *= uAspect;
  vec3 dirCam = normalize(vec3(cc, -uFocal));
  vec3 dir = normalize((uCamMat * vec4(dirCam, 0.0)).xyz);

  float rs = 2.0 * uMass;
  vec3 b = cross(uCamPos, dir);
  vec3 p = uCamPos;
  vec3 k = dir;

  float trans = 1.0;
  vec3 col = vec3(0.0);
  float steps = 0.0;
  bool escaped = false;
  float gLast = 1.0, muLast = 0.0, TLast = 0.0;
  float denAccum = 0.0, gAccum = 0.0, TAccum = 0.0;
  float bc = rs * 3.0 * sqrt(3.0) / 4.0; // critical impact parameter

  for (int i = 0; i < MAXSTEPS; i++) {
    if (i >= uSteps) break;
    float r = length(p);
    if (r < rs) { trans = 0.0; break; }               // event horizon
    if (r > 64.0 && dot(p, k) > 0.0) { escaped = true; break; }

    // ---- adaptive step (drives both integration and volumetric accumulation)
    float rDisk = length(p.xz);
    float dt = 0.6;
    if (rDisk < uOuterR && rDisk > uInnerR - 1.0) {
      float H = diskH(rDisk);
      float near = 1.0 - smoothstep(0.0, 3.0 * H, abs(p.y));
      dt = mix(dt, 0.16, near); // denser sampling inside the disk volume
    }
    float prox = 1.0 / (1.0 + pow(max(r - 1.5 * rs, 0.0) / rs, 2.0));
    dt = mix(dt, dt * 0.5, prox * 0.8); // photon-region refinement

    // ---- volumetric disk emission
    if (rDisk > uInnerR - 1.0 && rDisk < uOuterR + 1.0 && abs(p.y) < 2.5 * diskH(rDisk)) {
      float tB; vec3 ePhi; float vM;
      float den = diskSample(p, k, tB, ePhi, vM);
      if (den > 0.001) {
        float rF = length(p);
        float mu = dot(k, ePhi);
        float gGrav = sqrt(max(1.0 - rs / rF, 0.0));
        float gamma = sqrt(max((rF - 1.5 * rs) / max(rF - rs, 1e-4), 0.0001));
        float g = pow(gGrav, uRedshift) / (gamma * (1.0 - vM * mu * uDoppler));
        g = clamp(g, 0.04, 4.5);
        float T = 9500.0 * uDiskTemp * tB * pow(3.0 / rF, 0.75);
        vec3 emit = blackbody(T * g) * pow(g, 4.0) * den * uDiskBrightness * 0.5;
        col += trans * emit * dt;
        trans *= exp(-den * 2.4 * dt);
        denAccum += trans * den * dt;
        gAccum += trans * den * dt * g;
        TAccum += trans * den * dt * T * g;
        gLast = g; muLast = mu; TLast = T * g;
      }
    }
    steps += 1.0;

    // ---- RK4 on (p, k)
    vec3 k1 = k;
    vec3 a1 = accel(p, b, rs);
    vec3 k2 = k + 0.5 * dt * a1;
    vec3 a2 = accel(p + 0.5 * dt * k1, b, rs);
    vec3 k3 = k + 0.5 * dt * a2;
    vec3 a3 = accel(p + 0.5 * dt * k2, b, rs);
    vec3 k4 = k + dt * a3;
    vec3 a4 = accel(p + dt * k3, b, rs);
    p += (dt / 6.0) * (k1 + 2.0 * k2 + 2.0 * k3 + k4);
    k += (dt / 6.0) * (a1 + 2.0 * a2 + 2.0 * a3 + a4);
  }

  if (trans > 0.0) {
    vec3 dOut = normalize(k);
    vec3 bg = background(dOut);
    // subtle gravitational redshift tint on background light
    float gt = clamp(gLast, 0.0, 1.0);
    bg *= mix(vec3(1.0), vec3(1.06, 0.94, 0.80), (1.0 - gt) * 0.5 * uRedshift);
    col += trans * bg * (escaped ? 1.0 : 0.85); // 0.85: photon-ring fallback falloff
  }

  // ---------------------------------------------------------------- debug views
  if (uDebug == 0) {
    gl_FragColor = vec4(col * uExposure, 1.0);
  } else if (uDebug == 1) {
    gl_FragColor = vec4(heat(steps / float(max(uSteps, 1))), 1.0);
  } else if (uDebug == 2) {
    gl_FragColor = vec4(gmap(gLast), 1.0);
  } else if (uDebug == 3) {
    gl_FragColor = vec4(vec3(muLast * 0.5 + 0.5), 1.0);
  } else if (uDebug == 4) {
    gl_FragColor = vec4(heat(denAccum * 0.8), 1.0);
  } else if (uDebug == 5) {
    gl_FragColor = vec4(background(dirCam), 1.0); // unlensed reference
  } else if (uDebug == 6) {
    float x = abs(length(b) - bc) / bc;
    gl_FragColor = vec4(vec3(1.0 - smoothstep(0.0, 0.6, x)), 1.0); // white = critical surface
  } else if (uDebug == 7) {
    gl_FragColor = vec4(heat(clamp(TAccum / max(denAccum, 1e-4) / 12000.0, 0.0, 1.0)), 1.0);
  } else if (uDebug == 8) {
    gl_FragColor = vec4(col, 1.0); // linear HDR, pre-post
  } else {
    gl_FragColor = vec4(normalize(k) * 0.5 + 0.5, 1.0); // final ray direction
  }
}
`;

export const TAA_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tAcc;
uniform sampler2D tScene;
uniform float uDecay;
void main() {
  vec3 cur = texture2D(tScene, vUv).rgb;
  vec3 acc = texture2D(tAcc, vUv).rgb;
  gl_FragColor = vec4(mix(cur, acc, uDecay), 1.0);
}
`;

export const BRIGHT_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tSrc;
uniform float uThreshold;
void main() {
  vec3 c = texture2D(tSrc, vUv).rgb;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float w = smoothstep(uThreshold, uThreshold + 0.6, l);
  gl_FragColor = vec4(c * w, 1.0);
}
`;

export const BLUR_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tSrc;
uniform vec2 uTexel;
uniform vec2 uDir;
void main() {
  vec3 s = texture2D(tSrc, vUv).rgb * 0.227027;
  vec2 o1 = uDir * uTexel * 1.3846153846;
  vec2 o2 = uDir * uTexel * 3.2307692308;
  s += (texture2D(tSrc, vUv + o1).rgb + texture2D(tSrc, vUv - o1).rgb) * 0.3162162162;
  s += (texture2D(tSrc, vUv + o2).rgb + texture2D(tSrc, vUv - o2).rgb) * 0.0702702703;
  gl_FragColor = vec4(s, 1.0);
}
`;

export const COMPOSITE_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tScene;
uniform sampler2D tB1;
uniform sampler2D tB2;
uniform sampler2D tB3;
uniform sampler2D tB4;
uniform vec2  uRes;
uniform float uTime;
uniform float uBloom;
uniform float uVignette;
uniform float uGrain;
uniform float uAberration;
float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
void main() {
  vec2 d = vUv - 0.5;
  float r2 = dot(d, d);
  // radial chromatic aberration (R out, B in)
  vec2 off = d * uAberration * 0.0022 * (0.35 + r2);
  vec3 scene;
  scene.r = texture2D(tScene, vUv + off).r;
  scene.g = texture2D(tScene, vUv).g;
  scene.b = texture2D(tScene, vUv - off).b;
  // bloom
  vec3 bloom = texture2D(tB1, vUv).rgb * 0.30
             + texture2D(tB2, vUv).rgb * 0.27
             + texture2D(tB3, vUv).rgb * 0.23
             + texture2D(tB4, vUv).rgb * 0.20;
  vec3 col = scene + bloom * uBloom;
  // ACES (Narkowicz fit)
  col = clamp((col * (2.51 * col + 0.03)) / (col * (2.43 * col + 0.59) + 0.14), 0.0, 1.0);
  // vignette
  col *= 1.0 - uVignette * smoothstep(0.30, 1.05, length(d) * 1.4142);
  // film grain
  float g = hash21(vUv * uRes * 0.5 + vec2(fract(uTime * 7.13) * 61.7, fract(uTime * 3.7) * 43.3)) - 0.5;
  col += g * uGrain * 0.045 * (0.35 + 0.65 * length(col));
  gl_FragColor = vec4(col, 1.0);
}
`;
