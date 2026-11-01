/**
 * THE PHRASE ASK, IN THE ROOM.
 *
 * Off, the agent is asked for one bar at a time. On, it is asked once for four bars on the bar that
 * opens its phrase, and those four bars are queued at once: three of the four cost no call, and the
 * phrase's ending is part of the idea instead of a separate render.
 *
 * The model here is a stub that answers every ask at once, so the call count is the room's own.
 */
import { env, runInDurableObject } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { RoomStateMessageSchema } from '@/shared/protocol/types';
import { JamRoom } from './jam-room';

const room = () => {
  const typedEnv = env as any;
  return typedEnv.JAM_ROOM.get(typedEnv.JAM_ROOM.idFromName(`phrase-${crypto.randomUUID()}`));
};

/** Four bars, each a line of four notes, in the shape the prompt asks for. */
const PHRASE = JSON.stringify({
  bars: [
    [{ pitch: 'C4', beatTime: 0, velocity: 90, duration: 0.5 }, { pitch: 'D#4', beatTime: 1, velocity: 90, duration: 0.5 },
      { pitch: 'G4', beatTime: 2, velocity: 90, duration: 0.5 }, { pitch: 'D#4', beatTime: 3, velocity: 90, duration: 0.5 }],
    [{ pitch: 'C4', beatTime: 0, velocity: 90, duration: 0.5 }, { pitch: 'D#4', beatTime: 1, velocity: 90, duration: 0.5 },
      { pitch: 'G4', beatTime: 2, velocity: 90, duration: 0.5 }, { pitch: 'A#4', beatTime: 3, velocity: 90, duration: 0.5 }],
    [{ pitch: 'G3', beatTime: 0.5, velocity: 90, duration: 0.5 }, { pitch: 'A#3', beatTime: 1.5, velocity: 90, duration: 0.5 },
      { pitch: 'C4', beatTime: 2.5, velocity: 90, duration: 0.5 }],
    [{ pitch: 'A#3', beatTime: 1, velocity: 80, duration: 1 }, { pitch: 'C4', beatTime: 3, velocity: 80, duration: 1 }],
  ],
});

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

async function withAgent(phraseAsk: boolean, run: (stub: ReturnType<typeof room>, asks: number[][]) => Promise<void>) {
  const stub = room();
  const asks: number[][] = [];
  await runInDurableObject(stub, async (instance: JamRoom) => {
    const typed = instance as unknown as {
      env: { AI: { run: (model: string, inputs: { max_tokens?: number; messages?: Array<{ content: string }> }) => Promise<{ response: unknown }> } };
    };
    typed.env.AI = {
      run: (_model, inputs) => {
        asks.push([Number(inputs.max_tokens ?? 0)]);
        // A WARM ASK wants one word; a bar ask wants a JSON array; a phrase ask wants four.
        const maxTokens = Number(inputs.max_tokens ?? 0);
        if (maxTokens < 512) return Promise.resolve({ response: 'OK' });
        if (maxTokens >= 1500) return Promise.resolve({ response: PHRASE });
        return Promise.resolve({ response: '[{"pitch":"C4","beatTime":0,"velocity":90,"duration":0.5}]' });
      },
    };
  });

  const res = await stub.fetch(new Request('http://localhost/api/room/x/ws', { headers: { Upgrade: 'websocket' } }));
  const ws = res.webSocket!;
  ws.accept();
  await sleep(40);
  ws.send(JSON.stringify({ type: 'join_room', name: 'PhrasePeer', kind: 'human' }));
  await sleep(40);
  if (phraseAsk) {
    ws.send(JSON.stringify({ type: 'set_phrase_ask', enabled: true }));
    await sleep(60);
  }
  ws.send(JSON.stringify({ type: 'spawn_agent', name: 'Phrase Bot', style: 'jazz' }));
  await sleep(400);
  await run(stub, asks);
  ws.close();
  await sleep(60);
  await runInDurableObject(stub, async (instance: JamRoom) => {
    // @ts-expect-error - private method, called so the isolated storage frame can be popped
    instance.cleanupIntervals();
  });
}

describe('the phrase ask', () => {
  it('is off by default and asks for one bar at a time', async () => {
    await withAgent(false, async (stub, asks) => {
      await runInDurableObject(stub, async (instance: JamRoom) => {
        const roomState = (instance as unknown as { roomState: { phraseAsk?: boolean } }).roomState;
        expect(roomState.phraseAsk).not.toBe(true);
      });
      // Every model ask was a bar ask: none of them asked for a phrase's worth of output.
      expect(asks.filter(a => a[0]! >= 1500).length).toBe(0);
    });
  });

  it('asks once for four bars and queues all four when the room turns it on', async () => {
    await withAgent(true, async (stub, asks) => {
      await runInDurableObject(stub, async (instance: JamRoom) => {
        const roomState = (instance as unknown as { roomState: { phraseAsk?: boolean } }).roomState;
        expect(roomState.phraseAsk).toBe(true);
        const agents = (instance as unknown as {
          agents: Map<string, { queue: Array<{ bar: number; notes: unknown[] }> }>;
        }).agents;
        const agent = [...agents.values()][0]!;
        expect(agent.queue.length, 'the phrase queued four bars').toBe(4);
        const bars = agent.queue.map(q => q.bar).sort((a, b) => a - b);
        expect(bars[1]! - bars[0]!).toBe(1);
        expect(bars[3]! - bars[0]!).toBe(3);
        // AND AT LEAST ONE BAR OF IT IS MUSIC: the stub's four bars, through the room's passes.
        expect(agent.queue.some(q => q.notes.length > 0)).toBe(true);
      });
      expect(asks.filter(a => a[0]! >= 1500).length, 'exactly one phrase call').toBe(1);
    });
  });

  it('answers the toggle with a room_state that carries the peers', async () => {
    // THE TOGGLE SPEAKS THE FRAME A JOIN DOES. `peers` is required by the protocol and the client sets
    // its peer list from this frame; the handler used to broadcast room_state without it, so pressing
    // the button emptied every listener's list and the next render threw "Q is not iterable" (a spread
    // of undefined) on the live page.
    const stub = room();
    const res = await stub.fetch(new Request('http://localhost/api/room/x/ws', { headers: { Upgrade: 'websocket' } }));
    const ws = res.webSocket!;
    ws.accept();
    const frames: string[] = [];
    ws.addEventListener('message', (event: MessageEvent) => {
      if (typeof event.data === 'string') frames.push(event.data);
    });
    await sleep(40);
    ws.send(JSON.stringify({ type: 'join_room', name: 'TogglePeer', kind: 'human' }));
    await sleep(80);
    frames.length = 0;
    ws.send(JSON.stringify({ type: 'set_phrase_ask', enabled: true }));
    await sleep(80);

    const states = frames
      .map(f => JSON.parse(f) as { type: string })
      .filter(m => m.type === 'room_state');
    expect(states.length, 'the toggle answers with a room_state').toBeGreaterThan(0);
    for (const state of states) {
      expect(RoomStateMessageSchema.safeParse(state).success, 'the frame parses as room_state').toBe(true);
      expect(Array.isArray((state as { peers?: unknown[] }).peers), 'peers is a list').toBe(true);
      expect(((state as { peers?: unknown[] }).peers ?? []).length, 'and it is not empty').toBeGreaterThan(0);
    }

    ws.close();
    await sleep(60);
    await runInDurableObject(stub, async (instance: JamRoom) => {
      // @ts-expect-error - private method, called so the isolated storage frame can be popped
      instance.cleanupIntervals();
    });
  });
});
