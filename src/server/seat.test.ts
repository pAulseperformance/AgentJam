import { describe, expect, it } from 'vitest';
import { env, runInDurableObject } from 'cloudflare:test';
import { ClientMessageSchema } from '@/shared/protocol/types';
import type { JamRoom } from './jam-room';

/**
 * THE SEAT. Three properties make a roster rather than a pile of bots: the default is the first seat the
 * room does not cover, a taken seat is refused rather than shared, and a rhythm seat hands the matching
 * backing layer over so the kit and the low end are each played once.
 */
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const room = (name: string) => env.JAM_ROOM.get(env.JAM_ROOM.idFromName(name));

interface Frame { type: string; peer?: { name?: string; peerId?: string }; peerId?: string; seat?: string; message?: string }

async function withRoom(fn: (socket: { send: (payload: Record<string, unknown>) => void; frames: Frame[] }) => Promise<void>) {
  const stub = room(`seat-${crypto.randomUUID()}`);
  const res = await stub.fetch(new Request('http://localhost/api/room/x/ws', { headers: { Upgrade: 'websocket' } }));
  const ws = res.webSocket!;
  ws.accept();
  const frames: Frame[] = [];
  ws.addEventListener('message', (event: MessageEvent) => {
    if (typeof event.data !== 'string') return;
    frames.push(JSON.parse(event.data) as Frame);
  });
  await sleep(40);
  ws.send(JSON.stringify({ type: 'join_room', name: 'Seat', kind: 'human', instrument: 'PolySynth' }));
  await sleep(60);
  await fn({ send: payload => ws.send(JSON.stringify(payload)), frames });
  ws.close();
  await sleep(50);
  await runInDurableObject(stub, async (instance: JamRoom) => {
    // @ts-expect-error - private method, called so the isolated storage frame can be popped
    instance.cleanupIntervals();
  });
}

const spawns = (frames: Frame[]) => frames.filter(frame => frame.type === 'agent_spawned' && frame.peer?.name?.startsWith('Bot'));
const errors = (frames: Frame[]) => frames.filter(frame => frame.type === 'error').map(frame => String(frame.message));

describe('the seat a bot takes', () => {
  it('fills the first seat the room does not cover, then the next', async () => {
    await withRoom(async ({ send, frames }) => {
      send({ type: 'spawn_agent', name: 'Bot one' });
      await sleep(120);
      send({ type: 'spawn_agent', name: 'Bot two' });
      await sleep(120);
      const seats = spawns(frames).map(frame => frame.seat);
      expect(seats).toEqual(['lead', 'answer']);
    });
  });

  it('refuses a seat that is already taken rather than sharing it', async () => {
    await withRoom(async ({ send, frames }) => {
      send({ type: 'spawn_agent', name: 'Bot one', seat: 'lead' });
      await sleep(120);
      send({ type: 'spawn_agent', name: 'Bot two', seat: 'lead' });
      await sleep(120);
      expect(spawns(frames).length, 'one bot takes the seat').toBe(1);
      expect(errors(frames).join(' ')).toContain('lead seat is taken');
    });
  });

  it('hands the room bass over to a bot that takes the seat', async () => {
    await withRoom(async ({ send, frames }) => {
      send({ type: 'set_backing', drummer: false, bass: true });
      await sleep(150);
      const bassLayer = frames.find(frame => frame.type === 'agent_spawned' && frame.peer?.name === 'Bass');
      expect(bassLayer, 'the room bass is playing first').toBeTruthy();
      send({ type: 'spawn_agent', name: 'Bot bass', seat: 'bass' });
      await sleep(150);
      const left = frames.filter(frame => frame.type === 'peer_left').map(frame => frame.peerId);
      expect(left).toContain(bassLayer!.peer?.peerId);
      expect(spawns(frames)[0]?.seat).toBe('bass');
    });
  });

  it('refuses a seat that is not one of the five', () => {
    expect(ClientMessageSchema.safeParse({ type: 'spawn_agent', name: 'X', seat: 'ornament' }).success).toBe(true);
    expect(ClientMessageSchema.safeParse({ type: 'spawn_agent', name: 'X', seat: 'engineer' }).success).toBe(false);
  });
});
