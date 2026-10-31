import { env, runInDurableObject } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import { JamRoom } from './jam-room';
import {
  generateMeasureWithAi,
  type DecisionBrief,
  type MeasureContext,
  type TradeHalf,
} from './llm-planner';

/**
 * TRADE FOURS IN TWO-BAR TURNS.
 *
 * The lead rotates in TURNS, not by bar: one agent states a call across two bars while the other
 * answers under it, then the roles swap for the next two. This file reads that from both ends the
 * plan names — the role the room gave each bar, and the words the prompt carries into the model.
 *
 * The case the mutation is written against is the room one: it renders three turns of a two-agent
 * room and asserts the roles come in PAIRS, with the two halves of the prompt marked in order. With
 * the period set back to one bar (`TRADE_BARS = 1` in a scratch copy) the roles read lead, answer,
 * lead, answer — one bar each — and that case fails on the first pair, as does its prompt half.
 *
 * The two-bar pair is stated in this file as the number four (a turn opens on a bar divisible by
 * four for the first-spawned agent) and as `half 1 of 2` in the prompt assertions, NOT read from
 * `TRADE_BARS`: an expectation that moved with the constant would pass the mutation it exists to
 * catch.
 */

// ─── The prompt the model reads ─────────────────────────────────────────────

const answerWith = (notes: unknown) => ({ run: async () => ({ response: notes }) });

const brief: DecisionBrief = {
  role: 'lead', relation: 'vary', density: 'medium', register: 'mid', play: true, latencyMs: 0,
};

const ctxWith = (trade?: TradeHalf): MeasureContext => ({
  key: 'C major', bpm: 120, style: 'jazz', recentNotes: [], currentBeat: 0, trade,
});

describe('the trade the prompt describes', () => {
  it('names the half of the two-bar turn the bar is in, and what that half is for', async () => {
    const line = [{ pitch: 'C4', beatTime: 0, velocity: 88, duration: 0.5 }];
    const first = await generateMeasureWithAi(answerWith(line), ctxWith({ half: 1, of: 2 }), 'test-model', brief);
    const second = await generateMeasureWithAi(answerWith(line), ctxWith({ half: 2, of: 2 }), 'test-model', brief);

    expect(first.meta.prompt).toContain('TRADE: half 1 of 2');
    expect(first.meta.prompt).toContain('OPENS');
    expect(second.meta.prompt).toContain('TRADE: half 2 of 2');
    expect(second.meta.prompt).toContain('CLOSES');
  });

  it('says nothing about a trade when there is no partner to trade with', async () => {
    const line = [{ pitch: 'C4', beatTime: 0, velocity: 88, duration: 0.5 }];
    const solo = await generateMeasureWithAi(answerWith(line), ctxWith(), 'test-model', brief);
    expect(solo.meta.prompt).not.toContain('TRADE:');
  });
});

// ─── The room: one call, one answer, then the swap ─────────────────────────

type Shape = { pitch: string; beatTime: number; velocity: number; duration: number };

interface HeldAsk {
  maxTokens: number;
  prompt: string;
  answer: (text: string) => void;
}

interface AgentInternals {
  peer: { peerId: string; name: string };
  phraseStartBar: number;
  queue: Array<{ bar: number; notes: Shape[]; meta: BarMeta | null }>;
  barTimer: ReturnType<typeof setTimeout> | null;
  busy: boolean;
  hook: Shape[] | null;
  motif: unknown;
  lastBarNotes: Shape[] | null;
  lastBarNotesBar: number;
}

interface BarMeta {
  source?: string;
  prompt?: string;
  brief?: { role?: string; density?: string; relation?: string; register?: string } | null;
}

interface RoomInternals {
  roomState: { bpm: number; key: string; transportStartTime: number };
  agents: Map<string, AgentInternals>;
  renderAgentBar: (agent: AgentInternals, target?: number) => Promise<void>;
}

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

