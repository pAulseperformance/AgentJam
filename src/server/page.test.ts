/**
 * page.test.ts — the shell around the bundle, and the one case where it refuses to draw.
 *
 * The fixture is the shape Vite actually ships after `npm run build` (measured 2026-10-30 on jam's dist/jam/index.html):
 * a stylesheet and a module script, both under the mount's `assets/`. The tests read the composed document as text,
 * because the risk here is a page that is quiet: a `<link>` that lost its hooks, a bar whose host is one character
 * wrong, or two titles where a browser shows the second.
 */
import { describe, expect, it } from 'vitest';
import { pageFromIndex } from './page';

const INDEX = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>AgentJam — Web DAW Jam Room</title>
    <link rel="stylesheet" crossorigin href="/jam/assets/index-D2Vxshma.css">
  </head>
  <body>
    <div id="root"></div>
    <script type="module" crossorigin src="/jam/assets/index-DCPGJOPJ.js"></script>
  </body>
</html>`;

describe('pageFromIndex', () => {
  const page = pageFromIndex(INDEX);

  it("wears the fleet's three sheets, resolved under the mount", () => {
    for (const name of ['tokens.css', 'base.css', 'components.css', 'themes/zpe.css']) {
      expect(page).toContain(`href="/jam/_/system/${name}"`);
    }
  });

  it('adopts the estate bar from the zone root', () => {
    expect(page).toContain('href="https://zpe.vc/assets/bar/zpe-bar.css"');
    expect(page).toContain('src="https://zpe.vc/assets/bar/zpe-bar.js"');
    expect(page).toContain('data-zpe-bar');
  });

  it("carries the app's own bundle, its mount point, and its own title once", () => {
    expect(page).toContain('src="/jam/assets/index-DCPGJOPJ.js"');
    expect(page).toContain('href="/jam/assets/index-D2Vxshma.css"');
    expect(page).toContain('<div id="root"></div>');
    expect(page.match(/<title/g)).toHaveLength(1);
    expect(page).toContain('<title>AgentJam — Web DAW Jam Room</title>');
  });

  it('drops a third party tag, which the shell has no way to police', () => {
    const withThirdParty = INDEX.replace('</head>', '<script src="https://cdn.example/x.js"></script>\n</head>');
    const out = pageFromIndex(withThirdParty);
    expect(out).not.toContain('cdn.example');
    // The control: the app's own two tags are still there, so this is a filter and not a blanket omission.
    expect(out).toContain('index-DCPGJOPJ.js');
  });

  it('refuses an index.html with no bundle, rather than drawing an empty room', () => {
    expect(() => pageFromIndex(INDEX.replace(/<script[^>]*><\/script>/, ''))).toThrow(/no bundle script/);
  });
});
