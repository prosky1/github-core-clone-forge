// app.ts — one-process HTTP server: REST v3, GraphQL, MCP, and git smart HTTP.
//
// Every route is served from a single in-memory ForgeStore. The only unauthenticated
// endpoint is /healthz; everything else needs `Authorization: Bearer <MAKEFUN_SHOP_TOKEN>`
// (when the token is set), matching the suite's expectations.

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { ForgeStore } from './store.ts';
import { handleRest } from './rest.ts';
import { handleGraphQL } from './graphql.ts';
import { handleMcp } from './mcp.ts';
import { handleGit, parseGitRoute } from './git.ts';

const MAX_BODY_BYTES = 64 * 1024 * 1024;

export function createForgeServer(store: ForgeStore, token: string) {
  return createServer((req, res) => {
    void handleRequest(store, token, req, res).catch((err) => {
      // One bad request must never kill the process: answer 500 and keep serving.
      if (!res.headersSent) {
        res.writeHead(500, { 'content-type': 'application/json' });
      }
      try {
        res.end(JSON.stringify({ message: `Internal Server Error: ${(err as Error).message}` }));
      } catch {
        // The socket is already gone; nothing more to do.
      }
    });
  });
}

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = chunk as Buffer;
    total += buffer.length;
    if (total > MAX_BODY_BYTES) throw new Error('request body too large');
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

function parseJsonBody(raw: Buffer): unknown | 'malformed' {
  if (raw.length === 0) return null;
  try {
    return JSON.parse(raw.toString('utf8')) as unknown;
  } catch {
    return 'malformed';
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = `${JSON.stringify(body)}\n`;
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text),
  });
  res.end(text);
}

function bearerOk(token: string, req: IncomingMessage): boolean {
  const header = req.headers.authorization ?? '';
  if (!header.startsWith('Bearer ')) return false;
  const presented = header.slice('Bearer '.length).trim();
  if (presented.length === 0) return false;
  if (token === '') return true;
  return presented === token;
}

async function handleRequest(store: ForgeStore, token: string, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const path = url.pathname;
  const method = (req.method ?? 'GET').toUpperCase();
  const query = url.searchParams;

  // Boot check: no auth, always up.
  if (path === '/healthz' && method === 'GET') {
    sendJson(res, 200, { ok: true });
    return;
  }

  // Git smart HTTP: /{owner}/{repo}.git/{info/refs,git-upload-pack,git-receive-pack}
  const gitRoute = parseGitRoute(path, query);
  if (gitRoute !== null) {
    if (!bearerOk(token, req)) {
      sendJson(res, 401, { message: 'Requires authentication' });
      return;
    }
    const body = await readBody(req);
    const protocolV2 = (req.headers['git-protocol'] ?? '') === 'version=2';
    let result: { status: number; contentType: string; body: Buffer };
    try {
      result = handleGit(store, gitRoute, method, body, protocolV2);
    } catch (err) {
      // A malformed git request must not crash the server: any response is fine.
      sendJson(res, 400, { message: (err as Error).message });
      return;
    }
    res.writeHead(result.status, {
      'content-type': result.contentType,
      'content-length': result.body.length,
    });
    res.end(result.body);
    return;
  }

  if (path === '/api/graphql' && method === 'POST') {
    const body = await readBody(req);
    await handleGraphQL({ store, token }, req, res, body.toString('utf8'));
    return;
  }

  if (path === '/mcp' && (method === 'POST' || method === 'DELETE')) {
    const body = await readBody(req);
    await handleMcp({ store, token }, req, res, body.toString('utf8'));
    return;
  }

  if (path.startsWith('/api/v3')) {
    const body = await readBody(req);
    const handled = await handleRest(
      { store, token },
      req,
      res,
      path,
      method,
      query,
      parseJsonBody(body),
    );
    if (handled) return;
  }

  sendJson(res, 404, { message: 'Not Found' });
}
