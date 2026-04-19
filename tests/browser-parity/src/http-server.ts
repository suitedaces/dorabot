// http-server — tiny fixture server used by the parity suite. serves static
// html from ../fixtures/, plus a handful of dynamic endpoints so we can test
// cookies (Set-Cookie header), network inspection (json response), and
// redirects.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, resolve, extname } from 'node:path';
import { existsSync } from 'node:fs';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

export type HttpServerHandle = {
  port: number;
  base: string; // e.g. http://127.0.0.1:12345
  close: () => Promise<void>;
};

export async function startFixtureServer(fixturesDir: string): Promise<HttpServerHandle> {
  const absFixtures = resolve(fixturesDir);

  const server = createServer(async (req, res) => {
    try {
      await handle(req, res, absFixtures);
    } catch (err) {
      res.statusCode = 500;
      res.end(err instanceof Error ? err.message : String(err));
    }
  });

  await new Promise<void>((done) => server.listen(0, '127.0.0.1', () => done()));
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('failed to bind server');
  const port = addr.port;

  return {
    port,
    base: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((done) => server.close(() => done())),
  };
}

async function handle(req: IncomingMessage, res: ServerResponse, fixturesDir: string): Promise<void> {
  const url = new URL(req.url || '/', `http://${req.headers.host}`);

  // dynamic endpoints first
  if (url.pathname === '/set-cookie') {
    const name = url.searchParams.get('name') || 'test';
    const value = url.searchParams.get('value') || 'v';
    res.setHeader('Set-Cookie', `${name}=${value}; Path=/; SameSite=Lax`);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(`<!doctype html><html><body>set cookie ${name}=${value}</body></html>`);
    return;
  }

  if (url.pathname === '/api/echo') {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({
      ok: true,
      query: Object.fromEntries(url.searchParams.entries()),
      ts: Date.now(),
    }));
    return;
  }

  if (url.pathname === '/redirect') {
    const to = url.searchParams.get('to') || '/basic.html';
    res.statusCode = 302;
    res.setHeader('Location', to);
    res.end();
    return;
  }

  // static file from fixtures/
  let relPath = url.pathname === '/' ? '/index.html' : url.pathname;
  if (relPath.includes('..')) {
    res.statusCode = 400;
    res.end('bad path');
    return;
  }
  const filePath = join(fixturesDir, relPath);
  if (!existsSync(filePath)) {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end(`not found: ${relPath}`);
    return;
  }
  const ext = extname(filePath).toLowerCase();
  res.setHeader('Content-Type', MIME[ext] || 'application/octet-stream');
  const data = await readFile(filePath);
  res.end(data);
}
