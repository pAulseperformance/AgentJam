import { env, runInDurableObject } from 'cloudflare:test';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { JamRoom } from './jam-room';
import { DEFAULT_BPM } from '@/shared/protocol/constants';
import { FREE_MODEL } from '@/shared/ai/models';


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

    it('does not let the room drummer count as a player', async () => {
      const { stub, ws } = await openSocket();
      ws.send(JSON.stringify({ type: 'join_room', name: 'DrumPeer', kind: 'human' }));
      await new Promise(r => setTimeout(r, 40));
      ws.send(JSON.stringify({ type: 'set_backing', drummer: true, bass: false }));
      await new Promise(r => setTimeout(r, 80));

      await runInDurableObject(stub, async (instance: JamRoom) => {
        const room = instance as unknown as {
          layers: Map<string, { peer: { peerId: string } }>;
          noteRing: Array<{ peerId: string; type: string; pitch: string; beatTime: number; velocity: number; duration: number; timestamp: number }>;
          recordEvent: (event: Record<string, unknown>) => void;
          onLayerBar: (layer: unknown) => void;
          othersRecent: (id: string) => Array<{ peerId: string }>;
          lastHumanAt: number;
          isPlayerPeer: (id: string) => boolean;
        };
        const layer = room.layers.get('drummer');
        if (!layer) throw new Error('drummer did not spawn');
        const humanBefore = room.lastHumanAt;
        const now = Date.now();
        const drum = { peerId: layer.peer.peerId, type: 'note_on' as const, pitch: 'A5', beatTime: 0, velocity: 58, duration: 0.5, timestamp: now };
        // Deterministic on purpose: emitBar schedules notes at their own slots, so waiting for a real
        // bar made this test depend on when in the bar it ran. Push and record the drum's note directly.
        room.noteRing.push(drum);
        room.recordEvent(drum);

        // The drum's note IS in the ring everyone hears through.
        expect(room.noteRing.some(n => n.peerId === layer.peer.peerId)).toBe(true);
        // But it is not a player: not in the phrase an agent listens to, not a human at the keys.
        expect(room.othersRecent('another-agent').every(n => n.peerId !== layer.peer.peerId)).toBe(true);
        expect(room.isPlayerPeer(layer.peer.peerId)).toBe(false);

        // A person at the keyboard still counts, in both directions.
        const human = { peerId: 'human-1', type: 'note_on' as const, pitch: 'B4', beatTime: 0, velocity: 70, duration: 0.5, timestamp: now };
        room.noteRing.push(human);
        room.recordEvent(human);
        expect(room.othersRecent('another-agent').some(n => n.peerId === 'human-1')).toBe(true);
        expect(room.lastHumanAt).not.toBe(humanBefore);
      });

      ws.close();
      await new Promise(r => setTimeout(r, 50));
      await settle(stub);
    });

    it('lets the tail decide the stride, where the mean keeps one bar per bar', async () => {
      const { stub, ws } = await openSocket();
      ws.send(JSON.stringify({ type: 'join_room', name: 'TailPeer', kind: 'human' }));
      await new Promise(r => setTimeout(r, 30));
      ws.send(JSON.stringify({ type: 'bpm_change', bpm: 160 }));
      ws.send(JSON.stringify({ type: 'spawn_agent', name: 'Tail Bot', style: 'jazz' }));
      await new Promise(r => setTimeout(r, 60));

      await runInDurableObject(stub, async (instance: JamRoom) => {
        const room = instance as unknown as {
          agents: Map<string, { renderCostMs: number; renderTailMs: number }>;
          strideFor: (agent: unknown) => number;
          renderAgentBar: (agent: unknown) => Promise<void>;
        };
        const agent = [...room.agents.values()][0];
        if (!agent) throw new Error('agent did not spawn');
        room.renderAgentBar = async () => {};

        // 160 BPM is a 1500 ms bar: a 1300 ms mean fits, a 1800 ms tail does not.
        agent.renderCostMs = 1300;
        agent.renderTailMs = 1300;
        expect(room.strideFor(agent)).toBe(1);
        agent.renderTailMs = 1800;
        expect(room.strideFor(agent)).toBe(2);
      });

      ws.close();
      await new Promise(r => setTimeout(r, 50));
      await settle(stub);
    });

    it('warms the model exactly once per room, and no render starts before it answers', async () => {
      const { stub, ws } = await openSocket();

      // The room's model calls in the order it made them. A warm ask is the short one: a bar is asked
      // for 512 tokens, the warm for a word, so this reads what the room SENT and not what it says
      // about itself.
      type ModelCall = { model: string; warm: boolean; issuedAt: number; answeredAt: number };
      const calls: ModelCall[] = [];
      // THE WARM IS HELD OPEN. A render that starts while the model is still loading is the defect
      // this case exists to catch, so the test watches what the room does during the wait.
      let answerTheWarm: () => void = () => {};
      const whileWarmIsLoading = new Promise<void>(resolve => { answerTheWarm = resolve; });

      await runInDurableObject(stub, async (instance: JamRoom) => {
        const room = instance as unknown as {
          env: { AI: { run: (model: string, inputs: unknown) => Promise<unknown> } };
        };
        room.env.AI = {
          run: (model: string, inputs: unknown) => {
            const tokens = Number((inputs as { max_tokens?: number } | null)?.max_tokens ?? 0);
            const call: ModelCall = {
              model,
              warm: tokens < 512,
              issuedAt: Date.now(),
              answeredAt: -1,
            };
            calls.push(call);
            const wait = call.warm ? whileWarmIsLoading : Promise.resolve();
            return wait
              .then(() => ({ response: [{ pitch: 'C4', beatTime: 0, velocity: 90, duration: 0.25 }] }))
              .then(answer => { call.answeredAt = Date.now(); return answer; });
          },
        };
      });

      try {
        ws.send(JSON.stringify({ type: 'join_room', name: 'WarmPeer', kind: 'human' }));
        await new Promise(r => setTimeout(r, 40));

        // ONE WARM, ASKED AS THE ROOM OPENS, for the model this room's agents will spend on.
        expect(calls.length).toBe(1);
        expect(calls[0]?.warm).toBe(true);
        expect(calls[0]?.model).toBe(FREE_MODEL);

        // A RENDER WAITS FOR IT: the agent spawned now asks for no bar while the model loads.
        ws.send(JSON.stringify({ type: 'spawn_agent', name: 'Warm Bot', style: 'jazz' }));
        await new Promise(r => setTimeout(r, 60));
        expect(calls.length).toBe(1);
        expect(calls[0]?.answeredAt).toBe(-1);

        answerTheWarm();
        await new Promise(r => setTimeout(r, 80));

        // AND THE BAR'S OWN CALL COMES AFTER THE WARM ANSWERED, never underneath it.
        const bar = calls.find(c => !c.warm);
        expect(bar).toBeDefined();
        expect(bar?.issuedAt).toBeGreaterThanOrEqual(calls[0]?.answeredAt ?? 0);

        // ONE PER ROOM: a second join buys no second warm, and the count stays exactly one.
        ws.send(JSON.stringify({ type: 'join_room', name: 'SecondPeer', kind: 'human' }));
        await new Promise(r => setTimeout(r, 40));
        expect(calls.filter(c => c.warm).length).toBe(1);
      } finally {
        answerTheWarm();
        ws.close();
        await new Promise(r => setTimeout(r, 50));
        await settle(stub);
      }
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

    describe('the hedged ask', () => {
      /** What the room asked the model, as the test's fake binding received it. */
      type Ask = {
        prompt: string;
        maxTokens: number;
        temperature: number | null;
        issuedAt: number;
        answer: string;
        /** release the answer; the fake holds every bar ask until the test lets it go */
        release: (answer?: string) => void;
      };

      const isBarAsk = (ask: Ask) => ask.maxTokens >= 512;

      /**
       * THE MODEL, AS THE TEST SENDS IT. The warm ask answers at once with one word, so the room's
       * opening is never held. A bar ask is HELD until the test releases it: that is what makes the
       * call counts and the 200 ms gap deterministic, instead of racing the room's next bar line.
       */
      const installModel = async (
        stub: ReturnType<typeof getRoomStub>,
        asks: Ask[],
      ): Promise<void> => {
        await runInDurableObject(stub, async (instance: JamRoom) => {
          const room = instance as unknown as {
            env: { AI: { run: (model: string, inputs: unknown) => Promise<{ response: unknown }> } };
          };
          room.env.AI = {
            run: (_model, inputs) => {
              const input = inputs as {
                max_tokens?: number;
                temperature?: number;
                messages?: Array<{ content: string }>;
              };
              const maxTokens = Number(input.max_tokens ?? 0);
              const prompt = input.messages?.at(-1)?.content ?? '';
              const bar = maxTokens >= 512;
              const ask: Ask = {
                prompt,
                maxTokens,
                temperature: typeof input.temperature === 'number' ? input.temperature : null,
                issuedAt: Date.now(),
                answer: '',
                release: () => {},
              };
              asks.push(ask);
              if (!bar) return Promise.resolve({ response: 'OK' });
              return new Promise(resolve => {
                ask.release = (answer = JSON.stringify([{ pitch: 'C4', beatTime: 0, velocity: 90, duration: 0.5 }])) => {
                  ask.answer = answer;
                  resolve({ response: answer });
                };
              });
            },
          };
        });
      };

      /** The one agent this room spawned, or a failure that names the reason. */
      const theAgent = (instance: JamRoom): {
        busy: boolean;
        queue: Array<{ bar: number; meta: { source?: string; calls?: number; response?: string; latencyMs?: number } | null }>;
      } => {
        const room = instance as unknown as {
          agents: Map<string, {
            busy: boolean;
            queue: Array<{ bar: number; meta: { source?: string; calls?: number; response?: string; latencyMs?: number } | null }>;
          }>;
        };
        const agent = [...room.agents.values()][0];
        if (!agent) throw new Error('agent did not spawn');
        return agent;
      };

      it('asks once per bar while the hedge is off, and reports the setting', async () => {
        const asks: Ask[] = [];
        const { stub, ws } = await openSocket();
        await installModel(stub, asks);

        ws.send(JSON.stringify({ type: 'join_room', name: 'HedgeOffPeer', kind: 'human' }));
        await new Promise(r => setTimeout(r, 40));
        ws.send(JSON.stringify({ type: 'spawn_agent', name: 'Hedge Off Bot', style: 'jazz' }));
        await new Promise(r => setTimeout(r, 120));

        let readBack: { hedge?: boolean } = {};
        await runInDurableObject(stub, async (instance: JamRoom) => {
          // THE DEFAULT IS OFF: the room spends one call until somebody asks for the second.
          expect((instance as unknown as { hedge: boolean }).hedge).toBe(false);
          expect(asks.filter(isBarAsk).length).toBe(1);

          // AND THE SETTING IS READ BACK FROM THE ROOM, not from the sender's intention.
          const health = await instance.fetch(new Request('http://localhost/health'));
          readBack = await health.json() as { hedge?: boolean };
          expect(readBack.hedge).toBe(false);

          // release the held ask so the render lands and the room keeps its slots
          asks.filter(isBarAsk)[0]?.release();
          await new Promise(r => setTimeout(r, 40));
        });

        ws.send(JSON.stringify({ type: 'set_hedge', enabled: true }));
        await new Promise(r => setTimeout(r, 60));

        await runInDurableObject(stub, async (instance: JamRoom) => {
          expect((instance as unknown as { hedge: boolean }).hedge).toBe(true);
          const health = await instance.fetch(new Request('http://localhost/health'));
          expect((await health.json() as { hedge?: boolean }).hedge).toBe(true);
          // PERSISTED, so an eviction does not quietly turn the spend back off.
          const store = (instance as unknown as { ctx: { storage: { get: (key: string) => Promise<unknown> } } }).ctx;
          expect(await store.storage.get('hedge')).toBe(true);
        });

        ws.close();
        await new Promise(r => setTimeout(r, 50));
        await settle(stub);
      });

      it('spends two identical calls 200 ms apart on a hedged bar, and plays the first valid answer', async () => {
        const asks: Ask[] = [];
        const { stub, ws } = await openSocket();
        await installModel(stub, asks);

        ws.send(JSON.stringify({ type: 'join_room', name: 'HedgePeer', kind: 'human' }));
        await new Promise(r => setTimeout(r, 40));
        ws.send(JSON.stringify({ type: 'spawn_agent', name: 'Hedge Bot', style: 'jazz' }));
        await new Promise(r => setTimeout(r, 120));
        ws.send(JSON.stringify({ type: 'set_hedge', enabled: true }));
        await new Promise(r => setTimeout(r, 60));

        await runInDurableObject(stub, async (instance: JamRoom) => {
          const room = instance as unknown as { hedge: boolean };
          expect(room.hedge).toBe(true);
          const agent = theAgent(instance);

          // Clear the spawn render's own ask: the pair this case is about is the next boundary.
          asks.filter(isBarAsk).forEach(a => a.release());
          await new Promise(r => setTimeout(r, 60));
          asks.length = 0;

          const render = (instance as unknown as {
            renderAgentBar: (a: unknown) => Promise<void>;
          }).renderAgentBar(agent);

          // Both calls of the pair exist and are the SAME ASK: a hedge is not a second question.
          for (let i = 0; i < 100 && asks.filter(isBarAsk).length < 2; i++) {
            await new Promise(r => setTimeout(r, 10));
          }
          const pair = asks.filter(isBarAsk);
          expect(pair.length).toBe(2);
          expect(pair[1]?.prompt).toBe(pair[0]?.prompt);
          expect(pair[1]?.maxTokens).toBe(pair[0]?.maxTokens);
          expect(pair[1]?.temperature).toBe(pair[0]?.temperature);
          // 200 ms apart, with the second issued whether or not the first has answered.
          expect((pair[1]?.issuedAt ?? 0) - (pair[0]?.issuedAt ?? 0)).toBeGreaterThanOrEqual(190);

          // THE SECOND ANSWERS FIRST, so a winner cannot be right merely by having been asked first.
          pair[1]?.release(JSON.stringify([{ pitch: 'G5', beatTime: 0, velocity: 90, duration: 0.5 }]));
          await render;

          const bar = agent.queue.find(q => q.meta?.calls === 2);
          expect(bar).toBeDefined();
          expect(bar?.meta?.source).toBe('llm');
          // WHAT SOUNDS IS THE ANSWER THAT ARRIVED FIRST, not the call that left first.
          expect(bar?.meta?.response).toContain('G5');
          expect(bar?.meta?.response).not.toContain('C4');
          // And the bar is charged the whole wait, not just the winning call's own duration.
          expect(bar?.meta?.latencyMs ?? 0).toBeGreaterThanOrEqual(190);

          pair[0]?.release();
        });

        ws.close();
        await new Promise(r => setTimeout(r, 50));
        await settle(stub);
      });
    });
  });
});
