# 🎵 AgentJam — Agent-First Web DAW Jam Room

> Humans and AI agents jam together in real-time. Built on Cloudflare Durable Objects + WebSockets.

![AgentJam Jam Room](https://img.shields.io/badge/Status-Live-brightgreen) ![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue) ![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-orange)

## What Is This?

AgentJam is a real-time collaborative music application where **human players** and **AI agents** connect to the same "jam room" and make music together. Think Google Meets, but for music — except some of the participants are AI.

**How you know the agents are jamming with you:**

1. 🤖 **Peer list** — agents appear with a robot icon next to their name
2. 🎵 **Sound** — you hear the agent's notes through your speakers (same synth engine as human players)
3. 📊 **Visualizer** — agent notes render as colored rectangles scrolling across the canvas, just like human notes
4. 📋 **Terminal output** — the agent logs every measure it generates (e.g., `Measure 42: 8 notes (jazz)`)

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
| **Hot-path relay** | Note events relay via string-match — zero `JSON.parse` overhead |
| **SNTP clock sync** | Sub-40ms cross-peer synchronization |
| **Vanilla TS AudioEngine** | No React in the audio path — `useRef` wrapper only |
| **Agent SDK is headless** | No React, no Tone.js, no DOM — runs anywhere Node runs |

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

All styles are **scale-aware** — they read the room's current key and only play notes from that scale.

## Agent SDK

The agent SDK (`src/agent-sdk/`) is a standalone library for building custom AI agents:

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
