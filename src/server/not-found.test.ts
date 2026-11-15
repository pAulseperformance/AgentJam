import { describe, it, expect } from 'vitest';
import worker from './index';
import { BUILD } from './build-manifest';

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

/**
 * THE BAND IS ONE ELEMENT, AND IT IS THE PAGE'S ONLY CLOSE.
 *
 * The same shape zpe-tv shipped for its miss page (assertEndsInTheEstateBand, card t_9e6696bf): one `<footer>`,
 * one `data-zpe-foot`, the `data-zpe-about` element, the band's own sheet and operator, no pre-band `mfoot`, and
 * the five facts read back against the signed manifest. Written once and called by BOTH pages, because the defect
 * this card fixed was one page reading OK while its sibling drifted: the landing page's assertions could not see
 * the 404's.
 */
const fact = (html: string, name: string): string => {
  const found = html.match(new RegExp(`<span[^>]*data-zpe="${name}"[^>]*>([^<]*)</span>`, 'i'));
  return found ? found[1].trim() : '';
};

function assertEndsInTheEstateBand(html: string, page: string): void {
  expect((html.match(/<footer\b/gi) ?? []).length, `${page}: a page ends once`).toBe(1);
  // the boundary matters: `data-zpe-foot-sheet` on a <link> is a sheet, not a band
  expect((html.match(/data-zpe-foot(?=[\s>"'])/g) ?? []).length, `${page}: one estate band, and it is the footer`).toBe(1);
  expect(html, `${page}: the footer is the about element`).toMatch(/<footer[^>]*\bdata-zpe-about\b[^>]*>/);
  expect(html, `${page}: the band links its own sheet`).toContain('href="https://zpe.vc/assets/bar/zpe-foot.css"');
  expect(html, `${page}: the band names the operator`).toContain('Zero-Point Energy Ventures');
  expect((html.match(/class="mfoot"/g) ?? []).length, `${page}: the pre-band footer is gone`).toBe(0);

  expect(fact(html, 'app'), `${page}: the band names the app`).toBe('jam');
  expect(fact(html, 'version'), `${page}: the band carries the manifest's version`).toBe(BUILD.version);
  expect(fact(html, 'commit'), `${page}: the footer carries a full sha, never a short one`).toMatch(/^[0-9a-f]{40}$/);
  expect(fact(html, 'commit'), `${page}: the band carries the manifest's commit`).toBe(BUILD.commit);
  // `built` is not a <span>: the row shows a human date inside a machine-readable <time>
  const built = html.match(/<time[^>]*data-zpe="built"[^>]*datetime="([^"]+)"/);
  expect(built, `${page}: the build time is on the page`).not.toBeNull();
  expect(new Date(built?.[1] ?? '').toISOString(), `${page}: the date is the manifest's`).toBe(
    new Date(BUILD.published_at).toISOString(),
  );
}

describe('the mount root is the only page', () => {
  it('serves the shell at /jam/', async () => {
    const res = await get('/jam/');
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('<title>AgentJam — Web DAW Jam Room</title>');
    expect(body).toContain('/jam/assets/index-abc.js');
    // THE PAGE AND ITS 404 WEAR THE SAME BAND, asserted by the same helper so one cannot drift from the other
    assertEndsInTheEstateBand(body, '/jam/');
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

  it('names the operator on the 404 as well as the page', async () => {
    // THE OPT-IN IS FORWARDED, not re-decided: `notFound()` takes its own options object, so an app that
    // opted in and did not pass the flag named the operator on every page but its 404s.
    const body = await (await get('/jam/zz-page-values-20261101')).text();
    expect(body).toContain('data-zpe-foot');
    expect(body).toContain('Zero-Point Energy Ventures');
  });

  it('ends once, in the estate band, carrying the five build facts', async () => {
    // Measured live 2026-11-15 03:02 ICT: `GET https://zpe.vc/jam/__footer_sweep_miss` answered 404 with
    // `data-zpe-foot`=1 and `data-zpe-about`=0, so `tools/footer_sweep.py` in app-registry read jam as
    // NO-FOOTER on the miss path while its root read OK — one app, two verdicts. The band is the whole
    // footer (one element), not a second one beside the shell's own line.
    const res = await get('/jam/__footer_sweep_miss');
    // the sentinel the sweep asks MUST stay an HTML 404: a 200 here would be the shell pretending to be a page
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toContain('text/html');
    assertEndsInTheEstateBand(await res.text(), 'the miss page');
  });

  it('answers a missing file with one line of text, not a page', async () => {
    const res = await get('/jam/assets/missing.js');
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toContain('text/plain');
    expect(await res.text()).toBe('Not found');
  });
});
