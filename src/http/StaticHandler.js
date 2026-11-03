import { readFile } from 'node:fs/promises';
import path from 'node:path';

// Роздача файлів із public/. Має той самий метод handle(req, res, ctx), що й контролери,
// тож Router викликає його однаково (поліморфізм: «щось, що вміє handle»).
export class StaticHandler {
  static MIME = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
  };

  #publicDir;

  constructor(publicDir) {
    this.#publicDir = publicDir;
  }

  async handle(req, res, { url }) {
    let rel;
    try {
      rel = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname);
    } catch {
      res.writeHead(400).end('Bad request'); // некоректне %-кодування (наприклад, /%zz)
      return;
    }
    const file = path.normalize(path.join(this.#publicDir, rel));

    if (!file.startsWith(this.#publicDir + path.sep)) {
      res.writeHead(403).end('Forbidden'); // захист від ../ (path traversal)
      return;
    }
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'Content-Type': StaticHandler.MIME[path.extname(file)] || 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404).end('Not found');
    }
  }
}
