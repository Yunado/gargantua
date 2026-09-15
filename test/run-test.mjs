// GARGANTUA — headless Chrome verification (console errors + screenshot analysis).
// Usage: node test/run-test.mjs [view|shot] [url]
import { execFile } from 'node:child_process';
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { inflateSync, deflateSync } from 'node:zlib';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv[2] || 'view';
const url = process.argv[3] || (mode === 'shot'
  ? 'http://127.0.0.1:8090/?quality=standard&view=0&debug=0&cinematic=0&fresh=1&shot=1&headless=1&delay=3'
  : 'http://127.0.0.1:8090/?quality=standard&view=0&debug=0&cinematic=0&fresh=1');

const CHROME = 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe';
const shotPath = join(root, 'test', `shot-${mode}.png`);
const profDir = join(root, 'test', 'chrome-prof');
mkdirSync(profDir, { recursive: true });

const args = [
  '--headless=new', '--no-sandbox', '--disable-background-networking',
  `--user-data-dir=${profDir}`,
  '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  `--window-size=${process.env.GT_W || 960},${process.env.GT_H || 540}`, '--hide-scrollbars',
  '--enable-logging=stderr', '--v=0',
  '--virtual-time-budget=180000',
  `--screenshot=${shotPath}`,
  url,
];
console.log(`[test] chrome: ${CHROME}\n[test] url: ${url}`);
const { stderr, exitCode } = await new Promise((res) => {
  execFile(CHROME, args, { timeout: 120000, maxBuffer: 64 * 1024 * 1024 }, (err, _out, errOut) => {
    res({ stderr: errOut, exitCode: err ? 1 : 0 });
  });
});
const consoleLines = [...stderr.matchAll(/([A-Z]+):CONSOLE:\d+\]\s+"(.*)", source:/g)]
  .map((m) => (m[1] === 'ERROR' || /uncaught|is not defined|failed/i.test(m[2]) ? `[E] ${m[2]}` : `[I] ${m[2]}`));
const shaderErrors = consoleLines.filter((l) => /shader|glsl|program/i.test(l));
const realErrors = consoleLines.filter((l) => l.startsWith('[E]'));
console.log(`[test] chrome exit=${exitCode}`);
console.log(`[test] console lines: ${consoleLines.length}`);
for (const l of consoleLines.slice(0, 40)) console.log('  ' + l);
if (shaderErrors.length) { console.log('[test] SHADER/WARN lines:'); for (const l of shaderErrors) console.log('  ' + l); }

// ------------------------------------------------------------- png decode
function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a png');
  let off = 8, w = 0, h = 0, depth = 0, ctype = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); depth = data[8]; ctype = data[9]; }
    else if (type === 'IDAT') idat.push(data);
    off += 12 + len;
  }
  const bpp = ctype === 6 ? 4 : ctype === 2 ? 3 : 0;
  if (!bpp || depth !== 8) throw new Error(`unsupported png: ctype=${ctype} depth=${depth}`);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * bpp;
  const out = Buffer.alloc(h * stride);
  const paeth = (a, b, c) => { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; };
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    const row = out.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? row[x - bpp] : 0;
      const b = prev ? prev[x] : 0;
      const c = (prev && x >= bpp) ? prev[x - bpp] : 0;
      let v = raw[y * (stride + 1) + 1 + x];
      if (f === 1) v = (v + a) & 255;
      else if (f === 2) v = (v + b) & 255;
      else if (f === 3) v = (v + ((a + b) >> 1)) & 255;
      else if (f === 4) v = (v + paeth(a, b, c)) & 255;
      row[x] = v;
    }
  }
  return { w, h, bpp, data: out };
}

// ------------------------------------------------------------- png encode
const CRC_T = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(buf) { let c = 0xffffffff; for (const b of buf) c = CRC_T[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type, data) {
  const t = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}

const img = decodePng(readFileSync(shotPath));
console.log(`[test] screenshot: ${img.w}x${img.h} bpp=${img.bpp}`);
// stats
let sum = 0, black = 0, max = 0, hot = 0;
for (let i = 0; i < img.data.length; i += img.bpp) {
  const r = img.data[i], g = img.data[i + 1], b = img.data[i + 2];
  const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  sum += l; if (l < 6) black++; if (l > max) max = l; if (l > 240) hot++;
}
const npix = img.data.length / img.bpp;
console.log(`[test] stats: meanLum=${(sum / npix / 255).toFixed(3)} blackFrac=${(black / npix).toFixed(3)} maxLum=${(max / 255).toFixed(2)} hotFrac=${(hot / npix).toFixed(4)}`);

// preview 512px (box downsample)
const TW = 512, TH = Math.round(512 * img.h / img.w);
const sc = img.w / TW;
const preview = Buffer.alloc(TW * TH * 4);
for (let y = 0; y < TH; y++) {
  for (let x = 0; x < TW; x++) {
    let r = 0, g = 0, b = 0, n = 0;
    const x0 = Math.floor(x * sc), x1 = Math.max(x0 + 1, Math.floor((x + 1) * sc));
    const y0 = Math.floor(y * sc), y1 = Math.max(y0 + 1, Math.floor((y + 1) * sc));
    for (let yy = y0; yy < y1; yy++) {
      for (let xx = x0; xx < x1; xx++) {
        const i = (yy * img.w + xx) * img.bpp;
        r += img.data[i]; g += img.data[i + 1]; b += img.data[i + 2]; n++;
      }
    }
    const o = (y * TW + x) * 4;
    preview[o] = r / n; preview[o + 1] = g / n; preview[o + 2] = b / n; preview[o + 3] = 255;
  }
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(TW, 0); ihdr.writeUInt32BE(TH, 4); ihdr[8] = 8; ihdr[9] = 6;
const raw2 = Buffer.alloc(TH * (1 + TW * 4));
for (let y = 0; y < TH; y++) { raw2[y * (1 + TW * 4)] = 0; preview.copy(raw2, y * (1 + TW * 4) + 1, y * TW * 4, (y + 1) * TW * 4); }
const outPng = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw2)),
  chunk('IEND', Buffer.alloc(0)),
]);
writeFileSync(join(root, 'test', `preview-${mode}.png`), outPng);
console.log(`[test] preview written: test/preview-${mode}.png`);

// verdict
const blackScreen = sum / npix / 255 < 0.01;
console.log(`[test] VERDICT: ${blackScreen ? 'BLACK SCREEN' : 'image OK'} · consoleErrors=${realErrors.length}`);
