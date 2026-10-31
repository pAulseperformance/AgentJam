import { env, runInDurableObject } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import { JamRoom } from './jam-room';
import { leadInto } from './melody';
import { midiOf } from '@/shared/music';

/**
 * THE PHRASE PASSES ACROSS THE BAR LINE.
 *
 * Two kinds of case. The pure ones pin the move itself: a leap at the bar line is stepped onto the
 * note the previous bar left ringing, a first note that already steps is left alone, and a register
 * with no step in it keeps the leap rather than leave the key. The room cases are the ones the
 * mutation is written against: the first renders a cadence and then the bar after it, and asserts the
 * new phrase starts a step out of the landing; the second spawns TWO agents and asserts the bar that
 * takes over the lead starts a step out of the OTHER agent's last note. With the step move removed,
 * the first case comes back on a leap out of the cadence and the second on a restart at the incoming
 * agent's own centre (mid 55..72 is 64), which is what the two assertions below catch.
 */

type Shape = { pitch: string; beatTime: number; velocity: number; duration: number };

const note = (pitch: string, beatTime: number, velocity = 88, duration = 0.25): Shape =>
  ({ pitch, beatTime, velocity, duration });

const midi = (pitch: string): number => {
  const value = midiOf(pitch);
  if (value === null) throw new Error(`${pitch} is not a pitch`);
  return value;
};

/** The band the public agents' decisions ask for: `register: 'mid'`, C major. */
const MID = { low: 55, high: 72 };
const CENTRE = Math.round((MID.low + MID.high) / 2); // 64: where a fresh line starts

// ─── The move itself ─────────────────────────────────────────────────────────

describe('the step onto the note the previous bar left', () => {
  it('moves a leaping first note a step in the direction the line was going', () => {
    // The line wanted to begin on C5 (72); the bar before it ended on G3 (55). Seventeen semitones
    // across the bar line is a new idea, so the first note moves to the nearest in-key step above the
    // outgoing note: A3 (57). The rest of the line is untouched note for note.
    const line = [note('C5', 0), note('B4', 0.5), note('A4', 1), note('G4', 1.5)];
    const led = leadInto(line, { fromMidi: 55, key: 'C major', register: MID });
    expect(midi(led[0]!.pitch)).toBe(57);
    expect(led.slice(1)).toEqual(line.slice(1));
    // ... and the slots are the same music: only the pitch of the first note moved.
    expect(led.map(n => n.beatTime)).toEqual(line.map(n => n.beatTime));
  });

  it('leaves a first note that is already a scale step alone', () => {
    // A3 (57) against G3 (55) is two semitones: the bar already leads in, so nothing moves.
    const line = [note('A3', 0), note('B3', 0.5), note('C4', 1)];
    expect(leadInto(line, { fromMidi: 55, key: 'C major', register: MID })).toEqual(line);
  });

  it('keeps the leap when the register has no step in it', () => {
    // A one-note band: neither neighbour of the outgoing note is playable, so leaving the register
    // would be a worse error than the leap. This is the "where it can" in the task.
    const line = [note('C5', 0), note('B4', 0.5)];
    const led = leadInto(line, { fromMidi: 60, key: 'C major', register: { low: 60, high: 60 } });
    expect(led).toEqual(line);
  });
});

// ─── The room: a bar after a phrase ends, and a bar that takes over the lead ──

interface HeldAsk {
  maxTokens: number;
  prompt: string;
  answer: (text: string) => void;
}

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

const roomStub = () => {
  const typedEnv = env as any;
  return typedEnv.JAM_ROOM.get(typedEnv.JAM_ROOM.idFromName(`voice-${crypto.randomUUID()}`)) as ReturnType<
    typeof env.JAM_ROOM.get
  >;
};

interface AgentInternals {
  peer: { peerId: string; name: string };
  phraseStartBar: number;
  queue: Array<{ bar: number; notes: Shape[]; meta: { source?: string } | null }>;
  barTimer: ReturnType<typeof setTimeout> | null;
  busy: boolean;
  hook: Shape[] | null;
  motif: unknown;
  lastBarNotes: Shape[] | null;
  lastBarNotesBar: number;
}

interface RoomInternals {
  roomState: { bpm: number; key: string; transportStartTime: number };
  agents: Map<string, AgentInternals>;
  barMs: () => number;
  barIndexOf: (at: number) => number;
  renderAgentBar: (agent: AgentInternals, target?: number) => Promise<void>;
  voiceFrom: (bar: number) => number | null;
}

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
        // A WARM ASK IS THE SHORT ONE (a word); a bar ask is 512 tokens: the room's own classification.
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

  ws.send(JSON.stringify({ type: 'join_room', name: 'VoicePeer', kind: 'human' }));
  await sleep(40);
  for (const name of agentNames) {
    ws.send(JSON.stringify({ type: 'spawn_agent', name, style: 'jazz' }));
    await sleep(100);
  }
  await sleep(120);

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
 * Take one agent off its own bar line and render ONE bar through the room's own render path, then
 * hand back the notes the room queued for it — the bar that will be published at the line. The answer
 * is what the model says; the room's repair, completion and voice leading run on it as they would live.
 */
