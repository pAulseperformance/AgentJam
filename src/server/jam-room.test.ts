import { env, runInDurableObject } from 'cloudflare:test';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { JamRoom } from './jam-room';
import { DEFAULT_BPM } from '@/shared/protocol/constants';


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

  describe('the bar invariant and the tempo door', () => {
    const openSocket = async () => {
      const stub = getRoomStub();
      const res = await stub.fetch(new Request('http://localhost/api/room/test-1/ws', {
        headers: { Upgrade: 'websocket' },
      }));
      expect(res.status).toBe(101);
      const ws = res.webSocket;
      if (!ws) throw new Error('no websocket');
      ws.accept();
      return { stub, ws };
    };

    const settle = async (stub: ReturnType<typeof getRoomStub>) => {
      await runInDurableObject(stub, async (instance: JamRoom) => {
        // @ts-expect-error - private method, called so the isolated storage frame can be popped
        instance.cleanupIntervals();
      });
    };

    it('announces one bar when the bar line fires twice in the same bar', async () => {
      const { stub, ws } = await openSocket();
      ws.send(JSON.stringify({ type: 'join_room', name: 'BarPeer', kind: 'human' }));
      ws.send(JSON.stringify({ type: 'spawn_agent', name: 'Bar Bot', style: 'jazz' }));
      await new Promise(r => setTimeout(r, 60));

      await runInDurableObject(stub, async (instance: JamRoom) => {
        const room = instance as unknown as {
          agents: Map<string, { lastPublishedAt: number }>;
          onAgentBar: (agent: unknown) => void;
          renderAgentBar: (agent: unknown) => Promise<void>;
        };
        const agent = [...room.agents.values()][0];
        if (!agent) throw new Error('agent did not spawn');
        // The render is not what this test is about: it would call the model.
        room.renderAgentBar = async () => {};

        room.onAgentBar(agent);
        const afterFirst = agent.lastPublishedAt;
        expect(afterFirst).toBeGreaterThan(0);

        room.onAgentBar(agent);
        // The second fire is inside the same bar, so it is refused and the stamp does not move.
        expect(agent.lastPublishedAt).toBe(afterFirst);
      });

      ws.close();
      await new Promise(r => setTimeout(r, 50));
      await settle(stub);
    });

    it('refuses a tempo the grid cannot use, and keeps the room where it was', async () => {
      const { stub, ws } = await openSocket();
      ws.send(JSON.stringify({ type: 'join_room', name: 'TempoPeer', kind: 'human' }));
      await new Promise(r => setTimeout(r, 30));
      ws.send(JSON.stringify({ type: 'bpm_change', bpm: 0 }));
      await new Promise(r => setTimeout(r, 50));

      await runInDurableObject(stub, async (instance: JamRoom) => {
        // @ts-expect-error - private state, read to prove the refusal
        expect(instance.roomState.bpm).toBe(DEFAULT_BPM);
      });

      ws.close();
      await new Promise(r => setTimeout(r, 50));
      await settle(stub);
    });
  });
});
