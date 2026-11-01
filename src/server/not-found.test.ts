import { describe, it, expect } from 'vitest';
import worker from './index';

/**
 * A PATH THAT NEVER EXISTED MUST BE A 404, AT THE ADDRESS THAT ASKED.
 *
 * Measured 2026-11-01 by the estate's painted-page sweep: `/jam/zz-page-values-20261101` answered 200 with
 * the app's own shell while `zpe.vc/zz-page-values-20261101` answered a real 404. The cause was a fallback
 * that served the shell for every extension-less path under the mount, which existed for client routes the
 * app does not have (`src/client/App.tsx` never reads the pathname). These tests hold the mount root as the
 * only page, the estate's not-found page for a browser path, and a plain line for a file path.
 */

const INDEX = `<!doctype html><html><head><title>AgentJam — Web DAW Jam Room</title>
<link rel="stylesheet" href="/jam/assets/index-abc.css"></head>
<body><div id="root"></div><script type="module" src="/jam/assets/index-abc.js"></script></body></html>`;

const assets = {
  async fetch(input: RequestInfo | URL) {
    const url = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url);
    if (url.pathname === '/jam/index.html') {
      return new Response(INDEX, { status: 200, headers: { 'content-type': 'text/html' } });
    }
    if (url.pathname === '/jam/assets/index-abc.js') {
      return new Response('console.log(1)', { status: 200, headers: { 'content-type': 'text/javascript' } });
    }
    return new Response('no file', { status: 404 });
  },
};

// No session cookie, so `doorWho` answers without calling the door.
const env = () => ({
  PATH_PREFIX: '/jam',
  MOUNT_ORIGIN: 'https://zpe.vc',
  CANONICAL_HOST: 'jam.zpe.vc',
  DOOR_URL: 'https://auth.zpe.vc',
  ASSETS: assets,
});

const get = (path: string) => worker.fetch(new Request(`https://zpe.vc${path}`), env() as never);

describe('the mount root is the only page', () => {
  it('serves the shell at /jam/', async () => {
    const res = await get('/jam/');
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('<title>AgentJam — Web DAW Jam Room</title>');
    expect(body).toContain('/jam/assets/index-abc.js');
  });

  it('serves the shell at /jam too, because the mount names one address', async () => {
    expect((await get('/jam')).status).toBe(200);
  });

  it('serves a real file the build shipped', async () => {
    const res = await get('/jam/assets/index-abc.js');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('console.log(1)');
  });
});

describe('an address that never existed', () => {
  it('answers 404 with the estate not-found page, not the app shell', async () => {
    const res = await get('/jam/zz-page-values-20261101');
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toContain('text/html');
    const body = await res.text();
    expect(body).toContain('is not here.');
    expect(body).not.toContain('<div id="root"></div>');
    // the page carries the fleet's sheets and a way back, so a person is not stranded
    expect(body).toContain('/jam/_/system/tokens.css');
    expect(body).toContain('href="/jam/"');
  });

  it('answers 404 under a path that looks like a client route', async () => {
    expect((await get('/jam/room/demo')).status).toBe(404);
  });

  it('answers a missing file with one line of text, not a page', async () => {
    const res = await get('/jam/assets/missing.js');
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toContain('text/plain');
    expect(await res.text()).toBe('Not found');
  });
});
