// GARGANTUA — zero-dependency static file server (Node 18+).
// Usage: node tools/serve.mjs [port]
import { createServer } from 'node:http';
import { stat, readFile } from 'node:fs/promises';
import { join, normalize, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const port = parseInt(process.argv[2] || process.env.PORT || '8090', 10);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.map': 'application/json',
  '.md': 'text/plain; charset=utf-8',
};

const server = createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p === '/') p = '/index.html';
    const file = normalize(join(root, p));
    if (!file.startsWith(root)) { res.writeHead(403).end('forbidden'); return; }
    const st = await stat(file).catch(() => null);
    if (!st || !st.isFile()) { res.writeHead(404).end('not found'); return; }
    res.writeHead(200, {
      'Content-Type': MIME[extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(await readFile(file));
  } catch (e) {
    res.writeHead(500).end('server error: ' + e.message);
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`[gargantua] serving ${root}`);
  console.log(`[gargantua] open  http://127.0.0.1:${port}`);
});
server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.log(`[gargantua] port ${port} is already in use.`);
    console.log(`[gargantua] close the other server, or use another port:`);
    console.log(`[gargantua]   node tools/serve.mjs 8081`);
    process.exit(1);
  }
  throw e;
});
