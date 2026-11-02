import { describe, expect, it } from 'vitest';
import { env, runInDurableObject } from 'cloudflare:test';
import type { JamRoom } from './jam-room';

/**
 * THE SECTION FOLLOWS THE ROOM, ON THE NEXT BAR.
 *
 * The owner's report was "the drums and bass don't change at all no matter how many agents or the vibe
 * change", and he was right: a backing layer took its style once at spawn, so the vibe only ever affected
 * layers born after it. These cases hold the fix: a vibe change restyles the layers that are already
 * playing, and the drums and bass then publish notes from the new row's kit.
 */
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const room = (name: string) => env.JAM_ROOM.get(env.JAM_ROOM.idFromName(name));

interface Note { peerId: string; pitch: string; beatTime: number }

async function withRoom(fn: (api: {
  send: (payload: Record<string, unknown>) => void;
  frames: { type: string; peer?: { name?: string; peerId?: string }; peerId?: string; style?: string; pitch?: string }[];
}) => Promise<void>) {
  const stub = room(`section-${crypto.randomUUID()}`);
  const res = await stub.fetch(new Request('http://localhost/api/room/x/ws', { headers: { Upgrade: 'websocket' } }));
  const ws = res.webSocket!;
  ws.accept();
  const frames: { type: string; peer?: { name?: string; peerId?: string }; peerId?: string; style?: string; pitch?: string }[] = [];
  ws.addEventListener('message', (event: MessageEvent) => {
    if (typeof event.data === 'string') frames.push(JSON.parse(event.data));
  });
  await sleep(40);
  ws.send(JSON.stringify({ type: 'join_room', name: 'Section', kind: 'human', instrument: 'PolySynth' }));
  await sleep(60);
  await fn({ send: payload => ws.send(JSON.stringify(payload)), frames });
  ws.close();
  await sleep(50);
  await runInDurableObject(stub, async (instance: JamRoom) => {
    // @ts-expect-error - private method, called so the isolated storage frame can be popped
    instance.cleanupIntervals();
  });
}

const notesOf = (frames: { type: string; peerId?: string; pitch?: string; beatTime?: number }[], peerId: string | undefined): Note[] =>
  frames.filter(f => f.type === 'note_on' && f.peerId === peerId && typeof f.pitch === 'string')
    .map(f => ({ peerId: String(f.peerId), pitch: String(f.pitch), beatTime: Number(f.beatTime) }));

describe('the backing section follows the vibe', () => {
  it('restyles a drummer that is already playing', async () => {
    await withRoom(async ({ send, frames }) => {
      send({ type: 'set_vibe', vibe: 'jazz' });
      await sleep(80);
      send({ type: 'set_backing', drummer: true, bass: false });
      await sleep(2200);
      const drummer = frames.find(f => f.type === 'agent_spawned' && f.peer?.name === 'Drummer')?.peer?.peerId;
      expect(drummer, 'the drummer is playing').toBeTruthy();

      frames.length = 0;
      send({ type: 'set_vibe', vibe: 'house' });
      // TWO BARS at 120 BPM with a margin: a bar is 2 s and the layer publishes on the bar line, so a
      // shorter window can miss the bar that proves the change.
      await sleep(5000);
      const after = notesOf(frames, drummer);
      expect(after.length, 'the drummer still plays after the change').toBeGreaterThan(0);
      // HOUSE IS FOUR ON THE FLOOR: a kick on every beat, and the kick's pitch is the room's code for it.
      // The bar boundary can fall anywhere in the window, so the reading is COVERAGE: how many of the four
      // beats the window caught, which is three even from a single full bar with a partial at each end.
      const kicks = after.filter(note => note.pitch === 'C2').map(note => note.beatTime);
      const covered = [0, 1, 2, 3].filter(beat => kicks.some(onset => Math.abs(onset - beat) < 0.01));
      expect(covered.length, `beats covered by a kick: ${covered.join(', ')}`).toBeGreaterThanOrEqual(3);
    });
  }, 20000);

  it('changes one agent style, voice and seat from its card', async () => {
    await withRoom(async ({ send, frames }) => {
      send({ type: 'spawn_agent', name: 'Cardey', style: 'jazz' });
      await sleep(200);
      const spawned = frames.find(f => f.type === 'agent_spawned' && f.peer?.name === 'Cardey');
      const peerId = spawned?.peer?.peerId;
      expect(peerId).toBeTruthy();

      frames.length = 0;
      send({ type: 'set_agent_part', agentPeerId: peerId, style: 'latin', instrument: 'FMSynth', seat: 'ornament' });
      await sleep(300);
      const update = frames.filter(f => f.type === 'agent_spawned' && f.peer?.peerId === peerId).at(-1);
      expect(update?.style).toBe('latin');
      expect(update?.peer?.name).toBe('Cardey');
    });
  }, 20000);
});
