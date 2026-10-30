// Server entry point, Cloudflare Worker
// Exports the JamRoom Durable Object class and handles asset fallthrough

import { machineRefusal } from 'zpe-kit';
import { FONT_NAME, SHEET_PATH, fontResponse, sheetResponse } from 'zpe-kit/shell';
import { doorWho, doorSignIn } from './door';
import { pageFromIndex } from './page';

export { JamRoom } from './jam-room';

/**
 * The tier travels to the room on this header; a browser cannot set it on a WS upgrade.
 * A Worker module may only EXPORT handlers and DO classes, so this stays local (jam-room.ts keeps
 * its own copy of the same string).
 */
const TIER_HEADER = 'x-jam-tier';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const requestUrl = new URL(request.url);

    // WHERE THIS APP IS MOUNTED.
    //
    // The app used to live at its own name (jam.zpe.vc) and now lives at a path on the universe's
    // apex (zpe.vc/jam). MEASURED 2026-10-30: the old name is NOT a page door. A GET of jam.zpe.vc/
    // is answered by a layer ABOVE this Worker with a 302 to /services, while a HEAD reaches this
    // Worker and gets the 301 below. So this branch is correct for whatever reaches here, and the
    // only page door is the mount (docs/FINDINGS.md, DECISIONS.md).
    // One deployment still answers both, for the API:
    //   - the mount serves the same build (nested under dist/jam/, so the asset layer finds it by
    //     path and the old name's root matches no file),
    //   - the room socket answers under the mount AND on the old name.
    const mount = String(env.PATH_PREFIX || '').replace(/\/+$/, '');
    const mountOrigin = new URL(env.MOUNT_ORIGIN || 'https://zpe.vc');
    const outer = requestUrl.pathname;
    // A host that is NEITHER the mount's host NOR the app's own name is a preview address (the
    // workers.dev door): it is served AS IF it were at the mount, so retiring the name's root does
    // not quietly 404 the preview.
    const previewHost =
      Boolean(mount) &&
      requestUrl.hostname !== mountOrigin.hostname &&
      (!env.CANONICAL_HOST || requestUrl.hostname !== env.CANONICAL_HOST);
    const underMount = Boolean(mount) && (previewHost || outer === mount || outer.startsWith(`${mount}/`));
    const isApi = outer === '/api' || outer.startsWith('/api/');

    if (
      mount &&
      !underMount &&
      !isApi &&
      (request.method === 'GET' || request.method === 'HEAD') &&
      requestUrl.hostname !== mountOrigin.hostname &&
      (!env.CANONICAL_HOST || requestUrl.hostname === env.CANONICAL_HOST)
    ) {
      const to = `${mountOrigin.origin}${mount}${outer === '/' ? '/' : outer}${requestUrl.search}`;
      return new Response(null, { status: 301, headers: { location: to, 'cache-control': 'no-store' } });
    }

    // THE STRIPPED URL IS WHAT EVERYTHING BELOW SEES, built once: the room id is split off the
    // pathname, and a mount left on it would name the room 'jam'.
    const url = underMount
      ? new URL(`${requestUrl.origin}${outer.slice(mount.length) || '/'}${requestUrl.search}`)
      : requestUrl;

    // WHO IS ASKING: one question to the door, answered once per request. Both entry points below
    // need it, and the answer decides which agent a room may spawn and which models it may pick.
    const who = await doorWho(request, env.DOOR_URL);
    const tier = who ? 'signed' : 'public';

    // The client's own read of its tier, so the page can offer the door instead of silently
    // downgrading a signed-in visitor who happens to hold a cookie from another tab.
    if (url.pathname === '/api/whoami') {
      return Response.json(
        { signedIn: Boolean(who), name: who?.name ?? null, tier, signInUrl: who ? null : doorSignIn(`${mountOrigin.origin}${mount}/`, env.DOOR_URL) },
        { headers: { 'cache-control': 'no-store' } },
      );
    }

    // API routes: upgrade WebSocket connections to JamRoom DO
    if (url.pathname.startsWith('/api/room/')) {
      const roomId = url.pathname.split('/api/room/')[1];
      if (!roomId) {
        return new Response('Room ID required', { status: 400 });
      }

      const id = env.JAM_ROOM.idFromName(roomId);
      const stub = env.JAM_ROOM.get(id);
      // The DO is handed the STRIPPED request, so its own path checks ('/ws', '/health') and any
      // future URL parsing see the path the app means, not the mount. The tier rides a header the
      // browser cannot forge on an upgrade: it is computed here, from the door's answer.
      const headers = new Headers(request.headers);
      headers.set(TIER_HEADER, tier);
      // A socket upgrade carries NO body. Passing `body: request.body` with a null stream plus
      // `duplex` is what silently killed the upgrade in local dev, so the body is only forwarded
      // when there is one.
      const init: RequestInit = { method: request.method, headers };
      if (request.method !== 'GET' && request.method !== 'HEAD' && request.body) {
        init.body = request.body;
        (init as { duplex?: string }).duplex = 'half';
      }
      const forwarded = new Request(underMount ? url.toString() : requestUrl.toString(), init);
      const answer = await stub.fetch(forwarded);
      // A 404 out of the room's Durable Object is still a machine path's answer: the body it ships is
      // `text/plain`, and a client that branches on `application/problem+json` reads that as a success.
      if (answer.status === 404) {
        const refusal = machineRefusal(url.pathname);
        if (refusal) return refusal;
      }
      return answer;
    }

    // THE FLEET'S SHEETS, under the mount. The shell this page wears links four of them at
    // `/jam/_/system/*` and one font, and they are served from this package rather than copied into
    // `public/`: a copy is a second version of the design system that drifts the moment it changes.
    if (url.pathname.startsWith(SHEET_PATH)) {
      const name = url.pathname.slice(SHEET_PATH.length);
      if (name === FONT_NAME) {
        const font = fontResponse(mount);
        if (font) return font;
      }
      const sheet = sheetResponse(name, mount);
      if (sheet) return sheet;
    }

    // A MACHINE PATH NEVER ANSWERS A PAGE. `/api/` and `/_/` have their routes above, so a path that
    // reaches this point in either namespace has none; `/health` is reserved because a monitor reading
    // 200 from this app's own shell would call a jam room healthy on its landing page. Measured
    // 2026-10-30: `/jam/health` answered `text/html` at 1,670 B, and `/jam/_/api/v1` the shell.
    const refusal = machineRefusal(url.pathname, ['/health']);
    if (refusal) return refusal;

    // A CLIENT ROUTE UNDER THE MOUNT (a hard refresh on a screen) gets the mount's own shell: the
    // asset layer's SPA fallback would serve the assets-directory ROOT shell, which is the wrong
    // door's bundle. A request that names a FILE is the asset layer's business.
    if (underMount && env.ASSETS && !/\.(?:[a-z0-9]+)$/i.test(url.pathname)) {
      const doc = await env.ASSETS.fetch(new URL(`${mount}/index.html`, requestUrl).toString());
      if (doc.status === 200) {
        // THE ESTATE'S SHELL AROUND THE APP'S BUNDLE. `pageFromIndex` reads Vite's two tags out of the
        // document and hands them to `shell()`, so this page wears the fleet's sheets and the bar the
        // way every other page on the estate does (ADMISSION layer 11).
        return new Response(pageFromIndex(await doc.text(), mount), {
          status: 200,
          headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
        });
      }
    }

    // Anything the asset layer does not answer is a genuine 404 (the build nests its files under
    // dist/jam/, so the asset layer already matched a real file before this point).
    if (env.ASSETS) {
      const asset = await env.ASSETS.fetch(request);
      if (asset.status !== 404) return asset;
    }
    return new Response('Not found', { status: 404 });
  },
};

interface Env {
  JAM_ROOM: DurableObjectNamespace;
  ASSETS?: Fetcher;
  PATH_PREFIX?: string;
  MOUNT_ORIGIN?: string;
  CANONICAL_HOST?: string;
  DOOR_URL?: string;
}
