import { env, runInDurableObject } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import { JamRoom } from './jam-room';
import {
  CENTRE_WINDOW_BARS,
  centreDistance,
  clashesWith,
  pitchClassDistance,
  preferredBar,
  roomCentre,
} from './tonal-map';

/**
 * ONE TONAL CENTRE, AND THE BAR THAT MOVES THE ROOM LEAST.
 *
 * The pure cases pin the arithmetic the room is allowed to make: a centre that each AGENT votes on
 * once rather than each note, a circular distance, and a choice between two candidate bars that
 * ranks a semitone clash above nearness and nearness above note count.
 *
 * The room cases are the ones the mutations are written against. With the score switched to note
 * count (`centreDistance` replaced by `notes.length` in a scratch copy) both `preferForSlot` cases
 * read the other way round, because the wide bar wins on length in each. With the semitone check
 * dropped (`clashesWith` returning nothing) the clash case prefers the bar sitting a semitone from
 * the other agent, and the room's bar-line case lets that note sound.
 */

// ─── The arithmetic ─────────────────────────────────────────────────────────

describe('the distance between two pitch classes', () => {
  it('wraps the octave: B and C are a semitone apart, not eleven', () => {
    expect(pitchClassDistance(11, 0)).toBe(1);
    expect(pitchClassDistance(0, 11)).toBe(1);
    expect(pitchClassDistance(4, 5)).toBe(1); // E and F
    expect(pitchClassDistance(0, 6)).toBe(6); // the tritone
    expect(pitchClassDistance(7, 0)).toBe(5); // G and C
    expect(pitchClassDistance(3, 3)).toBe(0);
  });
});

describe('the room centre', () => {
  it('gives every agent one vote, not every note', () => {
    // One agent plays six E4s, another plays two A3s. Counted note by note the room would lean on
    // E; counted agent by agent it is a tie, and the tie goes to the class nearest the tonic (C4
    // major, C): A is three away and E is four, so the centre is A. A centre owned by the busiest
    // agent is the thing this rule exists to stop.
    const centreOf = roomCentre([['E4', 'E4', 'E4', 'E4', 'E4', 'E4'], ['A3', 'A3']], 0);
    expect(centreOf).toBe(9);
  });

  it('is the key tonic when the room has played nothing yet', () => {
    expect(roomCentre([], 0)).toBe(0); // C major
    expect(roomCentre([[], []], 9)).toBe(9); // A minor
    // Text that is not a pitch is not a note the room voted with.
    expect(roomCentre([['noise', '']], 2)).toBe(2);
  });

  it('breaks a tie by the class nearest the tonic', () => {
    // C and G each get one vote. In C major the tonic itself wins; in A minor G is two away and C
    // is three, so G wins. The centre is read against the same key the agents are told to play.
    expect(roomCentre([['C4'], ['G4']], 0)).toBe(0);
    expect(roomCentre([['C4'], ['G4']], 9)).toBe(7);
  });

  it('measures a bar by the MEAN distance of its notes, not their count', () => {
    expect(centreDistance([{ pitch: 'C5' }], 0)).toBe(0);
    expect(centreDistance([{ pitch: 'F4' }], 0)).toBe(5);
    expect(centreDistance([{ pitch: 'C4' }, { pitch: 'F4' }], 0)).toBe(2.5);
    expect(centreDistance([{ pitch: 'not-a-pitch' }], 0)).toBe(0);
  });

  it('reads a window of bars, not the whole session', () => {
    // The constant is exported so a reader can tell how far back a centre listens; the room passes
    // its own bars and this file pins the number the comments promise.
    expect(CENTRE_WINDOW_BARS).toBe(8);
  });
});

// ─── A clash is a semitone in the same slot ─────────────────────────────────

