import { env, runInDurableObject } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import { JamRoom } from './jam-room';
import { accentMapFromDrums, pulseAccentMap, shapeLine, type AccentMap } from './melody';
import { drumBar } from './groove';

/**
 * ONE ACCENT MAP FOR THE ROOM.
 *
 * Two kinds of case. The first are pure: what the map is read from (the drummer's own bar, or the
 * bar's pulse when nobody drums), and that shaping two bars against ONE map gives them two velocity
 * profiles where the line's own arc would give them one. The last two are the room: the bars an agent
 * queues, read back from the queue the room will play from. With the `accents` argument dropped from
 * the `shapeLine` call, every one of them comes back with the arc's profile alone — two bars identical
 * on the same line, and the drummer's beat-two silence gone — which is what the mutation checks.
 */

type Shape = { pitch: string; beatTime: number; velocity: number; duration: number };

const note = (pitch: string, beatTime: number, velocity = 80, duration = 0.25): Shape =>
  ({ pitch, beatTime, velocity, duration });

/** Six notes on the sixteenth grid: slots 0, 2, 4, 6, 8 and either 12 or 13. */
const SIX = (last: number): Shape[] => [
  note('E4', 0),
  note('F4', 0.5),
  note('G4', 1),
  note('A4', 1.5),
  note('G4', 2),
  note('F4', last),
];

const LINE_SLOT_12 = SIX(3);
const LINE_SLOT_13 = SIX(3.25);

const velocities = (notes: Shape[]): number[] => notes.map(n => n.velocity);
const slots = (notes: Shape[]): number[] => notes.map(n => n.beatTime);

// ─── The map ─────────────────────────────────────────────────────────────────

describe('the room’s accent map', () => {
  it('is the drummer’s own figure, read slot for slot from the bar it will play', () => {
    const funk = accentMapFromDrums(drumBar('funk', 4), 4);
    expect(funk.from).toBe('drummer');
    expect(funk.bar).toBe(4);
    expect(funk.slots).toHaveLength(16);
    // THE KICK IS THE BAR'S LOUDEST HIT, the snare is 88 of it and a sixteenth hat is 58 of it: those
    // are the drummer's velocities in `groove.ts`, not a table of accents invented here.
    expect(funk.slots[0]).toBeCloseTo(1, 6);    // kick on beat one
    expect(funk.slots[3]).toBeCloseTo(1, 6);    // the pushed kick on beat one's last sixteenth
    expect(funk.slots[8]).toBeCloseTo(1, 6);    // kick on beat three
    expect(funk.slots[4]).toBeCloseTo(0.88, 6); // snare on beat two
    expect(funk.slots[12]).toBeCloseTo(0.88, 6); // snare on beat four
    expect(funk.slots[6]).toBeCloseTo(0.58, 6); // an off-eighth: only a hat is under it
  });

  it('names where the drummer is SILENT, not only where it is loud', () => {
    // The jazz figure comps on beat three and swings its hats; nothing sounds on beat two. That hole is
    // the map's most useful reading: a melody note left there is the bar's quiet note.
    const jazz = accentMapFromDrums(drumBar('jazz', 4), 4);
    expect(jazz.slots[4]).toBe(0);
    expect(jazz.slots[6]).toBeCloseTo(0.58, 6);
    expect(jazz.slots[8]).toBeCloseTo(0.88, 6);
    // and it is a different map from the bar's own pulse, which is the point of reading the drummer
    expect(jazz.slots).not.toEqual(pulseAccentMap(4).slots);
  });

  it('falls back to the bar’s pulse, and that map is the same for every bar', () => {
    const pulse = pulseAccentMap(4);
    expect(pulse.from).toBe('pulse');
    // one map, so two bars cannot be two accents: bar 4 and bar 8 read the same
    expect(pulseAccentMap(4).slots).toEqual(pulseAccentMap(8).slots);
    // beat one, then beat three, then the inner beats, then the off-eighths, then the sixteenths
    expect(pulse.slots[0]).toBe(1);
    expect(pulse.slots[8]).toBeGreaterThan(pulse.slots[4]!);
    expect(pulse.slots[4]).toBeGreaterThan(pulse.slots[2]!);
    expect(pulse.slots[2]).toBeGreaterThan(pulse.slots[1]!);
  });

  it('treats a drummer that played nothing as no accent at all', () => {
    expect(accentMapFromDrums([], 7)).toEqual(pulseAccentMap(7));
    // A HIT OFF THE BAR IS NOT AN ACCENT FOR ANY SLOT OF IT, and it does not set the bar's peak either:
    // the map of the two hits is the map of the one hit that landed inside the bar.
    const onAndOff = [note('C2', 4.5, 100), note('D3', 2, 80)];
    expect(accentMapFromDrums(onAndOff, 7).slots).toEqual(accentMapFromDrums([note('D3', 2, 80)], 7).slots);
    expect(accentMapFromDrums(onAndOff, 7).slots.filter(v => v > 0)).toHaveLength(1);
  });
});

