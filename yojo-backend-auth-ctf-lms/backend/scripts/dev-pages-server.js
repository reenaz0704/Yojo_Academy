/*
 * Local static server for the Yojo HTML pages (development only).
 *   node scripts/dev-pages-server.js [pagesDir] [port]
 * Defaults: the folder two levels above backend/ ("Yojo academy"), port 8000, bound to 127.0.0.1.
 * Serves only the site's own files: top-level .html/.js/.css and the assets/ folder. Dot-files and every other
 * folder (backend, mission-api, backups) are refused, so .env and source code are never exposed.
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const root = path.resolve(process.argv[2] || path.join(__dirname, '..', '..', '..'));
const port = Number(process.argv[3] || 8000);
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
  '.pdf': 'application/pdf',
};

function allowed(rel) {
  const parts = rel.split('/');
  if (parts.some((p) => !p || p.startsWith('.'))) return false;
  if (parts.length === 1) return ['.html', '.js', '.css'].includes(path.extname(rel).toLowerCase());
  return parts[0] === 'assets' && Object.prototype.hasOwnProperty.call(TYPES, path.extname(rel).toLowerCase());
}

http
  .createServer((req, res) => {
    let rel;
    try {
      rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '') || 'index.html';
    } catch {
      rel = '';
    }
    const file = path.join(root, rel);
    if (!['GET', 'HEAD'].includes(req.method) || !allowed(rel) || !file.startsWith(root + path.sep)) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('Not found');
    }
    fs.stat(file, (err, st) => {
      if (err || !st.isFile()) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        return res.end('Not found');
      }
      res.writeHead(200, {
        'Content-Type': TYPES[path.extname(file).toLowerCase()],
        'Content-Length': st.size,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      });
      if (req.method === 'HEAD') return res.end();
      fs.createReadStream(file).pipe(res);
    });
  })
  .listen(port, '127.0.0.1', () => console.log(`Yojo pages: http://localhost:${port}/ (serving ${root})`));
