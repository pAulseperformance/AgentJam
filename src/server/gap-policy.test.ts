import { env, runInDurableObject } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import { JamRoom } from './jam-room';
import { ClientMessageSchema, RoomStateSchema } from '@/shared/protocol/types';
import { renderStride } from './bar-queue';

/**
 * GAP BARS AS RESTS.
 *
 * The room's own fill covers a bar the agent did not answer with the model: above a stride of one the
 * agent's cells quote its motif, at a stride of one the generator's line plays instead. That fill is
 * what makes a slow agent sound busy, so it is a SETTING (`set_gap_rests`): on, a bar with no model
 * answer is silence, recorded as `rest`, and the listener hears the agent's own rate as space.
 *
 * Two kinds of case here. The wire cases prove the setting reaches the room, is stored with it, and is
 * told to every listener — a switch no client can read is not a room setting. The bar cases drive ONE
 * bar line each, with the queue emptied or filled on purpose, and read the record the room broadcast:
 * with the setting off the bar carries the room's fill, with it on the bar carries nothing, and a model
 * answer that IS ready plays either way.
 */

interface QueuedNote {
  pitch: string;
  beatTime: number;
  velocity: number;
  duration: number;
}

interface AgentInternals {
  peer: { peerId: string; name: string };
  queue: Array<{ bar: number; notes: QueuedNote[]; meta: { source?: string; noteCount?: number } }>;
  barTimer: ReturnType<typeof setTimeout> | null;
  lastBarIndex: number;
  lastPublishedAt: number;
  renderCostMs: number;
  renderTailMs: number;
  lastRegister: 'low' | 'mid' | 'high';
  motif: { pitches: string[]; slots: number[] } | null;
}

interface RoomInternals {
  roomState: { bpm: number; key: string; transportStartTime: number; serverTime: number; gapRests?: boolean };
  agents: Map<string, AgentInternals>;
  broadcastAll: (message: string) => void;
  onAgentBar: (agent: AgentInternals) => void;
  renderAgentBar: (agent: AgentInternals) => Promise<void>;
  handleSetGapRests: (enabled: boolean) => void;
  barMs: () => number;
}

/** The agent's own material, the same figure reaction.test.ts uses so the cells are predictable. */
const MOTIF = { pitches: ['E4', 'G4', 'B4'], slots: [0, 8, 12] };

/** What one published bar looked like from the room's own broadcast. */
type PublishedBar = {
  bar: number;
  source: string | null;
  noteCount: number | null;
  response: string | null;
  /** the note-on events the room sent for this bar */
  notes: Array<{ pitch: string; velocity: number }>;
  /** the agent's idea AFTER the bar: a rest must not erase it */
  motif: string[] | null;
};

const openRoom = async () => {
  // Cast to bypass the strict Env typing for tests, the way jam-room.test.ts does.
  const typedEnv = env as any;
  const stub = typedEnv.JAM_ROOM.get(typedEnv.JAM_ROOM.idFromName(`gap-${crypto.randomUUID()}`));
  const res = await stub.fetch(new Request('http://localhost/api/room/x/ws', {
    headers: { Upgrade: 'websocket' },
  }));
  expect(res.status).toBe(101);
  const ws = res.webSocket;
  if (!ws) throw new Error('no websocket');
  ws.accept();
  return { stub, ws };
};

/**
 * PUBLISH ONE BAR LINE, with the agent in the state the case needs.
 *
 * The model is taken out of the room (`renderAgentBar` does nothing), so every bar this publishes is
 * a bar with no queued render behind it — the gap bar the setting is about. `costMs` sets the stride
 * directly (the room derives it from the measured cost), and `queued` puts a model answer in the
 * agent's queue for the bar that will publish, which is how the case for "a ready answer still plays"
 * is driven.
 */
