import { describe, expect, it } from 'vitest';
import { env, runInDurableObject } from 'cloudflare:test';
import { PatchSchema, patchFromPreset, polyOptionsOf } from '@/shared/music/patch';
import { PRESET_IDS } from '@/shared/music/presets';
import { ClientMessageSchema } from '@/shared/protocol/types';
import type { JamRoom } from './jam-room';

/**
 * THE PATCH, ON THE WIRE AND ON THE VOICE.
 *
 * A preset you cannot change is a label. These cases pin the two halves that make the panel real: the
 * numbers survive the trip to the room (so every listener builds the same voice), and a patch the engine
 * cannot build is refused at the door rather than half-applied.
 */
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const room = (name: string) => env.JAM_ROOM.get(env.JAM_ROOM.idFromName(name));

describe('a hand-built voice', () => {
  it('builds a patch from every preset, and every patch is valid', () => {
    for (const id of PRESET_IDS) {
      const patch = patchFromPreset(id);
      expect(PatchSchema.safeParse(patch).success, `${id} produces a valid patch`).toBe(true);
      expect(patch.base).toBe(id);
    }
  });

  it('maps a stacked patch onto one fat oscillator bank', () => {
    const patch = { ...patchFromPreset('juno-pad'), voices: 4, detune: 20, wave: 'sawtooth' as const };
    const options = polyOptionsOf(patch) as { oscillator: { type: string; count?: number; spread?: number } };
    expect(options.oscillator.type).toBe('fatsawtooth');
    expect(options.oscillator.count).toBe(4);
    expect(options.oscillator.spread).toBe(20);
  });

  it('refuses a patch the engine could not build', () => {
    const broken = { ...patchFromPreset('brass'), voices: 9 };
    expect(PatchSchema.safeParse(broken).success).toBe(false);
    expect(ClientMessageSchema.safeParse({ type: 'set_agent_patch', agentPeerId: 'x', patch: broken }).success).toBe(false);
    expect(ClientMessageSchema.safeParse({ type: 'set_agent_patch', agentPeerId: 'x', patch: patchFromPreset('brass') }).success).toBe(true);
  });

  it('carries a bot voice to the room and back to every listener', async () => {
    const stub = room(`patch-${crypto.randomUUID()}`);
    const res = await stub.fetch(new Request('http://localhost/api/room/x/ws', { headers: { Upgrade: 'websocket' } }));
    const ws = res.webSocket!;
    ws.accept();
    const frames: { type: string; peer?: { peerId?: string; name?: string }; patch?: { filter?: { cutoff?: number }; wave?: string } }[] = [];
    ws.addEventListener('message', (event: MessageEvent) => {
      if (typeof event.data !== 'string') return;
      const data = JSON.parse(event.data) as (typeof frames)[number];
      if (data.type === 'agent_spawned') frames.push(data);
    });
    await sleep(40);
    ws.send(JSON.stringify({ type: 'join_room', name: 'Patcher', kind: 'human', instrument: 'electric-piano' }));
    await sleep(60);
    ws.send(JSON.stringify({ type: 'spawn_agent', name: 'Voiced', seat: 'lead' }));
    await sleep(200);

    const spawned = frames.at(-1);
    const peerId = spawned?.peer?.peerId;
    expect(peerId, 'the bot joined').toBeTruthy();
    // A NEW BOT ARRIVES WITH ITS SEAT'S PATCH, not with nothing.
    expect(spawned?.patch?.wave, 'the bot was born with a voice').toBeTruthy();

    const edited = { ...patchFromPreset('juno-pad'), catalog: undefined, wave: 'square' as const, filter: { ...patchFromPreset('juno-pad').filter, cutoff: 640 } };
    ws.send(JSON.stringify({ type: 'set_agent_patch', agentPeerId: peerId, patch: edited }));
    await sleep(200);

    const updated = frames.at(-1);
    expect(updated?.patch?.wave).toBe('square');
    expect(updated?.patch?.filter?.cutoff).toBe(640);

    // AND A PATCH FOR A BOT THAT IS NOT HERE IS REFUSED, not silently dropped.
    const errors: string[] = [];
    ws.addEventListener('message', (event: MessageEvent) => {
      if (typeof event.data !== 'string') return;
      const data = JSON.parse(event.data) as { type: string; message?: string };
      if (data.type === 'error') errors.push(String(data.message));
    });
    ws.send(JSON.stringify({ type: 'set_agent_patch', agentPeerId: 'nobody', patch: edited }));
    await sleep(150);
    expect(errors.join(' ')).toContain('not in this room');

    ws.close();
    await sleep(60);
    await runInDurableObject(stub, async (instance: JamRoom) => {
      // @ts-expect-error - private method, called so the isolated storage frame can be popped
      instance.cleanupIntervals();
    });
  });
});
