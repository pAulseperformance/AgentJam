import { describe, expect, it } from 'vitest';
import { env, runInDurableObject } from 'cloudflare:test';
import type { JamRoom } from './jam-room';

/**
 * THE TWO DEFAULTS THE OWNER CHOSE ON 2026-11-02.
 *
 *   1. THE FIRST BOT COLOURS AN UNSET ROOM. A new room opened on jazz, so eight styles sat one click from
 *      nobody. When nobody has chosen, the bot that arrives sets the vibe and the section follows it. A
 *      vibe set by hand still wins.
 *   2. ABSENT MEANS FOUR BARS PER CALL. A style's character lives in its phrase; the per-bar ask delivers
 *      an idiom a bar at a time. A room that has chosen per-bar keeps per-bar.
 */
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const room = (name: string) => env.JAM_ROOM.get(env.JAM_ROOM.idFromName(name));

async function withRoom(fn: (api: { send: (payload: Record<string, unknown>) => void; frames: { type: string; roomState?: { vibe?: string; phraseAsk?: boolean } }[] }) => Promise<void>) {
  const stub = room(`defaults-${crypto.randomUUID()}`);
  const res = await stub.fetch(new Request('http://localhost/api/room/x/ws', { headers: { Upgrade: 'websocket' } }));
  const ws = res.webSocket!;
  ws.accept();
  const frames: { type: string; roomState?: { vibe?: string; phraseAsk?: boolean } }[] = [];
  ws.addEventListener('message', (event: MessageEvent) => {
    if (typeof event.data === 'string') frames.push(JSON.parse(event.data));
  });
  await sleep(40);
  ws.send(JSON.stringify({ type: 'join_room', name: 'Defaults', kind: 'human', instrument: 'PolySynth' }));
  await sleep(60);
  await fn({ send: payload => ws.send(JSON.stringify(payload)), frames });
  ws.close();
  await sleep(50);
  await runInDurableObject(stub, async (instance: JamRoom) => {
    // @ts-expect-error - private method, called so the isolated storage frame can be popped
    instance.cleanupIntervals();
  });
}

const lastVibe = (frames: { type: string; roomState?: { vibe?: string } }[]) =>
  frames.filter(frame => frame.type === 'room_state' && frame.roomState?.vibe).map(frame => frame.roomState!.vibe).at(-1);

describe('the room defaults', () => {
  it('lets the first bot colour a room nobody has set', async () => {
    await withRoom(async ({ send, frames }) => {
      send({ type: 'spawn_agent', name: 'Colour', style: 'latin' });
      await sleep(160);
      expect(lastVibe(frames)).toBe('latin');
    });
  });

  it('keeps a vibe a person chose, whatever the next bot plays', async () => {
    await withRoom(async ({ send, frames }) => {
      send({ type: 'set_vibe', vibe: 'ambient' });
      await sleep(120);
      send({ type: 'spawn_agent', name: 'Colourless', style: 'funk' });
      await sleep(160);
      expect(lastVibe(frames)).toBe('ambient');
    });
  });

  it('asks for four bars when nobody has chosen', async () => {
    await withRoom(async ({ send, frames }) => {
      send({ type: 'spawn_agent', name: 'Phrase', style: 'jazz' });
      await sleep(120);
      const states = frames.filter(frame => frame.type === 'room_state');
      // The field is ABSENT rather than false: the room never chose, and absent is what the room reads as on.
      for (const state of states) expect(state.roomState?.phraseAsk).not.toBe(false);
    });
  });
});