async function publishOneBar(opts: {
  rests: boolean;
  bpm: number;
  costMs: number;
  queued?: QueuedNote[];
}): Promise<PublishedBar> {
  const { stub, ws } = await openRoom();
  const out: PublishedBar = { bar: -1, source: null, noteCount: null, response: null, notes: [], motif: null };

  try {
    ws.send(JSON.stringify({ type: 'join_room', name: 'GapPeer', kind: 'human' }));
    await new Promise(r => setTimeout(r, 40));
    ws.send(JSON.stringify({ type: 'spawn_agent', name: 'Gap Bot', style: 'jazz' }));
    await new Promise(r => setTimeout(r, 60));

    await runInDurableObject(stub, async (instance: JamRoom) => {
      const room = instance as unknown as RoomInternals;
      const agent = [...room.agents.values()][0];
      if (!agent) throw new Error('agent did not spawn');

      // EVERYTHING THE ROOM SENT, taken where the room broadcasts it: the record and the notes.
      let published: { bar?: number; meta?: { source?: string; noteCount?: number; response?: string } } | null = null;
      room.broadcastAll = (message: string) => {
        let data: {
          type?: string; bar?: number; pitch?: string; velocity?: number;
          meta?: { source?: string; noteCount?: number; response?: string };
        };
        try { data = JSON.parse(message); } catch { return; }
        if (data.type === 'ai_debug') published = { bar: data.bar, meta: data.meta };
        if (data.type === 'note_on') out.notes.push({ pitch: String(data.pitch ?? ''), velocity: Number(data.velocity ?? 0) });
      };

      // THE MODEL NEVER ANSWERS THIS ROOM. The case is the bar with no queued render; an in-flight
      // render would fill the queue and the bar would be the model's, which is not what is measured.
      room.renderAgentBar = async () => {};
      if (opts.rests) room.handleSetGapRests(true);

      // A FRESH BAR LINE, five milliseconds in: the bar that publishes is bar 0, so a queued answer
      // addressed to bar 0 is ready and every slot of the empty bar is still ahead of it.
      room.roomState.bpm = opts.bpm;
      room.roomState.transportStartTime = Date.now() - 5;
      agent.renderCostMs = opts.costMs;
      agent.renderTailMs = opts.costMs;
      agent.motif = { pitches: [...MOTIF.pitches], slots: [...MOTIF.slots] };
      agent.lastRegister = 'mid';
      agent.queue = opts.queued
        ? [{ bar: 0, notes: opts.queued.map(n => ({ ...n })), meta: { source: 'llm', noteCount: opts.queued.length } }]
        : [];
      agent.lastBarIndex = -1;
      agent.lastPublishedAt = 0;
      if (agent.barTimer !== null) { clearTimeout(agent.barTimer as unknown as number); agent.barTimer = null; }

      room.onAgentBar(agent);

      // THE WHOLE BAR, not its downbeat: the last slot of a bar publishes 50 ms before the next line,
      // and the next line is what the timer this call re-armed would publish, so it is cleared first.
      await new Promise(r => setTimeout(r, Math.max(200, room.barMs() - 50)));
      if (agent.barTimer !== null) { clearTimeout(agent.barTimer as unknown as number); agent.barTimer = null; }

      const record = published as { bar?: number; meta?: { source?: string; noteCount?: number; response?: string } } | null;
      out.bar = record?.bar ?? -1;
      out.source = record?.meta?.source ?? null;
      out.noteCount = record?.meta?.noteCount ?? null;
      out.response = record?.meta?.response ?? null;
      out.motif = agent.motif ? [...agent.motif.pitches] : null;
    });
  } finally {
    ws.close();
    await new Promise(r => setTimeout(r, 50));
    await runInDurableObject(stub, async (instance: JamRoom) => {
      // @ts-expect-error - private method, called so the isolated storage frame can be popped
      instance.cleanupIntervals();
    });
  }

  return out;
}

