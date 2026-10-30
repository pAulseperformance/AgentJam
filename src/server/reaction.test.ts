import { env, runInDurableObject } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import { JamRoom } from './jam-room';
import { reactionCells, cellSlots, CELL_MAX_NOTES } from './reaction';
import { cellsForBar } from './bar-queue';
import { midiOf, pitchClassOf } from '@/shared/music';

/**
 * THE GAP BAR'S VOICE.
 *
 * Two kinds of case here. The first are the pure ones: what a cell is, where it sits, what it quotes,
 * and that the same bar always plays the same cells. The last is the room: a bar with no queued
 * render, at a stride above one, must carry note-on events from the agent — its own pitches — and the
 * record for that bar must say `cell` rather than `pattern`.
 */

const MOTIF = { pitches: ['E4', 'G4', 'B4'], slots: [0, 8, 12] };

const base = {
  motif: MOTIF,
  hook: null,
  key: 'C major',
  style: 'jazz' as const,
  bar: 0,
  register: { low: 55, high: 72 },
  cells: 3,
};

describe('the cells a gap bar holds', () => {
  it('quotes the agent’s own pitch classes, on the bar’s eighth grid, and no more than six notes', () => {
    const { notes } = reactionCells(base);
    expect(notes.length).toBeGreaterThan(0);
    expect(notes.length).toBeLessThanOrEqual(CELL_MAX_NOTES);

    const ownClasses = new Set(MOTIF.pitches.map(p => pitchClassOf(p)));
    for (const note of notes) {
      expect(ownClasses.has(pitchClassOf(note.pitch))).toBe(true);
      const midi = midiOf(note.pitch) ?? -1;
      expect(midi).toBeGreaterThanOrEqual(base.register.low);
      expect(midi).toBeLessThanOrEqual(base.register.high);
      expect(note.beatTime).toBeGreaterThanOrEqual(0);
      expect(note.beatTime).toBeLessThan(4);
      // the SIXTEENTH grid: a cell that lands between two slots is a smear, not a statement
      expect(Math.abs(note.beatTime * 4 - Math.round(note.beatTime * 4))).toBeLessThan(0.001);
      expect(note.velocity).toBeGreaterThan(0);
      expect(note.duration).toBeGreaterThan(0);
    }
  });

  it('is the same music every time the same bar is asked for', () => {
    expect(reactionCells(base).notes).toEqual(reactionCells({ ...base }).notes);
  });

  it('moves with the bar, so two gap bars in a row are not one loop', () => {
    const one = reactionCells({ ...base, bar: 1 }).notes.map(n => n.pitch);
    const zero = reactionCells({ ...base, bar: 0 }).notes.map(n => n.pitch);
    expect(one).not.toEqual(zero);
  });

  it('puts a high motif into the low register without changing what it says', () => {
    const { notes } = reactionCells({
      ...base,
      motif: { pitches: ['C6', 'E6', 'G6'], slots: [0, 4, 8] },
      register: { low: 40, high: 59 },
    });
    for (const note of notes) {
      const midi = midiOf(note.pitch) ?? -1;
      expect(midi).toBeGreaterThanOrEqual(40);
      expect(midi).toBeLessThanOrEqual(59);
    }
    // an octave move keeps the pitch class: C, E and G are still C, E and G
    expect(new Set(notes.map(n => pitchClassOf(n.pitch)))).toEqual(new Set([0, 4, 7]));
  });

  it('opens with a seed when the agent has not played yet, instead of an empty bar', () => {
    const { notes } = reactionCells({ ...base, motif: null, hook: null });
    expect(notes.length).toBeGreaterThan(0);
    // the seed is the key's own tonic, third and fifth, not the generator's walk
    expect(new Set(notes.map(n => pitchClassOf(n.pitch)))).toEqual(new Set([0, 4, 7]));
  });

  it('fits the cells to the bar’s width, and places them on the eighth grid', () => {
    expect(cellsForBar(1200)).toBe(3);
    expect(cellsForBar(2000)).toBe(4);
    expect(cellsForBar(800)).toBe(2);
    expect(cellsForBar(400)).toBe(1);
    expect(cellsForBar(6000)).toBe(4);
    expect(cellsForBar(0)).toBe(1);
    expect(cellsForBar(Number.NaN)).toBe(1);

    expect(cellSlots(3)).toEqual([0, 1.5, 2.5]);
    expect(cellSlots(4)).toEqual([0, 1, 2, 3]);
    expect(cellSlots(1)).toEqual([0]);
  });

  it('plays the slots still ahead when the bar has already started', () => {
    // Published 2.5 beats into its own bar: the whole-bar slots are all in the past, so the cells
    // move to what is left instead of leaving the bar silent.
    const late = cellSlots(3, 2.5);
    expect(late.length).toBeGreaterThan(0);
    for (const slot of late) {
      expect(slot).toBeGreaterThanOrEqual(2.5);
      expect(slot).toBeLessThan(4);
    }
    // and they are not squeezed together: one cell per half beat at most
    expect(late.length).toBeLessThanOrEqual(3);
    // a bar with less than a sixteenth left is not addressable at all
    expect(cellSlots(3, 3.95)).toEqual([]);
  });

  it('plays one held note per cell in ambient and two stabs in funk', () => {
    const ambient = reactionCells({ ...base, style: 'ambient' }).notes;
    const funk = reactionCells({ ...base, style: 'funk' }).notes;
    expect(ambient.length).toBe(3);
    expect(funk.length).toBe(6);
    expect(ambient[0]!.duration).toBeGreaterThan(funk[0]!.duration);
  });
});

// ─── The room: a gap bar actually played -------------------------------------