// ─── One map, two bars ───────────────────────────────────────────────────────

describe('two bars shaped against one accent map', () => {
  const map = pulseAccentMap(4);

  it('are two velocity profiles where the arc alone would make them one', () => {
    const withMap = [
      shapeLine(LINE_SLOT_12, { contour: 'arch', density: 'medium', accents: map }),
      shapeLine(LINE_SLOT_13, { contour: 'arch', density: 'medium', accents: map }),
    ];
    const withoutMap = [
      shapeLine(LINE_SLOT_12, { contour: 'arch', density: 'medium' }),
      shapeLine(LINE_SLOT_13, { contour: 'arch', density: 'medium' }),
    ];

    // THE ARC CANNOT TELL THESE TWO BARS APART: same contour, same length, so its profile is the same
    // notes at the same weights. This is why the map exists, and what the mutation's shape collapses to.
    expect(velocities(withoutMap[0]!)).toEqual(velocities(withoutMap[1]!));

    // WITH THE MAP THEY DIFFER, AND ONLY AT THE NOTE THAT MOVED: slot 12 is beat four (0.70), slot 13
    // is a sixteenth between beats three and four (0.30).
    expect(slots(withMap[1]!).slice(0, 5)).toEqual(slots(withMap[0]!).slice(0, 5));
    expect(slots(withMap[1]!)[5]).toBe(3.25);
    expect(velocities(withMap[0]!).slice(0, 5)).toEqual(velocities(withMap[1]!).slice(0, 5));
    expect(withMap[0]![5]!.velocity).not.toBe(withMap[1]![5]!.velocity);
    // the beat is accented and the sixteenth is not, so the moved note can only lose weight
    expect(withMap[0]![5]!.velocity).toBeGreaterThan(withMap[1]![5]!.velocity);
  });

  it('are weighted by the slot, so the same note is shaped wherever the map puts it', () => {
    // The same six notes shifted one sixteenth: a downbeat becomes an off-sixteenth, so the profile
    // cannot be the one the unshifted bar had. A velocity that ignored the map would not move at all.
    const shifted = SIX(3).map(n => ({ ...n, beatTime: n.beatTime + 0.25 }));
    const moved = shapeLine(shifted, { contour: 'arch', density: 'medium', accents: map });
    const still = shapeLine(SIX(3), { contour: 'arch', density: 'medium', accents: map });
    expect(velocities(moved).every(v => v > 0)).toBe(true);
    expect(velocities(moved)).not.toEqual(velocities(still));
    // the note that moved off the downbeat is the one that lost the most: slot 0 is 1.0, slot 1 is 0.3
    expect(still[0]!.velocity).toBeGreaterThan(moved[0]!.velocity);
  });
});

// ─── The room: what the agent will actually play ─────────────────────────────

interface HeldAsk {
  maxTokens: number;
  prompt: string;
  answer: (text: string) => void;
}

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

const roomStub = () => {
  const typedEnv = env as any;
  return typedEnv.JAM_ROOM.get(typedEnv.JAM_ROOM.idFromName(`accents-${crypto.randomUUID()}`)) as ReturnType<
    typeof env.JAM_ROOM.get
  >;
};