describe('the setting on the wire', () => {
  it('is a message a client may send, and nothing else is one', () => {
    expect(ClientMessageSchema.safeParse({ type: 'set_gap_rests', enabled: true }).success).toBe(true);
    expect(ClientMessageSchema.safeParse({ type: 'set_gap_rests', enabled: false }).success).toBe(true);
    // A setting with no value is not a setting: the room reads `enabled` or it does nothing.
    expect(ClientMessageSchema.safeParse({ type: 'set_gap_rests' }).success).toBe(false);
    expect(ClientMessageSchema.safeParse({ type: 'set_gap_rests', enabled: 'yes' }).success).toBe(false);

    // AND AN OLD ROOM_STATE IS STILL A ROOM_STATE. The field is optional because the room that has
    // never been asked sends nothing; a required field would fail every client on its first join.
    expect(RoomStateSchema.safeParse({
      bpm: 160, key: 'C major', transportStartTime: 0, serverTime: 0,
    }).success).toBe(true);
    expect(RoomStateSchema.safeParse({
      bpm: 160, key: 'C major', transportStartTime: 0, serverTime: 0, gapRests: true,
    }).success).toBe(true);
  });

  it('reaches the room, is stored with it, and is told to every listener', async () => {
    const { stub, ws } = await openRoom();

    try {
      ws.send(JSON.stringify({ type: 'join_room', name: 'WirePeer', kind: 'human' }));
      await new Promise(r => setTimeout(r, 40));

      // THE ROOM'S DEFAULT IS THE FILL. Nothing has asked yet, so a bar with no model line plays.
      await runInDurableObject(stub, async (instance: JamRoom) => {
        const room = instance as unknown as RoomInternals;
        expect(room.roomState.gapRests).toBe(false);
        const health = await instance.fetch(new Request('http://localhost/health'));
        expect((await health.json() as { gapRests?: boolean }).gapRests).toBe(false);
      });

      // WHAT THE ROOM TELLS EVERYONE. Captured where the room broadcasts, because the value the client
      // draws its checkbox from is this message and not the sender's intention.
      let told: { roomState?: { gapRests?: boolean } } | null = null;
      await runInDurableObject(stub, async (instance: JamRoom) => {
        const room = instance as unknown as RoomInternals;
        room.broadcastAll = (message: string) => {
          let data: { type?: string; roomState?: { gapRests?: boolean } };
          try { data = JSON.parse(message); } catch { return; }
          if (data.type === 'room_state') told = data;
        };
      });

      ws.send(JSON.stringify({ type: 'set_gap_rests', enabled: true }));
      await new Promise(r => setTimeout(r, 60));

      await runInDurableObject(stub, async (instance: JamRoom) => {
        const room = instance as unknown as RoomInternals;
        expect(room.roomState.gapRests).toBe(true);
        expect((told as { roomState?: { gapRests?: boolean } } | null)?.roomState?.gapRests).toBe(true);

        // READ BACK FROM THE ROOM, not from the sender: /health answers what a bar will do now.
        const health = await instance.fetch(new Request('http://localhost/health'));
        expect((await health.json() as { gapRests?: boolean }).gapRests).toBe(true);

        // AND PERSISTED WITH THE ROOM, so an eviction does not quietly turn the fill back on.
        const store = (instance as unknown as {
          ctx: { storage: { get: (key: string) => Promise<{ gapRests?: boolean } | undefined> } };
        }).ctx;
        const row = await store.storage.get('roomState');
        expect(row?.gapRests).toBe(true);
      });

      // AND OFF AGAIN, because a setting that can only be turned on is a setting with one value.
      ws.send(JSON.stringify({ type: 'set_gap_rests', enabled: false }));
      await new Promise(r => setTimeout(r, 60));
      await runInDurableObject(stub, async (instance: JamRoom) => {
        const room = instance as unknown as RoomInternals;
        expect(room.roomState.gapRests).toBe(false);
      });
    } finally {
      ws.close();
      await new Promise(r => setTimeout(r, 50));
      await runInDurableObject(stub, async (instance: JamRoom) => {
        // @ts-expect-error - private method, called so the isolated storage frame can be popped
        instance.cleanupIntervals();
      });
    }
  });
});

