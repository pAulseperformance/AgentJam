import { env, runInDurableObject } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import { JamRoom, latePatch } from './jam-room';
import type { GeneratedNote } from '@/shared/music';

/**
 * THE BAR'S REMAINING EIGHTHS.
 *
 * Two kinds of case. The first are pure: where a late answer may still be played, what it keeps, and
 * that it never invents a note or a slot. The last is the room: a render whose bar line has passed
 * while the bar is still playing must put note-on events into it under the late render's own name —
 * and with the patch path removed those events are an empty list, which is what the mutation checks.
 */

const ANSWER: GeneratedNote[] = [
  { pitch: 'C4', beatTime: 0, velocity: 84, duration: 0.25 },
  { pitch: 'D4', beatTime: 0.5, velocity: 86, duration: 0.25 },
  { pitch: 'E4', beatTime: 1, velocity: 88, duration: 0.25 },
  { pitch: 'F4', beatTime: 1.5, velocity: 90, duration: 0.25 },
  { pitch: 'G4', beatTime: 2, velocity: 92, duration: 0.25 },
  { pitch: 'A4', beatTime: 2.5, velocity: 94, duration: 0.25 },
  { pitch: 'B4', beatTime: 3, velocity: 96, duration: 0.25 },
  { pitch: 'C5', beatTime: 3.5, velocity: 98, duration: 0.25 },
];

const MODEL_ANSWER = JSON.stringify(ANSWER);

describe('latePatch: the eighths a late answer may still address', () => {
  it('keeps the answer’s ending on the eighths that are still ahead', () => {
    const patched = latePatch(ANSWER, 2.6);
    expect(patched.map(n => n.beatTime)).toEqual([3, 3.5]);
    expect(patched.map(n => n.pitch)).toEqual(['B4', 'C5']);
    // A PATCH IS A PLACEMENT, NOT AN EDIT: the answer handed in keeps its own timing.
    expect(ANSWER.map(n => n.beatTime)).toEqual([0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5]);
  });

  it('drops the slot the clock is standing on, not just the ones behind it', () => {
    // Two beats in, the eighth AT two beats has gone: a note written for it cannot be played.
    const patched = latePatch(ANSWER, 2);
    expect(patched.map(n => n.beatTime)).toEqual([2.5, 3, 3.5]);
    expect(patched.map(n => n.pitch)).toEqual(['A4', 'B4', 'C5']);
  });

  it('patches nothing once the bar is over', () => {
    expect(latePatch(ANSWER, 3.9)).toEqual([]);
    expect(latePatch(ANSWER, 4.2)).toEqual([]);
  });

  it('moves a dense answer onto the remaining grid instead of playing it off the grid', () => {
    const dense: GeneratedNote[] = Array.from({ length: 16 }, (_unused, i) => ({
      pitch: i % 2 === 0 ? 'C4' : 'E4',
      beatTime: i * 0.25,
      velocity: 90,
      duration: 0.2,
    }));
    const patched = latePatch(dense, 2.6);
    expect(patched.map(n => n.beatTime)).toEqual([3, 3.5]);
    expect(patched.every(n => Math.abs(n.beatTime * 2 - Math.round(n.beatTime * 2)) < 0.001)).toBe(true);
  });

  it('never invents a note, and always ends on the bar’s last eighth', () => {
    expect(latePatch([], 1)).toEqual([]);
    for (const fromBeat of [0, 0.4, 1.7, 2.2, 3.1]) {
      const patched = latePatch(ANSWER, fromBeat);
      expect(patched.length).toBeGreaterThan(0);
      expect(patched.length).toBeLessThanOrEqual(8);
      const own = new Set(ANSWER.map(n => n.pitch));
      for (const note of patched) {
        expect(own.has(note.pitch)).toBe(true);
        expect(note.beatTime).toBeGreaterThan(0);
        expect(note.beatTime).toBeLessThan(4);
        expect(Math.abs(note.beatTime * 2 - Math.round(note.beatTime * 2))).toBeLessThan(0.001);
      }
      // THE ENDING, IN ORDER: the last note is the answer's last note, at the bar's last eighth.
      expect(patched.at(-1)?.pitch).toBe('C5');
      expect(patched.map(n => n.pitch))
        .toEqual(ANSWER.slice(-patched.length).map(n => n.pitch));
    }
  });

  it('is the same patch every time the same position is asked for', () => {
    expect(latePatch(ANSWER, 2.6)).toEqual(latePatch(ANSWER, 2.6));
  });
});