interface AgentInternals {
  peer: { peerId: string };
  queue: Array<{ bar: number }>;
  barTimer: ReturnType<typeof setTimeout> | null;
  lastBarIndex: number;
  lastPublishedAt: number;
  motif: { pitches: string[]; slots: number[] } | null;
  lastRegister: 'low' | 'mid' | 'high';
}

interface RoomInternals {
  roomState: { bpm: number; key: string; transportStartTime: number; serverTime: number };
  agents: Map<string, AgentInternals>;
  broadcastAll: (message: string) => void;
  onAgentBar: (agent: AgentInternals) => void;
  renderAgentBar: (agent: AgentInternals) => Promise<void>;
  barMs: () => number;
}

describe('a gap bar in a real room', () => {
  it('plays the agent’s own cells, with note-on events landing inside the bar', async () => {
    const typedEnv = env as any;
    const id = typedEnv.JAM_ROOM.idFromName(`reaction-${crypto.randomUUID()}`);
    const stub = typedEnv.JAM_ROOM.get(id);

    const res = await stub.fetch(new Request('http://localhost/api/room/x/ws', {
      headers: { Upgrade: 'websocket' },
    }));
    expect(res.status).toBe(101);
    const ws = res.webSocket;
    if (!ws) throw new Error('no websocket');
    ws.accept();

    // Everything the room sends, as the listener would hear it, and the record it published with it.
    const heard: Array<{ at: number; peerId: string; pitch: string }> = [];
    const gap: {
      bar: number;
      notes: Array<{ at: number; peerId: string; pitch: string }>;
      meta: { source?: string; noteCount?: number } | null;
    } = { bar: -1, notes: [], meta: null };
    let agentPeerId = '';

    try {
      ws.send(JSON.stringify({ type: 'join_room', name: 'CellPeer', kind: 'human' }));
      await new Promise(r => setTimeout(r, 40));
      ws.send(JSON.stringify({ type: 'spawn_agent', name: 'Cell Bot', style: 'jazz' }));
      await new Promise(r => setTimeout(r, 60));

      await runInDurableObject(stub, async (instance: JamRoom) => {
        const room = instance as unknown as RoomInternals;
        const agent = [...room.agents.values()][0];
        if (!agent) throw new Error('agent did not spawn');
        agentPeerId = agent.peer.peerId;

        // The bar this room just published, captured where the room broadcasts it.
        let published: { bar?: number; meta?: { source?: string; noteCount?: number } } | null = null;

        room.broadcastAll = (message: string) => {
          let data: { type?: string; peerId?: string; pitch?: string; bar?: number; meta?: { source?: string; noteCount?: number } };
          try { data = JSON.parse(message); } catch { return; }
          if (data.type === 'note_on') {
            heard.push({ at: Date.now(), peerId: String(data.peerId ?? ''), pitch: String(data.pitch ?? '') });
          }
          if (data.type === 'ai_debug') published = { bar: data.bar, meta: data.meta };
        };

        // EVERY BAR IS A GAP BAR HERE: the model never answers, so nothing is ever queued and the bar
        // that publishes is the one with no render behind it.
        room.renderAgentBar = async () => {};
        // A FRESH BAR LINE, five milliseconds in: every cell still has its own slot ahead of it, so
        // what this test hears is the whole bar and not a bar joined late.
        room.roomState.bpm = 200;
        room.roomState.transportStartTime = Date.now() - 5;
        agent.queue = [];
        agent.motif = { pitches: [...MOTIF.pitches], slots: [...MOTIF.slots] };
        agent.lastRegister = 'mid';
        agent.lastBarIndex = -1;
        agent.lastPublishedAt = 0;
        if (agent.barTimer !== null) { clearTimeout(agent.barTimer as unknown as number); agent.barTimer = null; }

        expect(room.barMs()).toBe(1200);
        room.onAgentBar(agent);

        // The bar's last cell sits at 2.75 beats of a 1200 ms bar: 825 ms. A second hears it all, and
        // stops 195 ms before the next line would publish again.
        await new Promise(r => setTimeout(r, 1000));

        if (agent.barTimer !== null) { clearTimeout(agent.barTimer as unknown as number); agent.barTimer = null; }

        const record = published as { bar?: number; meta?: { source?: string; noteCount?: number } } | null;
        gap.bar = record?.bar ?? -1;
        gap.meta = record?.meta ?? null;
        const barMs = room.barMs();
        const transportStart = room.roomState.transportStartTime;
        gap.notes = heard.filter(n => Math.floor((n.at - transportStart) / barMs) === gap.bar);
      });
    } finally {
      ws.close();
      await new Promise(r => setTimeout(r, 50));
      await runInDurableObject(stub, async (instance: JamRoom) => {
        // @ts-expect-error - private method, called so the isolated storage frame can be popped
        instance.cleanupIntervals();
      });
    }

    // THE BAR ITSELF. Not "a bar had notes": THIS gap bar, the one published with no render behind it.
    expect(gap.bar).toBeGreaterThanOrEqual(0);
    expect(gap.notes.length).toBeGreaterThan(0);
    expect(gap.notes.every(n => n.peerId === agentPeerId)).toBe(true);

    // SIX NOTES, because three cells of two notes each is what a jazz gap bar holds: the count proves
    // the cells were the whole bar and not cells stacked on a generated line.
    expect(gap.meta?.source).toBe('cell');
    expect(gap.meta?.noteCount).toBe(6);
    expect(gap.notes.length).toBe(gap.meta?.noteCount);

    // ITS OWN MATERIAL: every cell pitch is one of the three the agent last played, an octave away at
    // most. A generator bar in the room's key would not hold that.
    const ownClasses = new Set(MOTIF.pitches.map(p => pitchClassOf(p)));
    for (const note of gap.notes) expect(ownClasses.has(pitchClassOf(note.pitch))).toBe(true);
  });
});