interface AgentInternals {
  peer: { peerId: string };
  phraseStartBar: number;
  queue: Array<{ bar: number; notes: Shape[]; meta: { source?: string } }>;
  barTimer: ReturnType<typeof setTimeout> | null;
}

interface RoomInternals {
  agents: Map<string, AgentInternals>;
  layers: Map<string, { style: string }>;
  handleSetBacking: (drummer: boolean, bass: boolean) => void;
  renderAgentBar: (agent: unknown, target?: number) => Promise<void>;
  roomAccents: (bar: number) => AccentMap;
}

/** The model's held bar asks, per room. The stub pushes, the render walk answers. */
let ASKS: HeldAsk[] = [];

/** The model, as the test sends it: the warm answers at once, a bar ask is held until released. */
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

const openRoom = async (): Promise<{ stub: ReturnType<typeof roomStub>; close: () => Promise<void> }> => {
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

  ws.send(JSON.stringify({ type: 'join_room', name: 'AccentsPeer', kind: 'human' }));
  await sleep(40);
  ws.send(JSON.stringify({ type: 'spawn_agent', name: 'Accents Bot', style: 'jazz' }));
  await sleep(120);

  return {
    stub,
    close: async () => {
      ASKS.forEach(a => a.answer(JSON.stringify(LINE_SLOT_12)));
      ws.close();
      await sleep(50);
      await runInDurableObject(stub, async (instance: JamRoom) => {
        // @ts-expect-error - private method, called so the isolated storage frame can be popped
        instance.cleanupIntervals();
      });
    },
  };
};

/**
 * Render the given bars through the room's own render path and hand back the notes it queued for each
 * — the bar the room will publish at the line. `drummerAt` is the index after which the rhythm section
 * joins, so a room can be read with the bar's pulse and then with its drummer.
 */
const renderBars = async (
  stub: ReturnType<typeof roomStub>,
  lines: Shape[],
  count: number,
  drummerAt = -1,
  barOffset = 4,
): Promise<{ profiles: Shape[][]; maps: AccentMap[] }> => {
  let out: { profiles: Shape[][]; maps: AccentMap[] } = { profiles: [], maps: [] };

  await runInDurableObject(stub, async (instance: JamRoom) => {
    const room = instance as unknown as RoomInternals;
    const agent = [...room.agents.values()][0];
    if (!agent) throw new Error('agent did not spawn');

    // THE SPAWN'S OWN RENDER IS NOT THIS CASE: let it land, then empty the queue and stop the agent's
    // own bar line, so the only bars read back are the ones this case renders.
    ASKS.forEach(a => a.answer(JSON.stringify(lines)));
    await sleep(60);
    ASKS = [];
    agent.queue = [];
    if (agent.barTimer !== null) {
      clearTimeout(agent.barTimer as unknown as number);
      agent.barTimer = null;
    }

    const profiles: Shape[][] = [];
    const maps: AccentMap[] = [];
    // FOUR BARS APART, so every render sits in the same place in the phrase (state): the arc, the
    // density and the register are identical, and the only thing that can move a velocity is the map.
    for (let i = 0; i < count; i++) {
      if (i === drummerAt) room.handleSetBacking(true, false);
      const target = agent.phraseStartBar + barOffset + i * 4;
      const render = room.renderAgentBar(agent, target);
      let ask: HeldAsk | undefined;
      for (let wait = 0; wait < 300 && !ask; wait++) {
        await sleep(10);
        ask = ASKS[0];
      }
      if (!ask) throw new Error('the room asked for no bar');
      ASKS = [];
      ask.answer(JSON.stringify(lines));
      await render;

      const entry = agent.queue.find(q => q.bar === target);
      if (!entry) throw new Error(`no bar queued for ${target}`);
      profiles.push(entry.notes.map(n => ({ ...n })));
      maps.push(room.roomAccents(target));
    }
    out = { profiles, maps };
  });

  return out;
};