// ─── The room: an answer that arrives after its own line ----------------------

interface HeldAsk {
  maxTokens: number;
  prompt: string;
  issuedAt: number;
  answer: (text: string) => void;
}

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

/** The model, as the test sends it: the warm answers at once, a bar ask is held until released. */
const installModel = async (stub: ReturnType<typeof roomStub>, asks: HeldAsk[]): Promise<void> => {
  await runInDurableObject(stub, async (instance: JamRoom) => {
    const room = instance as unknown as {
      env: { AI: { run: (model: string, inputs: unknown) => Promise<{ response: unknown }> } };
    };
    room.env.AI = {
      run: (_model, inputs) => {
        const input = inputs as { max_tokens?: number; messages?: Array<{ content: string }> };
        const maxTokens = Number(input.max_tokens ?? 0);
        // A WARM ASK IS THE SHORT ONE (a word), a bar ask is 512 tokens: the room's own classification.
        if (maxTokens < 512) return Promise.resolve({ response: 'OK' });
        return new Promise(resolve => {
          asks.push({
            maxTokens,
            prompt: input.messages?.at(-1)?.content ?? '',
            issuedAt: Date.now(),
            answer: (text: string) => resolve({ response: text }),
          });
        });
      },
    };
  });
};

const roomStub = () => {
  const typedEnv = env as any;
  return typedEnv.JAM_ROOM.get(typedEnv.JAM_ROOM.idFromName(`late-${crypto.randomUUID()}`)) as ReturnType<
    typeof env.JAM_ROOM.get
  >;
};

interface AgentInternals {
  peer: { peerId: string };
  queue: Array<{ bar: number }>;
  barTimer: ReturnType<typeof setTimeout> | null;
}

interface RoomInternals {
  env: unknown;
  roomState: { bpm: number; transportStartTime: number };
  agents: Map<string, AgentInternals>;
  barMs: () => number;
  barIndexOf: (at: number) => number;
  renderAgentBar: (agent: unknown, target?: number) => Promise<void>;
  broadcastAll: (message: string) => void;
}

type DebugRecord = {
  bar?: number;
  meta?: { source?: string; noteCount?: number; plan?: string; response?: string; latencyMs?: number };
};

