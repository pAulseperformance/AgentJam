# 🎵 AgentJam, Agent-First Web DAW Jam Room

> Humans and AI agents jam together in real-time. Built on Cloudflare Durable Objects + WebSockets.

![AgentJam Jam Room](https://img.shields.io/badge/Status-Live-brightgreen) ![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue) ![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-orange)

## What Is This?

AgentJam is a real-time collaborative music application where **human players** and **AI agents** connect to the same "jam room" and make music together. Think Google Meets, but for music, except some of the participants are AI.

**How you know the agents are jamming with you:**

1. 🤖 **Peer list**, agents appear with a robot icon next to their name
2. 🎵 **Sound**, you hear the agent's notes through your speakers (same synth engine as human players)
3. 📊 **Visualizer**, agent notes render as colored rectangles scrolling across the canvas, just like human notes
4. 📋 **Terminal output**, the agent logs every measure it generates (e.g., `Measure 42: 8 notes (jazz)`)

## Which model runs, and who gets it

Two tiers, decided when the room socket opens, from the one identity surface the fleet has
(`auth.zpe.vc`):

| | Anonymous visitor | Signed in through the door |
|---|---|---|
| Judge | none (the model decides) | **Jev** (`typesafe/jev-1.13`) answers three typed questions: density, register, and whether to rest |
| Renderer | `@cf/meta/llama-3.2-3b-instruct` | same model by default, and the panel offers the larger ones |
| Panel says | `LLM` | `LLM` + `🧭 jev · sparse/mid · 622ms` |

Jev never writes notes: it is a typed decision model, so it says *what* to play and the renderer
writes the measure. The tier is computed in the Worker from the door's answer and carried to the
room on a header a browser cannot set, so a client message cannot promote itself; an anonymous
socket that asks for a larger model is refused.

Measured through this app on 2026-10-29 (remote Workers AI binding): llama-3.2-3b 557ms,
llama-3.3-70b 3853ms, llama-4-scout 5483ms, Jev 482-1104ms from the edge. One measure at 120 BPM is
2000ms, which is why the public tier is the smallest model and why a measure that cannot finish in
time skips its turn instead of queueing. `@cf/meta/llama-3.1-8b-instruct` (retired upstream on
2026-05-30, error 5028) is gone; `src/shared/ai/models.ts` is the only list.

A room with no peers left despawns its agents: an in-process agent nobody can hear is still a billed
call every measure.

## How it plays in time

An agent runs on the ROOM's transport, not on its own clock. Bars are rendered ahead of the bar
playing and published on the bar line, with every note addressed to an absolute slot
(`transportStartTime + bar + beat`), so model latency costs freshness and never phase. The queue is two
deep because one overrunning render used to leave a random pattern bar between two model bars; an entry
whose bar has already started is dropped, and the pattern generator covers that bar instead.

After the model writes a bar, `src/server/measure-repair.ts` fixes what code can fix without asking a
model: sixteenth-grid snap, nearest-in-key pitch (flatter first), drop of a pitch another peer is
holding, drop of text that is not a note (`Am4` is a chord), one note per slot, density cap. Velocity
is MIDI 1-127 everywhere, including the pattern generator, which used to emit 0.2-0.8 into an engine
that divides by 127.

Measured live before and after, 14 bars each with the same probe: phase offset median 923ms to 0ms,
notes per bar 6.3 to 3.3 with rests now appearing, and key adherence is 100% by construction (before
this, raw model bars were played unvalidated and contained notes like D#4 and F#4 in C major).

## Does it jam with you

`src/server/listener.ts` reads the last two bars of everyone else into a small typed summary: contour,
register, articulation, which sixteenths are open, what sat on the strong beats, what is still held.
The agent keeps its own last bar as a `Motif`. Jev then answers five questions in one call, and the two
that matter are new: `role` (lead, answer, ornament, rest) and `relation` (restate, vary, new). Without
them the agent could only be told how MANY notes to play, so every bar was a solo whatever the room was
doing. The renderer gets the listener's summary, the motif, the move and the notes it may not double.

Two deterministic guarantees back it up: if the decision said answer and the model's bar shares no
pitch class with the phrase, one note moves onto the nearest of their pitches; and the motif is handed
to the model as text, so restate and vary have something concrete to restate or vary.

Re-measured on 2026-10-30 with phrases a default answer cannot accidentally match (F-A-D and B-D-G),
the composed reply shared two or more of those pitch classes in **0 of 5** bars, because the answer
constraint moved exactly one note. With `answerShare: 2` it shares two or more in **4 of 8**, and the
two replies built from a freshly heard bar hit both times. Level and pitch are separate measurements
and both are now on the record.

Measured on the live room, the same 20-bar probe run three times before and three after the
listener existed: consecutive agent bars keeping two or more of the same pitch classes (motif
recurrence) went from 9% to 56-62%, and when the decision was `answer` the reply shared two or more of
your pitch classes in 8 of 10 cases. Phase stayed at 0ms and key at 100%.

## The band, and why the drummer is not a model

Three players can share the room: the lead agent (a model, judged by Jev), a drummer, and a bass
player. The last two are code, `src/server/groove.ts`, on the same bar clock. A drummer generated by
a language model would be late, inconsistent bar to bar, and would cost a call per bar; a drummer is
fixed patterns and a clock, so it is the one part that must never be a model. The drummer counts the
room in with four quarters when it joins, so the tempo is heard rather than assumed, and the pattern
follows the style (swung offbeats for jazz, straight sixteenths for funk, a heartbeat for ambient).

The reactive half is separate from the composed half, which is the design the research on live
human-AI playing points at. Streaming accompaniment is an explicit trade between chunk size and
reactivity: a large chunk generated ahead is stable and incorporates your input late (arXiv 2510.22105).
So the composed line stays a bar ahead, and a deterministic comping layer answers inside the beat:
one consonant interval a third or fourth above what you just played, on the next eighth, never a
unison, at most twice a bar. ReaLJam adds the other half of that: a human jams better when the
machine shows its plan before it plays it (arXiv 2502.21267), so the panel states the queued bar
("Next bar: E4@0.5 C5@1 G5@1.25") while there is still time to react to it.

Measured live, 16 bars with drummer and bass on: reaction from a human note to the agent's next note
median 296ms and p90 548ms, against up to 2000ms by construction before this (the earliest possible
answer was the next bar line). Drummer and bass both sit at 0ms phase with a downbeat in 100% of bars,
and the plan was broadcast for 16 of 16 bars.

## Dynamics, and the two-bar lag they exposed

The listener reads how hard the room is playing (mean and peak velocity), the prompt states the
level, and the repairer SHIFTS the bar to it: a uniform move keeps the accents inside the bar, and a
whisper raised by a ratio is still a whisper (40 times 2.6 is 104, and the clamp that stops distortion
is what stopped it arriving).

Wiring it exposed a defect in the pipeline rather than in the dynamics. The bar for N+1 is rendered at
the bar line of N, so it can only hear up to N-1: measured with alternating loud and quiet phrases,
the reply answered a phrase TWO bars old, and a loud phrase and a quiet one got the same response
(gap 0 at mean velocity 100 either way). The fix is a one-per-bar REFRESH, chained on the previous
render's completion rather than on a timer, which re-renders the queued bar with fresh ears and
replaces it only if a model answer arrives before the bar line. It reuses the bar's own brief, because
a refresh that also paid for a Jev decision measured 1.2s against a 2s bar and never landed; without
it the refresh is about 0.7s and fits. Measured after, two runs: replies after a loud phrase mean 112
and 119, after a quiet phrase 42 and 57, so the room hears a gap of +62 and +70 where it heard 0.

The rest policy is deliberate and lives in code, not in the prompt: Jev kept answering "rest" for 7 of
20 bars, which is a third of the room silent. The room now overrides rest to `ornament` unless five
bars have passed since the last one, and three independent runs then rested exactly 3 bars out of 20.

## Quick Start

### Prerequisites

- Node.js 18+
- npm

### Install & Run

```bash
git clone https://github.com/pAulseperformance/AgentJam.git
cd AgentJam
npm install
```

#### Start the server

```bash
npm run dev:worker
# → http://localhost:8787
```

#### Launch an AI agent (in a second terminal)

```bash
npm run agent:jazz       # 🎷 Swing patterns with blue notes
npm run agent:ambient    # 🌊 Long sustained pads
npm run agent:funk       # 🕺 Tight 16th-note grooves
```

#### Open the browser

Go to `http://localhost:8787`, enter your name and room (`default-room`), and click **Start Audio**. You'll see the agent in the peer list and hear it playing.

#### Want a full band?

Run multiple agents in separate terminals:

```bash
npm run agent:jazz                                          # Terminal 2
npm run agent:funk                                          # Terminal 3
npx tsx scripts/run-agent.ts --style ambient --name "Pad Machine"  # Terminal 4
```

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│                    Cloudflare Worker                       │
│  ┌──────────────┐     ┌───────────────────────────────┐  │
│  │  Vite SPA    │────▶│  JamRoom Durable Object       │  │
│  │  (React UI)  │◀────│  • WebSocket lifecycle        │  │
│  └──────────────┘     │  • Peer tracking & colors     │  │
│                       │  • Hot-path note relay         │  │
│                       │  • MIDI panic on disconnect    │  │
│                       │  • SQLite batch persistence    │  │
│                       │  • SNTP clock sync             │  │
│                       └──────────┬────────────────────┘  │
│                                  │ WebSocket              │
│                                  ▼                        │
│                       ┌──────────────────────┐            │
│                       │  Agent SDK (headless) │            │
│                       │  • State machine      │            │
│                       │  • Note generation    │            │
│                       │  • Rate limiting      │            │
│                       └──────────────────────┘            │
└──────────────────────────────────────────────────────────┘
```

### Key Design Decisions

| Decision | Why |
|----------|-----|
| **Durable Objects** | Persistent WebSocket rooms with no external infrastructure |
| **Hibernation API** | Near-zero cost when rooms are idle |
| **Hot-path relay** | Note events relay via string-match, zero `JSON.parse` overhead |
| **SNTP clock sync** | Sub-40ms cross-peer synchronization |
| **Vanilla TS AudioEngine** | No React in the audio path, `useRef` wrapper only |
| **Agent SDK is headless** | No React, no Tone.js, no DOM, runs anywhere Node runs |

## Project Structure

```
src/
├── shared/protocol/         # Zod schemas, message types, constants
│   ├── types.ts
│   ├── constants.ts
│   └── index.ts
├── server/
│   ├── index.ts             # Worker entry point + routing
│   ├── jam-room.ts          # JamRoom Durable Object (375 LOC)
│   └── env.ts               # Typed Env bindings
├── client/
│   ├── App.tsx               # Landing page → JamRoom router
│   ├── main.tsx              # React entry
│   ├── pages/JamRoom.tsx     # Main page: assembles all features
│   └── features/
│       ├── room/             # WebSocket hook, PeerList, TransportBar
│       ├── synth/            # AudioEngine, useSynthEngine, Keyboard
│       └── visualizer/       # Canvas rAF visualizer
├── agent-sdk/                # Headless agent client library
│   ├── agent-client.ts       # WebSocket client (no React)
│   ├── agent-state.ts        # State machine
│   ├── measure-aggregator.ts # Note context → LLM prompt
│   ├── llm-planner.ts        # LLM integration (pluggable)
│   ├── note-scheduler.ts     # Beat → absolute time scheduling
│   ├── rate-limiter.ts       # 1 gen per 4 bars + adaptive backoff
│   └── index.ts              # Public API barrel
└── scripts/
    └── run-agent.ts          # Standalone CLI agent runner
```

## Agent Runner CLI

```bash
npx tsx scripts/run-agent.ts [options]

Options:
  --url <url>           WebSocket URL (default: ws://localhost:8787)
  --room <id>           Room ID (default: default-room)
  --name <name>         Agent display name (default: AI Musician)
  --style <style>       Generation style: jazz | ambient | funk | random
  --instrument <name>   Instrument label (default: PolySynth)
  --verbose             Log individual note events
```

### Generation Styles

| Style | Character | Notes/Measure | Velocities |
|-------|-----------|---------------|------------|
| `jazz` | Swing timing, blue notes, varied density | 4-12 | 0.4-0.8 |
| `ambient` | Long sustained pads, sparse | 2-6 | 0.2-0.5 |
| `funk` | 16th-note groove, rhythmic rests | 8-10 | 0.5-0.8 |
| `random` | Chaotic, exploratory | 3-13 | 0.3-0.8 |

All styles are **scale-aware**, they read the room's current key and only play notes from that scale.

## Agent SDK Extraction (Pending)

The agent SDK (`src/agent-sdk/`) is designed to be a standalone library for building custom AI agents. Currently, the LLM generation logic (`llm-planner.ts`) is tightly coupled to the server. A pending refactor will extract this into a standalone client library:

```typescript
import {
  JamRoomAgentClient,
  aggregateMeasureContext,
  LLMNotePlanner,
  NoteScheduler,
  GenerationRateLimiter,
} from './agent-sdk';

const client = new JamRoomAgentClient({
  wsUrl: 'wss://agent-jam.admin-1e3.workers.dev/api/room/my-room/ws',
  name: 'My Agent',
  instrument: 'PolySynth',
  onMeasureReady: async (ctx) => {
    const context = aggregateMeasureContext(ctx);
    const plan = await planner.generatePlan(context);
    scheduler.schedulePlan(plan, ctx);
  },
});

client.connect();
```

### SDK Modules

| Module | Purpose |
|--------|---------|
| `JamRoomAgentClient` | Headless WebSocket client with auto-reconnect |
| `AgentState` | State machine (idle → connected → listening → generating) |
| `aggregateMeasureContext()` | Transforms note buffer into structured LLM context |
| `LLMNotePlanner` | Calls any LLM API with 200ms timeout, parses JSON note plans |
| `NoteScheduler` | Converts beat times to absolute ms + playout delay |
| `GenerationRateLimiter` | Max 1 gen per 4 bars, adaptive backoff on timeouts |

## WebSocket Protocol

### Client → Server

| Message | Fields | Description |
|---------|--------|-------------|
| `join_room` | `name`, `kind` (human/agent), `instrument?` | Register as peer |
| `note_on` | `peerId`, `pitch`, `beatTime`, `velocity`, `timestamp` | Start playing a note |
| `note_off` | `peerId`, `pitch`, `beatTime`, `velocity`, `timestamp` | Stop playing a note |
| `bpm_change` | `bpm` (20-300) | Change room BPM |
| `key_change` | `key` (e.g., "C major") | Change room key |
| `clock_sync_ping` | `t0`, `peerId` | SNTP time sync request |

### Server → Client

| Message | Fields | Description |
|---------|--------|-------------|
| `room_state` | `roomState`, `peers[]` | Full room state on join |
| `peer_joined` | `peer` | New peer connected |
| `peer_left` | `peerId` | Peer disconnected |
| `clock_sync_pong` | `t1`, `t2` | SNTP time sync response |
| `error` | `message`, `code?` | Error notification |

Note events are relayed to all other peers via hot-path string matching (no `JSON.parse` on relay).

## Deployment

```bash
# Build + deploy to Cloudflare
npm run build
npm run deploy
# → https://agent-jam.admin-1e3.workers.dev

# Run agent against production
npx tsx scripts/run-agent.ts --url wss://agent-jam.admin-1e3.workers.dev --style funk
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Cloudflare Workers |
| State | Durable Objects + SQLite |
| Transport | WebSocket (Hibernation API) |
| Frontend | React 19 + Vite 6 |
| Audio | Tone.js (PolySynth) |
| Validation | Zod |
| Types | TypeScript 5.7 (strict) |
| Agent | Vanilla TS (no framework) |

## License

MIT
