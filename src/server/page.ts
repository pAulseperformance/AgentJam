/**
 * page.ts: the jam page wears the estate's shell instead of being its own document.
 *
 * WHAT WAS WRONG, measured 2026-10-30: `/jam/` answered a 2,033-byte Vite document with one stylesheet of its own
 * (`/jam/assets/index-*.css`, 18,850 B), no fleet sheet and no estate bar. Layer 11 of ADMISSION asks the page to
 * wear the fleet's three sheets and the bar; the app's answer was its bundle's.
 *
 * WHY THE PAGE IS COMPOSED AT REQUEST TIME. Vite owns `index.html` as its entry: it injects the content-hashed
 * bundle tags, and the app's `dist/jam/index.html` is that document. So the worker reads it and hands the shell
 * `zpe-kit/shell.ts` emits, carrying the tiny piece the shell cannot know: the bundle's own two tags. Nothing here
 * is typed twice, because `shell()` is the one implementation of the estate's chrome and this file is the join.
 *
 * THE TITLE IS THE APP'S OWN, read out of index.html rather than retyped here, so the copy the app ships is the
 * copy the shell prints.
 */

import { shell } from 'zpe-kit/shell';

/** The bar's sheet and script, served from the zone root: same origin as the page, so no CSP entry is owed. */
const BAR_HOST = 'https://zpe.vc/assets/bar';

const SCRIPT = /<script[^>]*\bsrc=[^>]*><\/script>/gi;
const SHEET = /<link[^>]*\brel="(?:stylesheet|modulepreload)"[^>]*>/gi;

/** The bundle tags Vite injected, in document order, and only those: a third-party tag is left out. */
function bundleTags(indexHtml: string): { scripts: string[]; sheets: string[] } {
  const own = (tag: string) => /[^"]*\/assets\//i.test(tag);
  return {
    scripts: (indexHtml.match(SCRIPT) ?? []).filter(own),
    sheets: (indexHtml.match(SHEET) ?? []).filter(own),
  };
}

/**
 * The document for a client route under the mount.
 *
 * A blank page is the failure this guards: an index.html with no bundle script means the build did not land, and a
 * shell around an empty `#root` would look like a healthy page until the visitor typed a room name.
 */
export function pageFromIndex(indexHtml: string, mount = '/jam/'): string {
  const { scripts, sheets } = bundleTags(indexHtml);
  if (scripts.length === 0) throw new Error('index.html names no bundle script: the page would render blank');
  const title = (indexHtml.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] ?? 'AgentJam').trim();
  return shell({
    title,
    mount,
    width: 'wide',
    brand: { name: 'AgentJam', href: mount },
    foot: 'AgentJam on zpe.vc',
    head: sheets.join('\n'),
    body: `<div id="root"></div>\n${scripts.join('\n')}`,
    bar: { host: BAR_HOST },
  });
}
