import { describe, expect, it } from 'vitest';
import { env, runInDurableObject } from 'cloudflare:test';
import { ClientMessageSchema } from '@/shared/protocol/types';
import { INSTRUMENT_IDS } from '@/shared/music/instruments';
import { STYLE_ROWS } from '@/shared/music/styles';
import type { JamRoom } from './jam-room';

/**
 * THE VOICE A BOT PLAYS. The registry named a voice on every row and nothing read it, so every bot played
 * PolySynth while the palette claimed otherwise. Three cases: the row's voice is the default, a spawn can
 * ask for another, and a voice the engine does not implement is refused rather than defaulted.
 */
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const room = (name: string) => env.JAM_ROOM.get(env.JAM_ROOM.idFromName(name));

async function spawnAndRead(payload: Record<string, unknown>) {
  const stub = room(`voice-${crypto.randomUUID()}`);
  const res = await stub.fetch(new Request('http://localhost/api/room/x/ws', { headers: { Upgrade: 'websocket' } }));
  const ws = res.webSocket!;
  ws.accept();
  const spawned: { peer?: { instrument?: string; name?: string }; style?: string; seat?: string }[] = [];
  const errors: string[] = [];
  ws.addEventListener('message', (event: MessageEvent) => {
    if (typeof event.data !== 'string') return;
    const msg = JSON.parse(event.data) as { type: string; peer?: { instrument?: string; name?: string }; style?: string; seat?: string; message?: string };
    if (msg.type === 'agent_spawned') spawned.push(msg);
    if (msg.type === 'error') errors.push(String(msg.message));
  });
  await sleep(40);
  ws.send(JSON.stringify({ type: 'join_room', name: 'Voice', kind: 'human', instrument: 'PolySynth' }));
  await sleep(60);
  ws.send(JSON.stringify({ type: 'spawn_agent', name: 'Voice Bot', ...payload }));
  await sleep(150);
  ws.close();
  await sleep(50);
  await runInDurableObject(stub, async (instance: JamRoom) => {
    // @ts-expect-error - private method, called so the isolated storage frame can be popped
    instance.cleanupIntervals();
  });
  return { spawned, errors };
}

describe('the instrument on a part', () => {
  it('plays the voice its style row names when the spawn asks for none', async () => {
    const latin = STYLE_ROWS.find(row => row.id === 'latin')!;
    const { spawned } = await spawnAndRead({ style: 'latin' });
    expect(spawned.length).toBe(1);
    expect(spawned[0]!.peer?.instrument).toBe(latin.instrument);
    // And the row is not the fallback voice, or this case would pass on a dead field.
    expect(latin.instrument).not.toBe('electric-piano');
  });

  it('plays the instrument the spawn asks for, whatever the row names', async () => {
    // A PRESET, not a synth class: the row for latin is a marimba, and this asks for the rubber bass.
    const { spawned } = await spawnAndRead({ style: 'latin', instrument: 'rubber-bass' });
    expect(spawned[0]!.peer?.instrument).toBe('rubber-bass');
  });

  it('refuses a voice the engine does not implement', () => {
    for (const id of INSTRUMENT_IDS) {
      expect(ClientMessageSchema.safeParse({ type: 'spawn_agent', name: 'X', instrument: id }).success).toBe(true);
    }
    expect(ClientMessageSchema.safeParse({ type: 'spawn_agent', name: 'X', instrument: 'Theremin' }).success).toBe(false);
  });
});