const roomStub = () => {
  const typedEnv = env as any;
  return typedEnv.JAM_ROOM.get(typedEnv.JAM_ROOM.idFromName(`trade-${crypto.randomUUID()}`)) as ReturnType<
    typeof env.JAM_ROOM.get
  >;
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

  ws.send(JSON.stringify({ type: 'join_room', name: 'TradePeer', kind: 'human' }));
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
 * Render ONE bar through the room's own render path and hand back what the room queued for it, meta
 * included: the brief the room finally gave the bar and the prompt that carried it to the model.
 */
const renderBar = async (
  room: RoomInternals,
  agent: AgentInternals,
  target: number,
): Promise<{ notes: Shape[]; meta: BarMeta | null }> => {
  const render = room.renderAgentBar(agent, target);
  let ask: HeldAsk | undefined;
  for (let wait = 0; wait < 300 && !ask; wait++) {
    await sleep(10);
    ask = ASKS[0];
  }
  if (!ask) throw new Error('the room asked for no bar');
  ASKS = [];
  // The model writes nothing: the bar falls back to the generator, and the role and the prompt this
  // case is about are decided BEFORE the call, so an empty answer changes neither.
  ask.answer('[]');
  await render;
  const entry = agent.queue.find(q => q.bar === target);
  if (!entry) throw new Error(`no bar queued for ${target}`);
  return { notes: entry.notes.map(n => ({ ...n })), meta: entry.meta ?? null };
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

/**
 * THE FIRST BAR OF A TWO-BAR TURN, for the agent spawned first. The room's clock pairs bars (0,1),
 * (2,3), ... from the transport's start, so the first agent holds the pairs whose slot is even: its
 * turn opens on a bar divisible by four. A bar is chosen from the phrase start so the assertion is
 * about the room's clock rather than about where a spawned agent happened to begin.
 */
const firstTurnBar = (from: number): number => {
  for (let bar = Math.max(0, from); bar < from + 8; bar++) if (bar % 4 === 0) return bar;
  throw new Error('no turn-opening bar within reach');
};

describe('the room trades in two-bar turns', () => {
  it('gives one agent the call for two bars and the other the answer, then swaps the turn', async () => {
    const { stub, close } = await openRoom(['Call Bot', 'Answer Bot']);
    try {
      await runInDurableObject(stub, async (instance: JamRoom) => {
        const room = instance as unknown as RoomInternals;
        ASKS.forEach(a => a.answer('[]'));
        await sleep(80);
        ASKS = [];
        const agents = [...room.agents.values()];
        if (agents.length < 2) throw new Error('the second agent did not spawn');
        const [caller, answerer] = agents as [AgentInternals, AgentInternals];
        quiet(caller);
        quiet(answerer);

        const base = firstTurnBar(caller.phraseStartBar);

        // THREE TURNS: the caller's, the answerer's, and the caller's again. Each bar is rendered by
        // BOTH agents, because both play every bar — the turn decides which of them leads it.
        const bars: Array<{
          bar: number;
          caller: BarMeta | null;
          answerer: BarMeta | null;
          callerPrompt: string;
          answererPrompt: string;
        }> = [];
        for (let i = 0; i < 6; i++) {
          const bar = base + i;
          const call = await renderBar(room, caller, bar);
          const answer = await renderBar(room, answerer, bar);
          bars.push({
            bar,
            caller: call.meta,
            answerer: answer.meta,
            callerPrompt: call.meta?.prompt ?? '',
            answererPrompt: answer.meta?.prompt ?? '',
          });
        }

        // THE CALL IS TWO BARS AND THE ANSWER IS THE OTHER AGENT'S TWO BARS UNDER IT, then the turn
        // changes hands. With a one-bar rotation this reads lead, answer, lead, answer and fails here.
        const roles = bars.map(b => [b.caller?.brief?.role ?? null, b.answerer?.brief?.role ?? null]);
        expect(roles, 'the roles come in pairs: the call for two bars, the answer for two bars').toEqual([
          ['lead', 'answer'],
          ['lead', 'answer'],
          ['answer', 'lead'],
          ['answer', 'lead'],
          ['lead', 'answer'],
          ['lead', 'answer'],
        ]);

        // AND EACH BAR KNOWS WHICH HALF OF ITS TURN IT IS: the opening bar first, the closing bar
        // second, on both sides of the trade, and the half resets when the turn changes hands.
        expect(bars[0]!.callerPrompt, 'the opening bar').toContain('TRADE: half 1 of 2');
        expect(bars[1]!.callerPrompt, 'the closing bar of the same turn').toContain('TRADE: half 2 of 2');
        expect(bars[2]!.answererPrompt, 'the answerer\u2019s turn opens with half 1').toContain('TRADE: half 1 of 2');
        expect(bars[3]!.answererPrompt, 'the answerer\u2019s turn closes with half 2').toContain('TRADE: half 2 of 2');
        // Every bar of the run named a half: not one prompt went out without it.
        for (const b of bars) {
          expect(b.callerPrompt, `bar ${b.bar} of the caller`).toContain('TRADE: half');
          expect(b.answererPrompt, `bar ${b.bar} of the answerer`).toContain('TRADE: half');
        }
        // ... and the two halves are the same ASK otherwise: the role and the density are unchanged.
        expect(bars[0]!.caller?.brief?.density).toBe(bars[1]!.caller?.brief?.density);
      });
    } finally {
      await close();
    }
  });

  it('does not hand a lone agent halves of a trade it is not in', async () => {
    const { stub, close } = await openRoom(['Solo Bot']);
    try {
      await runInDurableObject(stub, async (instance: JamRoom) => {
        const room = instance as unknown as RoomInternals;
        ASKS.forEach(a => a.answer('[]'));
        await sleep(80);
        ASKS = [];
        const solo = [...room.agents.values()][0];
        if (!solo) throw new Error('the agent did not spawn');
        quiet(solo);

        // Alone in the room there is no turn to take: the agent leads every bar, and a prompt that
        // said "half of a trade" would be describing a partner the room does not have.
        const base = solo.phraseStartBar + 4;
        const one = await renderBar(room, solo, base);
        const two = await renderBar(room, solo, base + 1);
        expect(one.meta?.prompt ?? '').not.toContain('TRADE:');
        expect(two.meta?.prompt ?? '').not.toContain('TRADE:');
        expect(one.meta?.brief?.role).toBe('lead');
        expect(two.meta?.brief?.role).toBe('lead');
      });
    } finally {
      await close();
    }
  });
});
