// Server entry point — Cloudflare Worker
// Exports the JamRoom Durable Object class and handles asset fallthrough

export { JamRoom } from './jam-room';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // API routes: upgrade WebSocket connections to JamRoom DO
    if (url.pathname.startsWith('/api/room/')) {
      const roomId = url.pathname.split('/api/room/')[1];
      if (!roomId) {
        return new Response('Room ID required', { status: 400 });
      }

      const id = env.JAM_ROOM.idFromName(roomId);
      const stub = env.JAM_ROOM.get(id);
      return stub.fetch(request);
    }

    // Everything else falls through to assets (SPA)
    return new Response('Not found', { status: 404 });
  },
};

interface Env {
  JAM_ROOM: DurableObjectNamespace;
}