describe('the room’s bars carry the one map', () => {
  it('queues two bars with one velocity profile where the arc alone gives them one', async () => {
    const { stub, close } = await openRoom();
    try {
      // The LAST note is what moves: 3 (beat four) then 3.25 (a sixteenth later). Two different bars,
      // four apart, so both sit at the same place in the phrase and the map is the only variable.
      const { profiles, maps } = await renderBars(stub, LINE_SLOT_12, 1, -1, 4);
      const second = await renderBars(stub, LINE_SLOT_13, 1, -1, 8);
      const bars = [profiles[0]!, second.profiles[0]!];
      const barMaps = [maps[0]!, second.maps[0]!];

      // ONE MAP FOR BOTH BARS: no drummer in this room, so both bars read the bar's pulse.
      expect(barMaps[0]!.from).toBe('pulse');
      expect(barMaps[1]!.from).toBe('pulse');
      expect(barMaps[0]!.slots).toEqual(barMaps[1]!.slots);

      // THE SAME LINE, ONE NOTE LATER: every note but the last is the same music at the same weight.
      expect(slots(bars[0]!).slice(0, 5)).toEqual(slots(bars[1]!).slice(0, 5));
      expect(velocities(bars[0]!).slice(0, 5)).toEqual(velocities(bars[1]!).slice(0, 5));
      // THE MUTATION'S FAILURE: with the accent argument dropped these two bars come back with
      // identical velocity profiles, and this assertion fails on the pair being equal.
      expect(velocities(bars[0]!)).not.toEqual(velocities(bars[1]!));
      expect(bars[0]![5]!.beatTime).toBe(3);
      expect(bars[1]![5]!.beatTime).toBe(3.25);
      expect(bars[0]![5]!.velocity).toBeGreaterThan(bars[1]![5]!.velocity);
    } finally {
      await close();
    }
  });

  it('follows the drummer’s accents when a drummer joins, and stops following the bar’s pulse there', async () => {
    const { stub, close } = await openRoom();
    try {
      const { profiles, maps } = await renderBars(stub, LINE_SLOT_12, 3, 1);
      expect(profiles).toHaveLength(3);
      const [pulseBar, drumBarOne, drumBarTwo] = profiles as [Shape[], Shape[], Shape[]];

      // THE SAME LINE EACH TIME: the pitches and the slots are the same music, so the only thing that
      // differs between these three bars is the hands shaping them.
      expect(slots(pulseBar)).toEqual(slots(drumBarOne));
      expect(slots(drumBarOne)).toEqual(slots(drumBarTwo));

      // THE MAP CHANGED WITH THE DRUMMER, and it is the drummer's own figure for THAT bar.
      expect(maps[0]?.from).toBe('pulse');
      expect(maps[1]?.from).toBe('drummer');
      expect(maps[2]?.from).toBe('drummer');
      expect(maps[1]?.slots).toEqual(accentMapFromDrums(drumBar('jazz', maps[1]!.bar), maps[1]!.bar).slots);
      expect(maps[2]?.slots).toEqual(accentMapFromDrums(drumBar('jazz', maps[2]!.bar), maps[2]!.bar).slots);

      // THE DOWNBEAT IS THE ONE SLOT THE JAZZ FIGURE AND THE BAR'S PULSE AGREE ON (both are 1.0), so it
      // is the one note that comes out the same — the rest of the bar belongs to the drummer now.
      expect(drumBarOne[0]!.velocity).toBe(pulseBar[0]!.velocity);
      for (let i = 1; i < pulseBar.length; i++) {
        expect(drumBarOne[i]!.velocity, `note ${i} at slot ${drumBarOne[i]!.beatTime}`)
          .not.toBe(pulseBar[i]!.velocity);
      }

      // BEAT TWO IS EMPTY IN THE JAZZ FIGURE: the note left there loses its drum and is played well
      // under what the bar's pulse gave it. A global volume change cannot fake this reading, and the
      // mutation erases it.
      expect(drumBarOne[2]!.beatTime).toBe(1);
      expect(pulseBar[2]!.velocity - drumBarOne[2]!.velocity).toBeGreaterThanOrEqual(10);
      // and the note a sixteenth earlier, on the swung offbeat the jazz hat does play, is louder than
      // beat two: the drummer outranks the line's own arc.
      expect(drumBarOne[3]!.velocity).toBeGreaterThan(drumBarOne[2]!.velocity);
    } finally {
      await close();
    }
  });
});