describe('the clash between two agents', () => {
  it('is a semitone in ONE slot, and not a doubling an octave apart', () => {
    const others = [{ pitch: 'E4', beatTime: 0 }];
    const clashing = clashesWith([{ pitch: 'F4', beatTime: 0 }], others);
    expect(clashing).toHaveLength(1);
    // The same line one slot later is two voices in sequence, not a semitone at once.
    expect(clashesWith([{ pitch: 'F4', beatTime: 0.5 }], others)).toHaveLength(0);
    // C4 against C5 is the same pitch class an octave apart: a doubling, not a clash.
    expect(clashesWith([{ pitch: 'C4', beatTime: 0 }], [{ pitch: 'C5', beatTime: 0 }])).toHaveLength(0);
  });
});

// ─── Choosing between two candidate bars ────────────────────────────────────

describe('the preferred bar', () => {
  const note = (pitch: string, beatTime: number) => ({ pitch, beatTime, velocity: 80, duration: 0.5 });

  it('keeps the closer bar even when the other one has twice the notes', () => {
    // THE MUTATION: score by note count and this case prefers the WIDER bar, because six notes
    // outrank three. The room's score is distance, so the bar sitting on the centre wins.
    const closer = [note('C4', 0), note('D4', 0.5), note('E4', 1)]; // mean distance 0
    const wider = [note('F4', 0), note('G4', 0.5), note('A4', 1), note('B4', 1.5), note('F4', 2), note('G4', 2.5)];
    expect(preferredBar([wider, closer], { centre: 0 })).toBe(1);
    expect(preferredBar([closer, wider], { centre: 0 })).toBe(0);
  });

  it('never prefers a bar that puts two agents a semitone apart in one slot', () => {
    // THE MUTATION: drop the semitone check and the first candidate wins on distance (2.5 against
    // 4), and the room sounds F against the E another agent is already holding in the same slot.
    const others = [{ pitch: 'E4', beatTime: 0 }];
    const onCentreButClashing = [note('F4', 0), note('C4', 0.5)];
    const furtherButClean = [note('G4', 0), note('A4', 0.5)];
    expect(preferredBar([onCentreButClashing, furtherButClean], { centre: 0, others })).toBe(1);
    // Distance alone would have said the first one. This is the check that overrides it.
    expect(centreDistance(onCentreButClashing, 0)).toBeLessThan(centreDistance(furtherButClean, 0));
  });

  it('keeps the later candidate when the two are equally good', () => {
    // A refresh exists to answer newer ears, so an equal bar replaces the stale one.
    const same = [note('C4', 0), note('E4', 0.5)];
    expect(preferredBar([same, same.map(n => ({ ...n }))], { centre: 0 })).toBe(1);
  });
});

// ─── The room: the refresh, the centre, and the bar line ────────────────────

type Shape = { pitch: string; beatTime: number; velocity: number; duration: number };

const shape = (pitch: string, beatTime: number): Shape => ({ pitch, beatTime, velocity: 80, duration: 0.5 });

interface HeldAsk {
  maxTokens: number;
  prompt: string;
  answer: (text: string) => void;
}

interface AgentInternals {
  peer: { peerId: string; name: string };
  phraseStartBar: number;
  queue: Array<{ bar: number; notes: Shape[]; meta: unknown; sawUpTo: number }>;
  barTimer: ReturnType<typeof setTimeout> | null;
  busy: boolean;
  hook: Shape[] | null;
  motif: unknown;
  lastBarNotes: Shape[] | null;
  lastBarNotesBar: number;
  lastBarIndex: number;
  lastPublishedAt: number;
}
interface BarMetaShape {
  brief?: { role?: string; density?: string; register?: string; relation?: string; play?: boolean; latencyMs?: number } | null;
  source?: string;
  plan?: string;
}
interface RoomInternals {
  roomState: { bpm: number; key: string; transportStartTime: number };
  agents: Map<string, AgentInternals>;
  playedByBar: Map<string, Map<number, Set<string>>>;
  barIndexOf: (at: number) => number;
  onAgentBar: (agent: AgentInternals) => void;
  emitAgentBar: (agent: AgentInternals, notes: Shape[], bar: number, beatMs: number) => void;
  renderAgentBar: (agent: AgentInternals, target?: number, brief?: BarMetaShape['brief']) => Promise<void>;
  preferForSlot: (agent: AgentInternals, bar: number, current: Shape[], next: Shape[]) => 'current' | 'next';
  roomCentre: (atBar?: number) => number;
  turnHolder: (bar: number) => string | null;
}

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