describe('a late answer in a real room', () => {
  it('plays the answer’s remaining eighths after the line, under the late render’s name', async () => {
    const stub = roomStub();
    const res = await stub.fetch(new Request('http://localhost/api/room/x/ws', {
      headers: { Upgrade: 'websocket' },
    }));
    expect(res.status).toBe(101);
    const ws = res.webSocket;
    if (!ws) throw new Error('no websocket');
    ws.accept();

    const asks: HeldAsk[] = [];
    const heard: Array<{ at: number; peerId: string; pitch: string; beatTime: number }> = [];
    const records: DebugRecord[] = [];
    let agentPeerId = '';

    await installModel(stub, asks);

    try {
      ws.send(JSON.stringify({ type: 'join_room', name: 'LatePeer', kind: 'human' }));
      await sleep(40);
      ws.send(JSON.stringify({ type: 'spawn_agent', name: 'Late Bot', style: 'jazz' }));
      await sleep(80);

      await runInDurableObject(stub, async (instance: JamRoom) => {
        const room = instance as unknown as RoomInternals;
        const agent = [...room.agents.values()][0];
        if (!agent) throw new Error('agent did not spawn');
        agentPeerId = agent.peer.peerId;

        // Everything the room sends, as a listener hears it.
        room.broadcastAll = (message: string) => {
          let data: { type?: string; peerId?: string; pitch?: string; beatTime?: number } & DebugRecord;
          try { data = JSON.parse(message); } catch { return; }
          if (data.type === 'note_on') {
            heard.push({
              at: Date.now(),
              peerId: String(data.peerId ?? ''),
              pitch: String(data.pitch ?? ''),
              beatTime: Number(data.beatTime ?? 0),
            });
          }
          if (data.type === 'ai_debug') records.push({ bar: data.bar, meta: data.meta });
        };

        // THE SPAWN'S OWN RENDER IS NOT THIS CASE: let it land, then empty the queue and stop the
        // agent's own bar line so the only music in the bar under test is the patch.
        asks.forEach(a => a.answer(MODEL_ANSWER));
        await sleep(60);
        asks.length = 0;
        agent.queue = [];
        if (agent.barTimer !== null) {
          clearTimeout(agent.barTimer as unknown as number);
          agent.barTimer = null;
        }

        // 160 BPM, and the line this render writes for is 200 ms away. The room's budget for it is
        // the 400 ms floor, which is LONGER than the time left — so an answer released inside its own
        // budget can still land after the line without a timer having fired late. That is the late
        // case, built out of the room's own arithmetic.
        room.roomState.bpm = 160;
        room.roomState.transportStartTime = Date.now() - (1500 - 200);
        expect(room.barMs()).toBe(1500);
        const target = room.barIndexOf(Date.now()) + 1;
        const lineAt = room.roomState.transportStartTime + target * room.barMs();
        expect(lineAt - Date.now()).toBeGreaterThan(150);
        expect(lineAt - Date.now()).toBeLessThan(250);

        const render = room.renderAgentBar(agent, target);
        for (let i = 0; i < 100 && asks.length === 0; i++) await sleep(10);
        const ask = asks[0];
        expect(ask).toBeDefined();

        // RELEASE AFTER THE LINE, INSIDE THE BUDGET. The budget is 400 ms from the render's start and
        // this releases at ~280 ms; the line went by at 200 ms.
        while (Date.now() < lineAt + 80) await sleep(10);
        ask?.answer(MODEL_ANSWER);
        await render;
        expect(Date.now() - lineAt).toBeGreaterThan(50);

        // LET THE PATCHED SLOTS PLAY. A 160 BPM bar is 1500 ms and the answer's ending runs to its last
        // eighth, so the bar is heard out before its events are counted; the agent's own bar line is
        // stopped, so nothing but the patch can sound inside it.
        while (Date.now() < lineAt + 1400) await sleep(10);

        // THE CASE THE MUTATION BREAKS: with the patch path removed there is no note after the line,
        // so this list is empty and the first assertion below fails on it.
        const afterLine = heard.filter(n => n.at >= lineAt);
        expect(afterLine.length).toBeGreaterThan(0);
        expect(afterLine.every(n => n.peerId === agentPeerId)).toBe(true);
        // ... inside the bar the line opened, not the one before it and not after it.
        expect(afterLine.every(n => Math.floor((n.at - room.roomState.transportStartTime) / room.barMs()) === target))
          .toBe(true);

        // AND THE RECORD NAMES THE LATE RENDER, bar for bar with what sounded.
        const late = records.filter(r => r.meta?.source === 'late');
        expect(late.length).toBe(1);
        expect(late[0]?.bar).toBe(target);
        expect(late[0]?.meta?.noteCount).toBe(afterLine.length);
        const planned = (late[0]?.meta?.plan ?? '').split(' ').filter(Boolean);
        expect(planned.length).toBe(afterLine.length);
        for (const entry of planned) {
          const slot = Number(String(entry).split('@')[1]);
          expect(slot).toBeGreaterThan(0);
          expect(slot).toBeLessThan(4);
          expect(Math.abs(slot * 2 - Math.round(slot * 2))).toBeLessThan(0.001);
        }
        // AND NOTHING WAS QUEUED FOR A BAR THAT HAS BEGUN: the queue's next slot is for a bar still
        // ahead, and the late answer itself is never an entry.
        expect(agent.queue.some(q => q.bar === target)).toBe(false);
      });
    } finally {
      asks.forEach(a => a.answer(MODEL_ANSWER));
      ws.close();
      await sleep(50);
      await runInDurableObject(stub, async (instance: JamRoom) => {
        // @ts-expect-error - private method, called so the isolated storage frame can be popped
        instance.cleanupIntervals();
      });
    }
  });
});
