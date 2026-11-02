import { describe, expect, it } from 'vitest';
import { env, runInDurableObject } from 'cloudflare:test';
import { ClientMessageSchema, RoomStateMessageSchema } from '@/shared/protocol/types';
import type { JamRoom } from './jam-room';

/**
 * THE ROOM'S VIBE. Four properties, all of which the room gets wrong if the field is treated as a
 * setting that rewrites parts, or as a frame without the peer list:
 *
 *   1. the frame the toggle answers with parses as room_state AND carries peers,
 *   2. an id that is not a row is refused by the protocol rather than stored,
 *   3. a bot spawned with no style of its own is born into the vibe,
 *   4. the backing section follows the vibe rather than the first bot.
 *
 * The socket half is exercised through the Durable Object's own fetch, so a frame that a real listener
 * would receive is the thing under test.
 */
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function room(name: string) {
  const id = env.JAM_ROOM.idFromName(name);
  return env.JAM_ROOM.get(id);
}

describe('the room vibe', () => {
  it('answers with a room_state that carries the peers', async () => {
    const stub = room(`vibe-frame-${crypto.randomUUID()}`);
    const res = await stub.fetch(new Request('http://localhost/api/room/x/ws', { headers: { Upgrade: 'websocket' } }));
    const ws = res.webSocket!;
    ws.accept();
    const frames: string[] = [];
    ws.addEventListener('message', (event: MessageEvent) => {
      if (typeof event.data === 'string') frames.push(event.data);
    });
    await sleep(40);
    ws.send(JSON.stringify({ type: 'join_room', name: 'VibePeer', kind: 'human', instrument: 'PolySynth' }));
    await sleep(80);
    frames.length = 0;
    ws.send(JSON.stringify({ type: 'set_vibe', vibe: 'funk' }));
    await sleep(80);

    const states = frames.map(f => JSON.parse(f) as { type: string }).filter(m => m.type === 'room_state');
    expect(states.length).toBeGreaterThan(0);
    for (const state of states) {
      expect(RoomStateMessageSchema.safeParse(state).success).toBe(true);
      const peers = (state as { peers?: unknown[] }).peers;
      expect(Array.isArray(peers) && peers.length > 0).toBe(true);
      expect((state as { roomState: { vibe?: string } }).roomState.vibe).toBe('funk');
    }
    ws.close();
    await sleep(60);
    await runInDurableObject(stub, async (instance: JamRoom) => {
      // @ts-expect-error - private method, called so the isolated storage frame can be popped
      instance.cleanupIntervals();
    });
  });

  it('refuses a vibe that is not a style row', () => {
    expect(ClientMessageSchema.safeParse({ type: 'set_vibe', vibe: 'afrobeat' }).success).toBe(false);
    expect(ClientMessageSchema.safeParse({ type: 'set_vibe', vibe: 'funk' }).success).toBe(true);
  });

  it('spawns a bot into the vibe when it names no style of its own', async () => {
    const stub = room(`vibe-spawn-${crypto.randomUUID()}`);
    const res = await stub.fetch(new Request('http://localhost/api/room/x/ws', { headers: { Upgrade: 'websocket' } }));
    const ws = res.webSocket!;
    ws.accept();
    const spawned: { style?: string }[] = [];
    ws.addEventListener('message', (event: MessageEvent) => {
      if (typeof event.data !== 'string') return;
      const msg = JSON.parse(event.data) as { type: string; style?: string };
      if (msg.type === 'agent_spawned') spawned.push(msg);
    });
    await sleep(40);
    ws.send(JSON.stringify({ type: 'join_room', name: 'VibeSpawn', kind: 'human', instrument: 'PolySynth' }));
    await sleep(60);
    ws.send(JSON.stringify({ type: 'set_vibe', vibe: 'ambient' }));
    await sleep(60);
    ws.send(JSON.stringify({ type: 'spawn_agent', name: 'Pad' }));
    await sleep(150);
    expect(spawned.length).toBe(1);
    expect(spawned[0]!.style).toBe('ambient');
    ws.close();
    await sleep(60);
    await runInDurableObject(stub, async (instance: JamRoom) => {
      // @ts-expect-error - private method, called so the isolated storage frame can be popped
      instance.cleanupIntervals();
    });
  });

  it('sends the backing section after the vibe, not after the first bot', async () => {
    const stub = room(`vibe-backing-${crypto.randomUUID()}`);
    const res = await stub.fetch(new Request('http://localhost/api/room/x/ws', { headers: { Upgrade: 'websocket' } }));
    const ws = res.webSocket!;
    ws.accept();
    const layers: { style?: string; name?: string }[] = [];
    ws.addEventListener('message', (event: MessageEvent) => {
      if (typeof event.data !== 'string') return;
      const msg = JSON.parse(event.data) as { type: string; style?: string; peer?: { name?: string } };
      if (msg.type === 'agent_spawned' && /Drum|Bass/i.test(msg.peer?.name ?? '')) layers.push({ style: msg.style, name: msg.peer?.name });
    });
    await sleep(40);
    ws.send(JSON.stringify({ type: 'join_room', name: 'VibeBacking', kind: 'human', instrument: 'PolySynth' }));
    await sleep(60);
    ws.send(JSON.stringify({ type: 'spawn_agent', name: 'Lead', style: 'funk' }));
    await sleep(120);
    ws.send(JSON.stringify({ type: 'set_vibe', vibe: 'ambient' }));
    await sleep(60);
    ws.send(JSON.stringify({ type: 'set_backing', drummer: true, bass: true }));
    await sleep(200);
    expect(layers.length).toBeGreaterThan(0);
    for (const layer of layers) expect(layer.style).toBe('ambient');
    ws.close();
    await sleep(60);
    await runInDurableObject(stub, async (instance: JamRoom) => {
      // @ts-expect-error - private method, called so the isolated storage frame can be popped
      instance.cleanupIntervals();
    });
  });
});