const roomStub = () => {
  const typedEnv = env as any;
  return typedEnv.JAM_ROOM.get(typedEnv.JAM_ROOM.idFromName(`tonal-${crypto.randomUUID()}`)) as any;
};

/** The model's held bar asks, per room. The stub pushes, the render walk answers. */
let ASKS: HeldAsk[] = [];

const installModel = async (stub: ReturnType<typeof roomStub>): Promise<void> => {
  await runInDurableObject(stub, async (instance: JamRoom) => {
    const room = instance as unknown as {
      env: { AI: { run: (model: string, inputs: unknown) => Promise<{ response: unknown }> } };
    };
    room.env.AI = {
      run: (_model, inputs) => {
        const input = inputs as { max_tokens?: number; messages?: Array<{ content: string }> };
        const maxTokens = Number(input.max_tokens ?? 0);
        // A WARM ASK IS THE SHORT ONE; a bar ask is 512 tokens: the room's own classification.
        if (maxTokens < 512) return Promise.resolve({ response: 'OK' });
        return new Promise(resolve => {
          ASKS.push({
            maxTokens,
            prompt: input.messages?.at(-1)?.content ?? '',
            answer: (text: string) => resolve({ response: text }),
          });
        });
      },
    };
  });
};

const openRoom = async (agentNames: string[]): Promise<{
  stub: ReturnType<typeof roomStub>;
  ws: WebSocket;
  close: () => Promise<void>;
}> => {
  const stub = roomStub();
  ASKS = [];
  const res = await stub.fetch(new Request('http://localhost/api/room/x/ws', {
    headers: { Upgrade: 'websocket' },
  }));
  expect(res.status).toBe(101);
  const ws = res.webSocket;
  if (!ws) throw new Error('no websocket');
  ws.accept();

  await installModel(stub);

  ws.send(JSON.stringify({ type: 'join_room', name: 'TonalPeer', kind: 'human' }));
  await sleep(40);
  for (const name of agentNames) {
    ws.send(JSON.stringify({ type: 'spawn_agent', name, style: 'jazz' }));
    await sleep(110);
  }
  await sleep(140);

  return {
    stub,
    ws,
    close: async () => {
      ASKS.forEach(a => a.answer('[]'));
      ws.close();
      await sleep(60);
      await runInDurableObject(stub, async (instance: JamRoom) => {
        // @ts-expect-error - private method, called so the isolated storage frame can be popped
        instance.cleanupIntervals();
      });
    },
  };
};

/**
 * A BAR THE AGENT DOES NOT HOLD THE TURN FOR, read from the room's own clock. The render path gives
 * the turn holder the lead and rebuilds a lead bar along the phrase; this case is about a note the
 * answerer would add, so it has to be the answering agent's bar.
 */
const notTheTurn = (room: RoomInternals, agent: AgentInternals, from: number): number => {
  for (let bar = Math.max(0, from); bar < from + 8; bar++) {
    const holder = room.turnHolder(bar);
    if (holder !== null && holder !== agent.peer.peerId) return bar;
  }
  throw new Error('no answering bar within reach');
};

/** A fresh agent: no queue, no timer, no phrase material from its spawn render. */
const quiet = (agent: AgentInternals): void => {
  agent.queue = [];
  if (agent.barTimer !== null) {
    clearTimeout(agent.barTimer as unknown as number);
    agent.barTimer = null;
  }
  agent.hook = null;
  agent.motif = null;
  agent.lastBarNotes = null;
  agent.lastBarNotesBar = -1;
};