describe('a bar the model did not write', () => {
  it('plays the room’s own line at a stride of one while the setting is off', async () => {
    const bar = await publishOneBar({ rests: false, bpm: 160, costMs: 200 });

    // A STRIDE OF ONE, proven rather than assumed: the cost the agent was given fits inside the bar.
    expect(renderStride(200, 240000 / 160)).toBe(1);
    expect(bar.bar).toBeGreaterThanOrEqual(0);
    expect(bar.source).toBe('pattern');
    expect((bar.noteCount ?? 0)).toBeGreaterThan(0);
    expect(bar.notes.length).toBeGreaterThan(0);
  });

  it('is SILENCE when the room asks for rests, and records itself as one', async () => {
    const bar = await publishOneBar({ rests: true, bpm: 160, costMs: 200 });

    expect(renderStride(200, 240000 / 160)).toBe(1);
    expect(bar.bar).toBeGreaterThanOrEqual(0);
    // NOTHING PLAYED. This is the case the card's mutation breaks: with the setting ignored, the
    // generator's notes fill the bar and both assertions below read a full line.
    expect(bar.notes.length).toBe(0);
    expect(bar.noteCount).toBe(0);
    // AND THE RECORD SAYS SO. A rest counted as `pattern` would make the two settings read the same
    // in a session file, which is the only evidence anyone has that the switch did anything.
    expect(bar.source).toBe('rest');
    expect(bar.response ?? '').toContain('asked gap bars to rest');
  });

  it('carries the agent’s own cells above a stride of one until the room asks otherwise', async () => {
    const off = await publishOneBar({ rests: false, bpm: 200, costMs: 1300 });
    const on = await publishOneBar({ rests: true, bpm: 200, costMs: 1300 });

    // THE SAME SITUATION TWICE: 200 BPM is above this agent's ceiling, so it writes every second bar.
    expect(renderStride(1300, 240000 / 200)).toBe(2);
    expect(off.source).toBe('cell');
    // six notes is three cells of two, which is what a jazz gap bar holds: cells, not a generator line
    expect(off.noteCount).toBe(6);
    expect(off.notes.length).toBe(6);

    // AND WITH THE SETTING ON, THE GAP IS THE SPACE ITSELF.
    expect(on.source).toBe('rest');
    expect(on.noteCount).toBe(0);
    expect(on.notes.length).toBe(0);
  });

  it('does not erase the agent’s idea when it rests', async () => {
    const bar = await publishOneBar({ rests: true, bpm: 160, costMs: 200 });

    // A gap rest is silence, not a new statement: the agent's next written bar still varies from the
    // motif it last played, because the setting is about writing LESS and not about forgetting.
    expect(bar.source).toBe('rest');
    expect(bar.motif).toEqual(MOTIF.pitches);
  });

  it('never drops a model answer that is already queued', async () => {
    const queued: QueuedNote[] = [
      { pitch: 'A4', beatTime: 0, velocity: 80, duration: 0.5 },
      { pitch: 'C5', beatTime: 1.5, velocity: 90, duration: 0.5 },
      { pitch: 'E5', beatTime: 2.5, velocity: 70, duration: 0.5 },
    ];
    const bar = await publishOneBar({ rests: true, bpm: 160, costMs: 200, queued });

    // THE SETTING GOVERNS GAP BARS, NOT THE ROOM'S MUSIC. A bar the model wrote is already paid for,
    // so it plays exactly as it would with the setting off.
    expect(bar.source).toBe('llm');
    expect(bar.noteCount).toBe(queued.length);
    expect(bar.notes.length).toBeGreaterThan(0);
    expect(bar.notes.map(n => n.pitch).sort()).toEqual(queued.map(n => n.pitch).sort());
  });
});
