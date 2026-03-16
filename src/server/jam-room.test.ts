import { env, runInDurableObject } from 'cloudflare:test';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { JamRoom } from './jam-room';
import type { RoomState, Peer } from '../shared/protocol/types';

describe('JamRoom Durable Object', () => {
  const getRoomStub = () => {
    // Cast to any to bypass the strict Env typing for tests
    const typedEnv = env as any;
    const id = typedEnv.JAM_ROOM.idFromName(`test-room-${crypto.randomUUID()}`);
    return typedEnv.JAM_ROOM.get(id);
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('HTTP Endpoints', () => {
    it('returns 426 Upgrade Required for missing WebSocket upgrade', async () => {
      const stub = getRoomStub();
      const req = new Request('http://localhost/api/room/test-1/ws');
      const res = await stub.fetch(req);
      
      expect(res.status).toBe(426);
      expect(await res.text()).toBe('Expected WebSocket upgrade');
    });

    it('returns 200 OK with metrics for /health', async () => {
      const stub = getRoomStub();
      const req = new Request('http://localhost/api/room/test-1/health');
      const res = await stub.fetch(req);
      
      expect(res.status).toBe(200);
      const data = await res.json() as Record<string, unknown>;
      
      expect(data.peers).toBeGreaterThanOrEqual(0);
      expect(data.agents).toBeGreaterThanOrEqual(0);
      expect(typeof data.uptimeMs).toBe('number');
    });

    it('returns 404 for unknown endpoints', async () => {
      const stub = getRoomStub();
      const req = new Request('http://localhost/api/room/test-1/unknown');
      const res = await stub.fetch(req);
      
      expect(res.status).toBe(404);
      await res.text(); // Consume body to close stream!
    });
  });

  describe('WebSocket Lifecycle & Messaging', () => {
    it('handles basic peer join and sends room state', async () => {
      const stub = getRoomStub();
      
      await runInDurableObject(stub, async (instance: JamRoom) => {
        // We can test internal instance state here if needed
        expect(instance).toBeDefined();
      });

      // E2E style WebSocket test
      const req = new Request('http://localhost/api/room/test-1/ws', {
        headers: { Upgrade: 'websocket' }
      });
      const res = await stub.fetch(req);
      expect(res.status).toBe(101);
      
      const ws = res.webSocket;
      expect(ws).toBeDefined();
      
      if (!ws) return;
      
      ws.accept();
      
      // Send join_room message
      ws.send(JSON.stringify({
        type: 'join_room',
        name: 'TestPeer',
        kind: 'human'
      }));

      // NOTE: In the worker test env, getting WS messages back is complex
      // because we'd need to mock the client side. We verify internal state instead.
      
      await runInDurableObject(stub, async (instance: JamRoom) => {
        // Check that peer was added
        // The maps are private, so we trigger a health check to verify indirectly
        const healthRes = await instance.fetch(new Request('http://localhost/health'));
        const body = await healthRes.json() as { peers: number };
        expect(body.peers).toBe(1);
      });
      
      ws.close();
      
      // Give the DO a tick to process the close event and clear its intervals,
      // otherwise Vitest throws "Failed to pop isolated storage stack frame"
      await new Promise(resolve => setTimeout(resolve, 50));
      
      // Force cleanup just in case
      await runInDurableObject(stub, async (instance: JamRoom) => {
        // @ts-expect-error - accessing private method for test cleanup
        instance.cleanupIntervals();
      });
    });
  });
});