/** Render ONE bar through the room's own path with a known answer and a known role. */
const renderBar = async (
  room: RoomInternals,
  agent: AgentInternals,
  target: number,
  answer: Shape[],
  brief: BarMetaShape['brief'],
): Promise<Shape[]> => {
  const render = room.renderAgentBar(agent, target, brief);
  let ask: HeldAsk | undefined;
  for (let wait = 0; wait < 300 && !ask; wait++) {
    await sleep(10);
    ask = ASKS[0];
  }
  if (!ask) throw new Error('the room asked for no bar');
  ASKS = [];
  ask.answer(JSON.stringify(answer));
  await render;
  const entry = agent.queue.find(q => q.bar === target);
  if (!entry) throw new Error(`no bar queued for ${target}`);
  return entry.notes.map(n => ({ ...n }));
};

describe('the room keeps the bar that moves it least', () => {
  it('reads ONE centre from every agent, not one per agent', async () => {
    const { stub, close } = await openRoom(['Vote Bot', 'Quiet Bot']);
    try {
      await runInDurableObject(stub, async (instance: JamRoom) => {
        const room = instance as unknown as RoomInternals;
        ASKS.forEach(a => a.answer('[]'));
        await sleep(80);
        ASKS = [];
        const [loud, quietAgent] = [...room.agents.values()] as [AgentInternals, AgentInternals];
        if (!quietAgent) throw new Error('the second agent did not spawn');
        quiet(loud);
        quiet(quietAgent);
        room.roomState.key = 'C major';
        const bar = room.barIndexOf(Date.now());
        // The busy agent played six E4s; the quiet one played two A3s. Note for note the room leans
        // E, agent for agent it is a tie and the tie goes to A, which is nearer the tonic C.
        room.playedByBar.set(loud.peer.peerId, new Map([[bar, new Set(['e4@0', 'e4@0.5', 'e4@1', 'e4@1.5', 'e4@2', 'e4@2.5'])]]));
        room.playedByBar.set(quietAgent.peer.peerId, new Map([[bar, new Set(['a3@0', 'a3@1'])]]));
        expect(room.roomCentre(bar)).toBe(9);
        // And with nothing played at all the centre is the key's own tonic.
        room.playedByBar.clear();
        expect(room.roomCentre(bar)).toBe(0);
      });
    } finally {
      await close();
    }
  });

  it('keeps the closer candidate for a refresh and rejects the wider one', async () => {
    const { stub, close } = await openRoom(['Refresh Bot']);
    try {
      await runInDurableObject(stub, async (instance: JamRoom) => {
        const room = instance as unknown as RoomInternals;
        ASKS.forEach(a => a.answer('[]'));
        await sleep(80);
        ASKS = [];
        const agent = [...room.agents.values()][0];
        if (!agent) throw new Error('the agent did not spawn');
        quiet(agent);
        room.roomState.key = 'C major';

        // The queued bar is the WIDER one: six notes, none of them near the centre C.
        const queued = [shape('F4', 0), shape('G4', 0.5), shape('A4', 1), shape('B4', 1.5), shape('F4', 2), shape('G4', 2.5)];
        // The fresh answer is the CLOSER one: three notes on or by the centre.
        const fresh = [shape('C4', 0), shape('D4', 0.5), shape('E4', 1)];

        // The closer bar REPLACES the queued one, even though it has half the notes.
        expect(room.preferForSlot(agent, room.barIndexOf(Date.now()), queued, fresh)).toBe('next');
        // And the same pair the other way round keeps the queued bar.
        expect(room.preferForSlot(agent, room.barIndexOf(Date.now()), fresh, queued)).toBe('current');
      });
    } finally {
      await close();
    }
  });

  it('drops a note at render time that would clash with a plan the other agent holds', async () => {
    const { stub, close } = await openRoom(['Plan Bot', 'Answer Bot']);
    try {
      await runInDurableObject(stub, async (instance: JamRoom) => {
        const room = instance as unknown as RoomInternals;
        ASKS.forEach(a => a.answer('[]'));
        await sleep(80);
        ASKS = [];
        const [planner, answerer] = [...room.agents.values()] as [AgentInternals, AgentInternals];
        if (!answerer) throw new Error('the second agent did not spawn');
        quiet(planner);
        quiet(answerer);
        room.roomState.key = 'C major';

        const target = notTheTurn(room, answerer, answerer.phraseStartBar + 4);
        // The other agent's bar for the same slot holds E at beat 0.5. The answering agent's model
        // answer opens on F at that slot: a semitone under it.
        planner.queue = [{
          bar: target,
          notes: [shape('E4', 0.5)],
          meta: null,
          sawUpTo: Date.now(),
        }];
        const answerBrief = { role: 'answer', density: 'medium', register: 'mid', relation: 'vary' as const, play: true, latencyMs: 0 };
        const played = await renderBar(room, answerer, target, [
          shape('F4', 0.5), shape('G4', 1), shape('A4', 1.5),
        ], answerBrief);

        // The F is not in the room: the other agent holds an E in that slot.
        expect(played.some(n => n.beatTime === 0.5)).toBe(false);
        // The rest of the answer is untouched, so the bar is quieter by one note, not silent.
        expect(played.map(n => n.beatTime)).toEqual([1, 1.5]);
        // The other agent's plan is not rewritten by this agent's filter.
        expect(planner.queue[0]?.notes).toEqual([shape('E4', 0.5)]);
      });
    } finally {
      await close();
    }
  });

  it('drops the clashing note at the bar line when it arrives after the other agent', async () => {
    const { stub, close } = await openRoom(['Line Bot', 'Answer Bot']);
    try {
      await runInDurableObject(stub, async (instance: JamRoom) => {
        const room = instance as unknown as RoomInternals;
        ASKS.forEach(a => a.answer('[]'));
        await sleep(80);
        ASKS = [];
        const [other, agent] = [...room.agents.values()] as [AgentInternals, AgentInternals];
        if (!agent) throw new Error('the second agent did not spawn');
        quiet(other);
        quiet(agent);
        room.roomState.key = 'C major';

        const bar = room.barIndexOf(Date.now());
        // The other agent has ALREADY SOUNDED E at beat 0 in this bar.
        room.playedByBar.set(other.peer.peerId, new Map([[bar, new Set(['e4@0'])]]));
        // This agent's bar opens on F at that slot and continues on C.
        agent.queue = [{ bar, notes: [shape('F4', 0), shape('C4', 1)], meta: null, sawUpTo: Date.now() }];
        agent.lastBarIndex = bar - 1;
        agent.lastPublishedAt = 0;

        const emitted: Shape[][] = [];
        room.emitAgentBar = (_agent, notes) => { emitted.push(notes.map(n => ({ ...n }))); };
        room.renderAgentBar = async () => {};

        room.onAgentBar(agent);
        if (agent.barTimer !== null) { clearTimeout(agent.barTimer as unknown as number); agent.barTimer = null; }

        const sounded = emitted[0] ?? [];
        // F against E in one slot is never preferred, wherever the two bars were written.
        expect(sounded.some(n => n.pitch === 'F4' && n.beatTime === 0)).toBe(false);
        // C at beat 1 was a semitone from nothing and still sounds.
        expect(sounded.some(n => n.pitch === 'C4' && n.beatTime === 1)).toBe(true);
        // And the room recorded only what it played, so no later bar inherits the clash.
        expect(room.playedByBar.get(agent.peer.peerId)?.get(bar)?.has('f4@0')).toBe(false);
      });
    } finally {
      await close();
    }
  });
});
