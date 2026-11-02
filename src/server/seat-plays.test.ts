import { describe, expect, it } from 'vitest';
import { env, runInDurableObject } from 'cloudflare:test';
import type { JamRoom } from './jam-room';

/**
 * A SEAT IS A PART, NOT A LABEL.
 *
 * The owner, 2026-11-02: "when selecting the bass option in an agent it doesnt play a bass role". It was
 * true: the seat only changed the card. A bot seated on bass now plays the room's own bass line, in the
 * room's key and style, with no model call, and a drummer counts the room in before it accompanies.
 */
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const room = (name: string) => env.JAM_ROOM.get(env.JAM_ROOM.idFromName(name));

interface Note { peerId?: string; pitch?: string; velocity?: number; beatTime?: number }
interface Debug { type: string; agentPeerId?: string; meta?: { source?: string } }
interface Frame { type: string; peer?: { peerId?: string; name?: string }; seat?: string; pitch?: string; velocity?: number; beatTime?: number; message?: string }

/** Pitch class 0 at C, so a bass can be judged by its register without a library. */
const midiOf = (pitch: string): number => {
  const match = /^([A-G])([#b]?)(-?\d)$/.exec(pitch);
  if (!match) return Number.NaN;
  const base: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const accidental = match[2] === '#' ? 1 : match[2] === 'b' ? -1 : 0;
  return (Number(match[3]) + 1) * 12 + base[match[1]] + accidental;
};

async function withRoom(fn: (socket: { send: (payload: Record<string, unknown>) => void; frames: Frame[]; notes: Note[]; debug: Debug[] }) => Promise<void>) {
  const stub = room(`seat-plays-${crypto.randomUUID()}`);
  const res = await stub.fetch(new Request('http://localhost/api/room/x/ws', { headers: { Upgrade: 'websocket' } }));
  const ws = res.webSocket!;
  ws.accept();
  const frames: Frame[] = [];
  const notes: Note[] = [];
  const debug: Debug[] = [];
  ws.addEventListener('message', (event: MessageEvent) => {
    if (typeof event.data !== 'string') return;
    const data = JSON.parse(event.data) as Frame;
    frames.push(data);
    // The frame's own fields, whatever shape it carries: this test spawns one bot into a room with no
    // other player, so every note that arrives belongs to it.
    if (data.type === 'ai_debug') debug.push(data as unknown as Debug);
    if (data.type === 'note_on') notes.push({ peerId: (data as unknown as { peerId?: string }).peerId, pitch: data.pitch, velocity: data.velocity, beatTime: data.beatTime });
  });
  await sleep(40);
  ws.send(JSON.stringify({ type: 'join_room', name: 'Listener', kind: 'human', instrument: 'PolySynth' }));
  await sleep(60);
  await fn({ send: payload => ws.send(JSON.stringify(payload)), frames, notes, debug });
  ws.close();
  await sleep(80);
  await runInDurableObject(stub, async (instance: JamRoom) => {
    // @ts-expect-error - private method, called so the isolated storage frame can be popped
    instance.cleanupIntervals();
  });
}

describe('a bot plays the part its seat names', () => {
  it('a bass-seated bot sounds in the bass register, without waiting on a model', async () => {
    await withRoom(async ({ send, frames, notes, debug }) => {
      send({ type: 'spawn_agent', name: 'Low', seat: 'bass' });
      await sleep(2200);
      const spawned = frames.find(frame => frame.type === 'agent_spawned' && frame.peer?.name === 'Low');
      expect(spawned, 'the bot joined the room').toBeTruthy();
      const mine = notes.filter(note => note.pitch);
      expect(mine.length, `the bass played notes inside the first two bars; frames seen: ${frames.map(f => f.type).join(',')}`).toBeGreaterThan(0);
      // A GROOVE BAR IS NOT A FALLBACK BAR. The session readers count `pattern` as a bar the generator
      // had to cover, and a working band would otherwise bury that number under its own drums and bass.
      const sources = debug.map(entry => entry.meta?.source);
      expect(sources, `bar sources seen: ${sources.join(',')}`).toContain('groove');
      expect(sources, 'a groove seat never reports as the generator covering a bar').not.toContain('pattern');
      const pitches = mine.map(note => midiOf(String(note.pitch)));
      // A bass line sits under middle C. A melody seated "bass" used to answer in the lead's register.
      expect(Math.max(...pitches), `highest note ${String(mine.map(n => n.pitch).join(' '))}`).toBeLessThan(55);
    });
  });

  it('a drums-seated bot counts the room in, then keeps time', async () => {
    await withRoom(async ({ send, frames, notes }) => {
      send({ type: 'spawn_agent', name: 'Kit', seat: 'drums' });
      await sleep(4200);
      const spawned = frames.find(frame => frame.type === 'agent_spawned' && frame.peer?.name === 'Kit');
      expect(spawned, 'the drummer joined the room').toBeTruthy();
      const mine = notes.filter(note => note.pitch);
      expect(mine.length, `the kit played notes; frames seen: ${frames.map(f => f.type).join(',')}`).toBeGreaterThan(0);
      // The first bar is the count-in: four quarters, on the beat.
      const firstBar = mine.filter(note => (note.beatTime ?? 0) < 4);
      expect(firstBar.length, 'four quarters to count the room in').toBeGreaterThanOrEqual(4);
      // AND IT KEEPS TIME. `beatTime` counts within a bar, so a second bar cannot be told from the first
      // by its beats: the count is the evidence. A bar line that forgets to re-arm plays the four-note
      // count-in and stops, which is what the owner heard as a drummer who could not hold a beat.
      expect(mine.length, 'the count-in and then at least one bar of the groove').toBeGreaterThan(4);
    });
  });
});
