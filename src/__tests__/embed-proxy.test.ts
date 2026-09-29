// src/__tests__/embed-proxy.test.ts
// The Hermes desktop window loads Workable in a sandboxed frame (Origin: null).
// src/proxy.ts must let it read the local API only with the embed token, and
// never let it change the Hermes install.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { proxy } from '@/proxy';

const TOKEN = 'test-embed-token-1234567890';
let previous: string | undefined;

beforeAll(() => { previous = process.env.WORKABLE_EMBED_TOKEN; process.env.WORKABLE_EMBED_TOKEN = TOKEN; });
afterAll(() => { process.env.WORKABLE_EMBED_TOKEN = previous; });

function req(path: string, init: { method?: string; origin?: string } = {}) {
  const headers = new Headers();
  if (init.origin) headers.set('origin', init.origin);
  return new NextRequest(`http://localhost:3000${path}`, { method: init.method ?? 'GET', headers });
}

describe('embed proxy', () => {
  it('leaves normal browser requests alone', () => {
    const res = proxy(req('/api/hermes/snapshot'));
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
    expect(proxy(req('/api/hermes/apply', { method: 'POST', origin: 'http://localhost:3000' })).headers.get('x-middleware-next')).toBe('1');
  });

  it('refuses framed requests without the right token', async () => {
    expect(proxy(req('/api/hermes/snapshot', { origin: 'null' })).status).toBe(403);
    expect(proxy(req('/api/hermes/snapshot?embed=wrong', { origin: 'null' })).status).toBe(403);
  });

  it('lets framed requests with the token through, with CORS', () => {
    const res = proxy(req(`/api/hermes/snapshot?embed=${TOKEN}`, { origin: 'null' }));
    expect(res.headers.get('x-middleware-next')).toBe('1');
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('never lets the frame preview or apply edits, even with the token', async () => {
    for (const path of ['/api/hermes/plan', '/api/hermes/apply']) {
      const res = proxy(req(`${path}?embed=${TOKEN}`, { method: 'POST', origin: 'null' }));
      expect(res.status).toBe(403);
      expect((await res.json()).error).toMatch(/browser/);
    }
  });

  it('answers preflights and serves fonts to the frame', () => {
    expect(proxy(req('/api/graph-state', { method: 'OPTIONS', origin: 'null' })).status).toBe(204);
    expect(proxy(req('/_next/static/media/x.woff2', { origin: 'null' })).headers.get('access-control-allow-origin')).toBe('*');
  });

  it('refuses everything framed when no token is configured', () => {
    process.env.WORKABLE_EMBED_TOKEN = '';
    expect(proxy(req(`/api/hermes/snapshot?embed=${TOKEN}`, { origin: 'null' })).status).toBe(403);
    process.env.WORKABLE_EMBED_TOKEN = TOKEN;
  });
});