const renderBar = async (
  room: RoomInternals,
  agent: AgentInternals,
  target: number,
  answer: unknown,
): Promise<Shape[]> => {
  const render = room.renderAgentBar(agent, target);
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

const firstNote = (notes: Shape[]): Shape =>
  notes.slice().sort((a, b) => a.beatTime - b.beatTime)[0]!;

describe('the room leads across the bar line', () => {
  it('starts the bar after a cadence a step out of the cadence’s landing', async () => {
    const { stub, close } = await openRoom(['Cadence Bot']);
    try {
      await runInDurableObject(stub, async (instance: JamRoom) => {
        const room = instance as unknown as RoomInternals;
        ASKS.forEach(a => a.answer('[]'));
        await sleep(80);
        ASKS = [];
        const agent = [...room.agents.values()][0];
        if (!agent) throw new Error('agent did not spawn');
        quiet(agent);

        // THE PHRASE ENDS ON ITS HIGHEST NOTE. The cadence bar keeps only the model's LAST pitch as
        // the place to land from, so a model line ending on C5 lands the phrase on C5 (72).
        const cadenceTarget = agent.phraseStartBar + 3 + 4 * 4; // position 3: cadence
        const answers = [note('E4', 0), note('G4', 1), note('C5', 2)];
        const cadence = await renderBar(room, agent, cadenceTarget, answers);
        const landing = cadence.slice().sort((a, b) => a.beatTime - b.beatTime).at(-1)!;
        expect(midi(landing.pitch)).toBe(72);

        // The bar after the cadence is a new phrase (position 0), and it is a lead bar in a room with
        // one agent. It is answered with a note the repairer drops, so the line is built from the
        // agent's own centre (64) — the restart this task is about.
        const nextTarget = cadenceTarget + 1;
        const next = await renderBar(room, agent, nextTarget, [
          { pitch: 'Am4', beatTime: 0, velocity: 88, duration: 0.5 },
        ]);
        const first = firstNote(next);

        // THE MUTATION'S FAILURE: with the step move removed, this first note is the centre walk's
        // F4 (65) and the assertion below reads seven semitones, a leap out of the cadence.
        expect(Math.abs(midi(first.pitch) - midi(landing.pitch))).toBeLessThanOrEqual(2);
        expect(midi(first.pitch)).toBe(71); // B4: the step above C5 inside the 55..72 band
        // ... and the source was the cadence's bar, not the agent's own centre.
        expect(room.voiceFrom(nextTarget)).toBe(72);
      });
    } finally {
      await close();
    }
  });

  it('starts a handover bar a step out of the OTHER agent’s last note', async () => {
    const { stub, close } = await openRoom(['Outgoing Bot', 'Incoming Bot']);
    try {
      await runInDurableObject(stub, async (instance: JamRoom) => {
        const room = instance as unknown as RoomInternals;
        ASKS.forEach(a => a.answer('[]'));
        await sleep(80);
        ASKS = [];
        const agents = [...room.agents.values()];
        if (agents.length < 2) throw new Error('the second agent did not spawn');
        const [outgoing, incoming] = agents as [AgentInternals, AgentInternals];
        quiet(outgoing);
        quiet(incoming);

        // THE LEAD ROTATES IN TWO-BAR TURNS over the agents in spawn order: the outgoing agent holds
        // the bars whose slot is even (0..1, 4..5, ...), the incoming agent the next pair. So the
        // outgoing bar here is the SECOND bar of its turn (a bar ≡ 1 mod 4) and the bar after it is
        // the FIRST bar of the incoming agent's turn. The outgoing bar sits in its own four-bar
        // phrase at whichever position, and the seven stepwise notes below are already a line there,
        // so the model's last note is the note the room will play.
        const start = outgoing.phraseStartBar;
        const outgoingTarget = start + ((1 - (start % 4) + 4) % 4) + 4 * 2;
        expect(outgoingTarget % 4).toBe(1);
        const line = [
          note('C4', 0), note('D4', 0.5), note('E4', 1), note('F4', 1.5),
          note('G4', 2), note('A4', 2.5), note('C5', 3),
        ];
        const outgoingBar = await renderBar(room, outgoing, outgoingTarget, line);
        const outgoingLast = outgoingBar.slice().sort((a, b) => a.beatTime - b.beatTime).at(-1)!;
        expect(midi(outgoingLast.pitch)).toBe(72);

        // THE TURN CHANGES HANDS. The incoming agent answers with a note the repairer drops, so its
        // line is built from its own centre (64) unless the room takes the outgoing agent's last note.
        const handoverTarget = outgoingTarget + 1;
        const handover = await renderBar(room, incoming, handoverTarget, [
          { pitch: 'Am4', beatTime: 0, velocity: 88, duration: 0.5 },
        ]);
        const first = firstNote(handover);

        // THE MUTATION'S FAILURE: with the handover move removed this first note is the incoming
        // agent's centre walk's F4 (65): a restart at its own centre. The first assertion below is
        // the one that reads it (1 semitone from the centre); with the move it is seven away and a
        // step under the note still ringing.
        expect(Math.abs(midi(first.pitch) - CENTRE), 'the handover bar restarts at the incoming agent’s own centre')
          .toBeGreaterThan(2);
        expect(Math.abs(midi(first.pitch) - midi(outgoingLast.pitch))).toBeLessThanOrEqual(2);
        expect(midi(first.pitch)).toBe(71);
        // ... and the source was the OUTGOING agent's bar, not anything of the incoming agent's own.
        expect(room.voiceFrom(handoverTarget)).toBe(72);
      });
    } finally {
      await close();
    }
  });
});
