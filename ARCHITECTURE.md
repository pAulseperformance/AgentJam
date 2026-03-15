# Agent-First Web DAW Jam Room — v5 (Production-Audio Grade)

A real-time collaborative music environment where **human musicians and AI agents are equal peers**, connected via WebSocket to a shared jam room. All communication is lightweight JSON note events ("Cloud MIDI") — no audio transmitted.

> [!IMPORTANT]
> **v5 Upgrade**: This version incorporates expert-level audio engineering critiques (Phase 10) that address hidden physical constraints in distributed real-time audio: SNTP clock sync, React thread starvation, DO I/O thrashing, live input delay, hanging notes, and LLM agent ergonomics. These mitigations are folded into every relevant section below.

---

## Phase 1: Problem Space

**Goal**: Enable humans and AI agents to jam together in real-time by exchanging symbolic note events over WebSocket, with each client synthesizing audio locally.

**Hard Constraints**:
- Solo founder, no team — must be buildable in <2 weeks
- Cloudflare Workers ecosystem (existing muscle memory)
- Zero infrastructure cost at idle (Hibernation API)
- Browser-only for humans (no desktop app)
- No audio transmission — JSON events only

**Primary Read Path**: A peer connects to a room and receives (1) current room state (BPM, key), (2) peer list, (3) real-time stream of note events from all other peers.

---

## Phase 2: Critique & Destroy 🔥

| # | Criticism | Severity | Mitigation |
|---|-----------|----------|------------|
| 1 | **Clock Skew (SNTP + Audio Anchor)** — `beat_time` depends on synchronized time, but naive `clockOffset = serverTime - localTime` ignores Network Round-Trip Time (RTT). A 60ms one-way packet delay makes the offset permanently wrong by 60ms — audible as drum flams. Furthermore, `Date.now()` (OS system clock) and `Tone.now()` (hardware audio clock) tick at different rates and will drift apart over a 20-minute jam session. | 🔴 Critical | **True SNTP Ping-Pong Handshake**: (1) Client sends ping with `t0` = `performance.now()`. (2) DO responds with `t1` (receive time) and `t2` (send time). (3) Client receives at `t3`. (4) `TrueOffset = ((t1 - t0) + (t2 - t3)) / 2`. Repeat every 30s to track drift. **Audio Clock Anchor**: Map the synchronized server `beat_time` directly to `Tone.now()`. **Never use `Date.now()` for audio scheduling.** All scheduling math uses `Tone.Transport.seconds` as the single source of truth. Encapsulated in `src/shared/utils/clock-sync.ts`. |
| 2 | **DO is SPOF per room** — if DO crashes, all peers disconnect and in-memory state is lost. | 🟡 Medium | Clients auto-reconnect with exponential backoff. DO re-instantiates from persisted storage. `sequences` survive in `ctx.storage`. Transport state persisted on every mutation. |
| 3 | **No auth in MVP** — any peer can impersonate any `peer_id`, send garbage, or spam notes. | 🟡 Medium | Acceptable for MVP (prototype). Phase 2 adds Bearer token for agents + rate limiting (max 100 note events/sec per peer). Server assigns `peer_id` — clients cannot choose their own. |
| 4 | **Broadcast O(N)** — at 20 peers × 10 notes/sec = 200 msgs/sec, DO broadcasts 200 × 19 = 3,800 sends/sec. Single-thread blocks inbound processing during broadcast. | 🟡 Medium | DO soft limit is 1000 inbound req/s. Outbound `ws.send()` is not rate-limited. At 20 peers this is fine. At 50+, shard rooms into sub-rooms or use fan-out Worker. |
| 5 | **Patch consistency** — peers use different Tone.js versions or configurations, causing different sounds for same note events. | 🟢 Low | MVP uses one hardcoded PolySynth patch. Server broadcasts `patch_config` in `room_state`. Future: hash-verified patch distribution. |
| 6 | **React Main Thread Starvation** — piping 50–100 incoming WebSocket note events per second into React state (`setNotes([...notes, newNote])`) triggers constant reconciliation cycles. This causes heavy Garbage Collection (GC) spikes, blocking the browser's main thread. **A blocked main thread causes Tone.js to instantly glitch, crackle, and stutter.** | 🔴 Critical | **Decouple hot-path from React entirely.** (1) **Audio Path**: Route WS `onmessage` directly to a vanilla TypeScript `AudioEngine` class that triggers Tone.js — zero React involvement. (2) **Visual Path**: Push note data into a mutable `useRef`. Have `Visualizer.tsx` read from the ref using a native `requestAnimationFrame` canvas loop. React remains entirely ignorant of the real-time event loop. Encapsulated in `src/client/features/synth/model/audio-engine.ts`. |
| 7 | **DO Serialization & I/O Thrashing** — if 10 peers send 10 notes per second = 100 SQLite inserts/sec. Synchronous disk writes or `JSON.parse()` 100 times/sec inside the DO's single event loop introduces micro-stutters to the WS relay, ruining the tightness of the master clock. | 🟡 Medium | **Zero-Cost Router + Batch Persist.** (1) **Hot Path**: Treat the DO as a "dumb router" for note relays. String-match `"type":"note_event"` and instantly `ws.send(rawString)` to other peers — no `JSON.parse()`. (2) **Cold Path**: Push raw strings into an in-memory array. Use `ctx.waitUntil()` or a `setInterval` to parse and bulk-insert the array to SQLite every 5 seconds via `flushToSQLite()`. |
| 8 | **Live Input Playout Delay Paradox** — Lookahead scheduling (`beat_time: 4.5`) is perfect for AI agents, but humans play *live*. If a human hits a key on Beat 4.0 and broadcasts `beat_time: 4.0`, it takes ~40ms to reach remote peers. Remote peers receive the note *in the past* (at beat 4.0 + 40ms). Tone.js will either drop it or play it out of phase. | 🟡 Medium | **Hybrid Playout Delay.** Local playback is instant (zero latency for the performer). For broadcast: schedule the note at `Tone.now() + playoutDelay` (configurable, default 40ms) and send that exact future timestamp to the DO. Remote peers schedule at the received timestamp. This sacrifices perfect global sync by ~40ms but preserves instant local feedback — the standard approach used by every professional DAW for monitoring latency. |
| 9 | **Hanging Notes / MIDI Panic** — if a human or AI sends `note_on` but their Wi-Fi drops or script crashes before `note_off`, that note drones indefinitely in every other peer's speakers, ruining the jam. | 🟡 Medium | **DO Connection Lifecycle Cleanup.** (1) DO maintains `activeNotes: Map<WebSocket, Set<string>>` tracking which pitches each peer has active. (2) On native Cloudflare `webSocketClose` and `webSocketError` events, DO automatically broadcasts fabricated `note_off` events for all of that peer's active pitches. (3) Client-side safety: auto-release any note held longer than 30 seconds. |

---

## Phase 3: Trade-off Matrices 📊

### Real-Time Transport

| Criteria | WebSocket (via DO) | WebRTC Data Channel | Server-Sent Events |
|----------|-------------------|--------------------|-------------------|
| Latency | 20-80ms (via CF edge) | 5-30ms (P2P direct) | 50-200ms (unidirectional) |
| Topology | Star (DO is hub) | Mesh (N² connections) | Star (server push only) |
| Bidirectional | ✅ | ✅ | ❌ (server→client only) |
| Agent compatibility | ✅ (any WS client) | ❌ (needs browser/WebRTC stack) | ⚠️ (send via HTTP POST) |
| State management | ✅ (DO is state authority) | ❌ (no central state) | ⚠️ (separate state server) |
| Complexity | Low | High (signaling, NAT traversal, STUN/TURN) | Low |
| Max peers per room | ~50 (DO limit) | ~6-8 (mesh degrades) | Unlimited (read-only) |
| Cost at idle | $0 (Hibernation API) | $0 (P2P) | N/A |

**Recommendation: WebSocket via DO.** We're sending ~150-byte JSON events, not audio. The 20-80ms latency is absorbed by lookahead scheduling. P2P mesh breaks at >8 peers and can't accommodate headless agents. The DO gives us free state authority.

### State Manager

| Criteria | Durable Objects | Upstash Redis | Supabase Realtime |
|----------|----------------|---------------|-------------------|
| Latency | <10ms (same-origin) | 20-50ms (external) | 50-100ms (Postgres) |
| WebSocket native | ✅ (Hibernation API) | ❌ (need WS proxy) | ✅ (channels) |
| Strong consistency | ✅ (single-thread) | ⚠️ (eventual) | ⚠️ (Postgres MVCC) |
| Cost at idle | $0 | $0 (free tier) | $0 (free tier) |
| Cost at 10K MAU | ~$5/mo | ~$10/mo | ~$25/mo |
| Vendor lock-in | Medium (CF only) | Low | Medium |
| Agent-first API | ✅ (WS upgrade) | ❌ (need custom) | ⚠️ (REST/Realtime) |

**Recommendation: Durable Objects.** Native WebSocket + state in one primitive. Single-thread = no race conditions. Hibernation = zero cost idle. No external dependency.

### Synth Engine

| Criteria | Tone.js v15 | Elementary Audio | Raw Web Audio API |
|----------|------------|-----------------|-------------------|
| Bundle size | ~150KB gzipped | ~80KB | 0KB (native) |
| PolySynth built-in | ✅ | ❌ (build from primitives) | ❌ |
| Scheduling (Transport) | ✅ (Tone.Transport) | ❌ (manual) | ❌ (manual) |
| GitHub stars | 13K+ | 1.5K | N/A |
| Learning curve | Low | Medium | High |
| AudioWorklet DSP | ⚠️ (some support) | ✅ (core design) | ✅ (native) |

**Recommendation: Tone.js for MVP.** Built-in PolySynth, Transport, and scheduling. Swap to Elementary Audio for custom DSP in Phase 2 if needed.

### Clock Synchronization (v5 — NEW)

| Criteria | Naive Offset (`serverTime - localTime`) | SNTP Ping-Pong + Audio Anchor | NTP Library (e.g., `ntp-client`) |
|----------|----------------------------------------|-------------------------------|----------------------------------|
| RTT compensation | ❌ (ignores network delay entirely) | ✅ (full round-trip calculation) | ✅ (full NTP algorithm) |
| Audio clock alignment | ❌ (uses `Date.now()`, drifts from `Tone.now()`) | ✅ (anchored to `AudioContext.currentTime`) | ❌ (system clock only) |
| Implementation complexity | Trivial (~5 LOC) | Moderate (~80 LOC) | High (external dependency) |
| Works in browser | ✅ | ✅ | ❌ (needs UDP, blocked in browser) |
| Drift correction over time | ❌ (one-shot) | ✅ (periodic re-sync every 30s) | ✅ |
| Precision for music | ❌ (~60ms error possible) | ✅ (<5ms error after calibration) | N/A (not browser-compatible) |

**Recommendation: SNTP Ping-Pong + Audio Anchor.** The only approach that compensates for RTT AND anchors to the hardware audio clock. Critical for maintaining rhythmic integrity across a 20-minute session.

### Audio Architecture (v5 — NEW)

| Criteria | React State-Driven (`useState` per note) | Vanilla TS AudioEngine (decoupled) |
|----------|------------------------------------------|-------------------------------------|
| GC pressure at 100 events/sec | 🔴 Severe (constant re-renders, array allocations) | 🟢 None (no React involvement) |
| Tone.js scheduling reliability | 🔴 Glitches when main thread blocked by React reconciliation | 🟢 Runs independently of React lifecycle |
| Visualizer performance | 🟡 React re-renders throttled by event volume | 🟢 `requestAnimationFrame` reads from mutable ref |
| Code complexity | Low (familiar React patterns) | Medium (two-layer architecture: AudioEngine + React wrapper) |
| Testability | Medium | High (AudioEngine is pure TS, unit-testable without DOM) |

**Recommendation: Vanilla TS AudioEngine.** The performance characteristics of real-time audio are fundamentally incompatible with React's reconciliation model at high event rates. The AudioEngine class handles the hot path; React handles the cold path (UI controls, peer list, transport bar).

---

## Phase 4: Constraints & Limits Audit 🚧

| Service | Hard Limit | Escape Hatch |
|---------|-----------|-------------|
| **DO: SQLite storage** | 10 GB per DO (paid), unlimited per account | More than enough — 10K events ≈ 1.5MB |
| **DO: KV key+value** | 2 MB combined (SQLite-backed) | Use SQL API instead for sequences |
| **DO: SQL row/blob** | 2 MB max per row | Each note event JSON ≈ 150 bytes |
| **DO: Inbound requests** | ~1000 req/s (20 WS msgs = 1 req) | Shard rooms at 50+ peers |
| **DO: WS message size** | 32 MiB max | Note events are ~150 bytes — no risk |
| **DO: Single-thread I/O** | One event loop — synchronous disk writes or `JSON.parse()` at high frequency will block WS relay | **Hot-path router**: string-match note events and relay raw strings without parsing. Batch persist to SQLite every 5 seconds via `flushToSQLite()`. |
| **Worker: CPU time** | 30s paid / 10ms free | Note relay is sub-1ms |
| **Worker: Memory** | 128 MB | DO state is <1MB even with 10K events |
| **Tone.js: AudioContext** | 6 per page (browser) | We use 1 |
| **Web Audio: Latency** | ~128 samples minimum (~3ms at 44.1kHz) | Acceptable for music |
| **Web Audio: Clock drift** | `AudioContext.currentTime` drifts from `Date.now()` at ~1ms/min | **Never use `Date.now()` for audio scheduling** — anchor all beat math to `Tone.now()` via `clock-sync.ts` |
| **React: Main thread budget** | ~16ms per frame at 60fps — React reconciliation on high-frequency state updates consumes this budget | **Route WS audio events directly to `AudioEngine` class** — React never sees note events |
| **WebSocket: Free tier** | 100K requests/day | MVP usage << 100K |

> [!NOTE]
> **Storage clarified from official docs**: SQLite-backed DOs (new default) have **2 MB** key+value combined and **10 GB** SQLite storage per DO. The 128 KiB limit only applies to legacy KV-backed DOs. The 32 KiB figure previously cited was incorrect. We use `ctx.storage.sql` — no chunking needed.

> [!WARNING]
> **v5 Audio Physics Constraints**: Three constraints are invisible in standard web architectures but critical for real-time audio: (1) OS clock vs audio clock drift, (2) React GC spikes blocking the audio thread, (3) DO event loop stalls from synchronous I/O. All three are mitigated in this architecture — see Phase 2 items 1, 6, and 7.

---

## Phase 5: UI Data Access Pattern 🖥️

| Page | Data Needed | Source | Query Pattern |
|------|------------|--------|---------------|
| **Landing** | None (room ID input) | N/A | N/A |
| **Jam Room** | Room state, peer list, note stream | WebSocket | Single persistent connection — all data pushed |

**Ideal query in plain English**: "Connect to room X and continuously receive BPM, key, who's connected, and every note anyone plays — in real-time, ordered by beat position."

**Schema derivation**: No traditional database. DO in-memory state IS the schema:

```typescript
// This is the "database" — lives in DO memory + ctx.storage
roomState: { bpm, key, transportStartTime, serverTime }
peers: Map<peerId, { name, kind, instrument, color }>
sequences: NoteEvent[]  // ring buffer, persisted in SQLite table (batch-flushed every 5s)
activeNotes: Map<WebSocket, Set<string>>  // v5: tracks active pitches per peer for MIDI panic
pendingFlush: string[]  // v5: raw event strings awaiting batch SQLite insert
```

**N+1 risk**: None. All data arrives via single WebSocket. No sub-queries.

**Data flow architecture (v5)**:

```
WebSocket onmessage
    ├── Hot Path (note_event) ──→ string-match, relay raw to peers (no JSON.parse)
    │                           └──→ push raw string to pendingFlush[]
    └── Cold Path (all other) ──→ JSON.parse ──→ state mutation ──→ broadcast

Client-side:
WebSocket onmessage
    ├── Audio Path ──→ AudioEngine.playNote() ──→ Tone.js (bypasses React entirely)
    └── Visual Path ──→ noteBufferRef.current.push() ──→ rAF canvas loop reads ref
```

---

## Phase 6: Failure Mode Analysis 💀

| Component | Failure Mode | User Impact | Mitigation | Recovery |
|-----------|-------------|-------------|-----------|----------|
| **DO instance** | Crash / eviction | All peers disconnect | Auto-reconnect with backoff | DO re-instantiates, loads state from storage |
| **WebSocket** | Network drop | Single peer loses connection | Client reconnect + re-hydrate from DO | Peer rejoins, gets `room_state` + `sequences` |
| **Tone.js** | AudioContext blocked | No sound | "Click to start" button (browser requirement) | User gesture triggers `Tone.start()` |
| **Agent** | Script crash | Agent stops playing, others unaffected | Agent-side reconnect logic | Agent rejoins room |
| **BPM change mid-playback** | Timeline drift | Notes play at wrong time | Recalculate `transportStartTime` | All peers receive corrected `room_state` |
| **Clock skew (SNTP)** | `beat_time` drift between peers | Notes slightly out of sync | SNTP ping-pong re-sync every 30s, anchored to `Tone.now()` | Client recalculates `TrueOffset` on each sync cycle |
| **Clock drift (Audio vs OS)** | `Date.now()` and `Tone.now()` diverge over 20-min session | Gradually worsening timing errors | **Never use `Date.now()` for scheduling** — all beat math anchored to `AudioContext.currentTime` via `clock-sync.ts` | Periodic re-anchor on each SNTP sync |
| **Malicious peer** | Spam 1000 notes/sec | Room flooded | Server-side rate limit (100 events/sec/peer) | Excess events dropped, peer warned |
| **React GC spike** | Main thread blocked >16ms during high note volume | Tone.js glitches, audio crackle, visual stutter | Audio path fully decoupled from React — `AudioEngine` class handles Tone.js directly; visualizer reads from `useRef` via `requestAnimationFrame` | No recovery needed — architecture prevents the failure mode |
| **Hanging note (MIDI panic)** | Peer sends `note_on` then disconnects before `note_off` (Wi-Fi drop, script crash, tab close) | Note drones indefinitely in all other peers' speakers | DO maintains `activeNotes: Map<WebSocket, Set<string>>`. On `webSocketClose`/`webSocketError`, DO broadcasts fabricated `note_off` for all of that peer's active pitches. Client-side safety: auto-release notes held >30s. | Immediate cleanup — other peers hear the note stop within one WS broadcast cycle |
| **DO I/O thrashing** | 100+ SQLite inserts/sec from 10 peers × 10 notes/sec blocks WS relay | Micro-stutters in master clock, notes arrive late | **Hot-path router**: note events relayed as raw strings without `JSON.parse()`. `pendingFlush[]` batch-inserts to SQLite every 5 seconds. | No recovery needed — architecture prevents the failure mode |

---

## Phase 7: Migration & Rollback Plan 🔄

**Migration**: Greenfield project — no existing state to migrate. Deploy creates new DO namespace.

**Rollback**:
- Branch: `feat/web-daw-jam-room` → PR to `staging`
- Revert: `git revert` merge commit. No persistent state affected (rooms are ephemeral).
- DO storage: rooms die when empty — no orphaned data.

**Canary Criteria**:
- WebSocket connection success rate > 99%
- Note event round-trip < 150ms (p95)
- SNTP clock sync accuracy < 10ms drift (p95)
- Zero audio glitches during 5-minute sustained 4-peer jam test
- Zero 5xx errors in Worker logs for 30 minutes post-deploy

---

## Phase 8: Architecture Decision Record

### Context
Building an agent-first collaborative music environment. Need real-time bidirectional communication between humans (browsers) and AI agents (headless scripts) with consistent state management and zero idle cost.

### Decision
Use **Cloudflare Durable Objects** with Hibernation WebSocket API as the central hub. Star topology with DO as state authority. JSON "Cloud MIDI" protocol with `beat_time` scheduling anchored to `AudioContext.currentTime` via SNTP ping-pong sync. **Tone.js** for client-side audio synthesis routed through a **vanilla TypeScript AudioEngine** class decoupled from React's render cycle. No audio transmission.

### Trade-offs Accepted
- **Higher latency than WebRTC** (20-80ms vs 5-30ms) — acceptable because we're sending symbolic events, not audio. Lookahead scheduling absorbs jitter.
- **Single-thread bottleneck at scale** — DO caps around 50 active peers. Acceptable for MVP. Escape: shard into sub-rooms.
- **No preset ecosystem** — single hardcoded synth patch. Acceptable for prototype.
- **Hybrid playout delay** (v5) — local playback is instant, but broadcast is delayed by ~40ms to ensure remote peers can schedule notes in the future rather than the past. Trades perfect global sync for natural local feedback. This is the standard approach used by professional DAWs and networked game engines.
- **Two-layer client architecture** (v5) — vanilla TS `AudioEngine` handles the real-time hot path (Tone.js scheduling, note triggering) while React handles the cold path (UI controls, peer list, transport bar). Adds architectural complexity but eliminates the fundamental incompatibility between React's reconciliation model and real-time audio at high event rates.
- **DO hot-path routing** (v5) — note events are relayed as raw strings without `JSON.parse()` to avoid blocking the event loop. SQLite persistence is batch-flushed every 5 seconds. Trades strict per-event durability for relay performance. Acceptable because note events are ephemeral — if the DO crashes, the room re-initializes and peers reconnect.

### Limits & Risks
- DO SQLite storage: 10GB per DO, 2MB per row — more than sufficient. No chunking needed.
- SNTP clock sync → periodic ping-pong handshake every 30s, TrueOffset anchored to `Tone.now()`
- Audio vs OS clock drift → `Date.now()` banned from audio scheduling; all beat math uses `AudioContext.currentTime`
- No auth in MVP → server-assigned `peer_id`, rate limiting in Phase 2

### Alternatives Considered
- **WebRTC Data Channels**: Lower latency but mesh topology degrades at >8 peers and headless agents need full WebRTC stack. Rejected.
- **Upstash Redis**: External dependency, no native WebSocket, eventual consistency. Rejected.
- **Supabase Realtime**: Higher latency, Postgres overhead for ephemeral event relay. Rejected.
- **React state for audio events**: Familiar pattern but fundamentally incompatible with real-time audio at >50 events/sec due to GC pressure and main thread starvation. Rejected.
- **Naive `Date.now()` clock sync**: Ignores RTT and drifts from audio clock. Rejected in favor of SNTP + Audio Anchor.

---

## Phase 9: Iterative Refinement

### 9a: Cross-System Validation
- No conflicts with existing systems (empty workspace).
- **Synergy**: User's shader physics skills directly transferable to WebGL audio visualization.
- **Enables**: Future Agent Hub integration — agents connect to jam rooms via the same API they'd use for any other tool.

### 9b: Compliance Audit

| Rule | Status | Notes |
|------|--------|-------|
| FSD layer hierarchy | ✅ Pass | `shared/` → `features/` → `App.tsx` |
| Barrel file enforcement | ✅ Pass | Every slice has `index.ts` |
| 300 LOC limit | ✅ Pass | Largest file ~200 LOC (`jam-room.ts` with hot-path router) |
| TypeScript strict (no `any`) | ✅ Pass | All types defined in protocol |
| Zod at network boundary | ✅ Pass | All inbound WS messages validated (cold path only — hot path uses string-match) |
| Conventional commits | ✅ Pass | Branch + PR workflow |
| PascalCase components, kebab-case files | ✅ Pass | Per file inventory |
| Unified Worker pattern | ✅ Pass | `wrangler.jsonc` with assets + DO |
| React decoupled from audio hot-path | ✅ Pass | `AudioEngine` is vanilla TS — no React imports |
| Clock sync anchored to AudioContext | ✅ Pass | `clock-sync.ts` uses `Tone.now()`, never `Date.now()` |
| DO I/O batched | ✅ Pass | `flushToSQLite()` runs every 5s via `setInterval` |
| MIDI panic on peer disconnect | ✅ Pass | `webSocketClose` handler broadcasts `note_off` for all active pitches |

### 9c: File Inventory (24 files)

| # | Action | Path | LOC | Notes |
|---|--------|------|-----|-------|
| 1 | NEW | `package.json` | 35 | |
| 2 | NEW | `tsconfig.json` | 20 | |
| 3 | NEW | `wrangler.jsonc` | 20 | |
| 4 | NEW | `vite.config.ts` | 25 | |
| 5 | NEW | `src/shared/protocol/types.ts` | 100 | v5: added `ClockSyncPing`, `ClockSyncPong`, `NoteOff` (MIDI panic), `MeasureComplete` types |
| 6 | NEW | `src/shared/protocol/constants.ts` | 45 | v5: added `PLAYOUT_DELAY_MS`, `CLOCK_SYNC_INTERVAL_MS`, `FLUSH_INTERVAL_MS`, `MAX_NOTE_HOLD_S` |
| 7 | NEW | `src/shared/protocol/index.ts` | 5 | |
| 8 | NEW | `src/shared/utils/clock-sync.ts` | 80 | **v5 NEW** — SNTP ping-pong RTT calculation, `TrueOffset` computation, periodic re-sync, `getTrueNetworkTime()` function, anchored to `Tone.now()` |
| 9 | NEW | `src/server/index.ts` | 25 | |
| 10 | NEW | `src/server/jam-room.ts` | 250 | v5: expanded with hot-path string-match router, `pendingFlush[]` array, `flushToSQLite()` debounced batch insert, `activeNotes` map, `webSocketClose`/`webSocketError` MIDI panic handler |
| 11 | NEW | `src/server/env.ts` | 10 | |
| 12 | NEW | `src/client/main.tsx` | 15 | |
| 13 | NEW | `src/client/App.tsx` | 60 | |
| 14 | NEW | `src/client/features/room/model/use-room-socket.ts` | 130 | v5: routes note events directly to `AudioEngine` (not React state). Only cold-path events (peer list, room state, transport) update React state. |
| 15 | NEW | `src/client/features/room/ui/JamRoom.tsx` | 100 | |
| 16 | NEW | `src/client/features/room/ui/PeerList.tsx` | 50 | |
| 17 | NEW | `src/client/features/room/ui/TransportBar.tsx` | 80 | |
| 18 | NEW | `src/client/features/room/index.ts` | 5 | |
| 19 | NEW | `src/client/features/synth/model/audio-engine.ts` | 150 | **v5 NEW** — Pure vanilla TS class (no React imports). Manages Tone.js PolySynth, handles playout delay scheduling (`Tone.now() + PLAYOUT_DELAY_MS`), note-on/note-off tracking, AudioContext lifecycle. Exposes `playNote()`, `stopNote()`, `setTransport()`, `dispose()`. |
| 20 | NEW | `src/client/features/synth/model/use-synth-engine.ts` | 60 | v5: reduced from 100 LOC — now a thin React wrapper around `AudioEngine`. Creates/disposes the engine on mount/unmount. Exposes engine ref for direct WS routing. |
| 21 | NEW | `src/client/features/synth/ui/Keyboard.tsx` | 120 | |
| 22 | NEW | `src/client/features/synth/index.ts` | 5 | |
| 23 | NEW | `src/client/features/visualizer/ui/Visualizer.tsx` | 80 | v5: reads from `noteBufferRef.current` via `requestAnimationFrame` loop — not React state. Canvas-based rendering. |
| 24 | NEW | `src/client/features/visualizer/index.ts` | 5 | |
| | | **Total** | **~1,340** | +120 LOC from v4 (new `clock-sync.ts` + `audio-engine.ts` + expanded `jam-room.ts`) |

Agent SDK (`src/agent-sdk/index.ts`, ~80 LOC) deferred to Phase 1b after core room works.

### 9d: Pre-Execution Prerequisites

- [ ] Create `feat/web-daw-jam-room` branch
- [ ] Scaffold Vite + React project with `npx create-vite`
- [ ] Install: `tone`, `zod`, `hono` (for future API routes)
- [ ] Configure `wrangler.jsonc` with DO binding
- [ ] Verify `npx wrangler dev` works with DO locally

### 9e: End-Result Vision

**What you CAN do after Phase 1**:
- Open `https://jam-room.example.com/room/my-room` in two browser tabs
- Play notes on a virtual keyboard (or MIDI controller) — hear them in both tabs
- See a peer list showing who's connected with color-coded note attribution
- Change BPM/key — all peers sync instantly
- See a real-time waveform visualizer driven by the audio output
- Experience tight rhythmic sync thanks to SNTP clock anchoring
- No audio glitches even at high note density thanks to React-decoupled AudioEngine
- Notes properly cleaned up when a peer disconnects (no hanging drones)

**What's explicitly DEFERRED**:
- Agent SDK (Phase 1b — after core room proven)
- LLM Agent Measure Aggregation (Phase 1b — `measure_complete` event bundling for Foundation Models. The DO emits a JSON bundle of all notes at the end of each measure, allowing LLMs to receive bounded context windows instead of a real-time firehose. LLM agents can sit dormant, receive the measure summary, take 2 seconds to "think", and schedule their response to drop at the start of Measure N+2.)
- Multi-instrument selection
- Step sequencer / pattern recording
- AI composition endpoint
- Room persistence / lobby
- Authentication

**What DOESN'T change**: No existing projects affected. Greenfield workspace.

---

## Phase 10: Production-Audio Grade Mitigations (Expert Critique Summary) 🔥

> [!NOTE]
> These mitigations were identified via expert-level audio engineering review and address physical constraints in distributed real-time audio that are invisible in standard web architectures. Each has been folded into the relevant phase above. This section serves as a cross-reference summary.

### 🔴 Critical (Must implement before first playable build)

| # | Dragon | Root Cause | Mitigation | Integrated In |
|---|--------|-----------|------------|---------------|
| 1 | **Clock Skew Math Ignores RTT** | Naive `serverTime - localTime` offset ignores 20-80ms network delay. Also, `Date.now()` and `Tone.now()` drift apart at ~1ms/min. | SNTP ping-pong handshake with `TrueOffset = ((t1 - t0) + (t2 - t3)) / 2`. All audio scheduling anchored to `Tone.now()`, never `Date.now()`. | Phase 2 #1, Phase 4, Phase 6, new file `clock-sync.ts` |
| 2 | **React Main Thread Starvation** | 50-100 WS events/sec in React state → constant reconciliation → GC spikes → Tone.js glitches | Vanilla TS `AudioEngine` class handles audio hot path. React only handles cold-path UI. Visualizer reads from `useRef` via `requestAnimationFrame`. | Phase 2 #6, Phase 4, Phase 6, new file `audio-engine.ts` |

### 🟡 Important (Implement during Phase 1)

| # | Dragon | Root Cause | Mitigation | Integrated In |
|---|--------|-----------|------------|---------------|
| 3 | **DO Serialization Thrashing** | 100+ `JSON.parse()` + SQLite inserts/sec blocks DO event loop → WS relay stutters | String-match note events for raw relay (no parse). Batch persist to SQLite every 5s. | Phase 2 #7, Phase 4, Phase 5, `jam-room.ts` |
| 4 | **Live Input Playout Delay** | Human `note_on` at Beat 4.0 arrives 40ms late at remote peers → played in the past | Hybrid delay: instant local playback + broadcast at `Tone.now() + playoutDelay`. | Phase 2 #8, `audio-engine.ts` |

### 🟢 Important (Straightforward additions)

| # | Dragon | Root Cause | Mitigation | Integrated In |
|---|--------|-----------|------------|---------------|
| 5 | **Hanging Notes / MIDI Panic** | `note_on` without `note_off` due to disconnect → infinite drone | DO tracks `activeNotes` per peer. `webSocketClose` broadcasts fabricated `note_off`. | Phase 2 #9, Phase 6, `jam-room.ts` |
| 6 | **LLM Agent Firehose** | Foundation Models can't process continuous 150-byte frames — need bounded context windows | `measure_complete` event bundles all notes at measure end. LLMs receive, think, respond 2 measures later. | Phase 9e (deferred to Phase 1b) |

---

## Verification Plan

**Automated**: Vitest for protocol Zod schemas + DO unit tests (`@cloudflare/vitest-pool-workers`). Cypress for two-client WebSocket relay + frontend audio playback.

**Clock Sync Verification** (v5): Unit test `clock-sync.ts` with mocked latencies (10ms, 50ms, 100ms) — verify `TrueOffset` calculation accuracy within 5ms.

**Audio Decoupling Verification** (v5): Stress test with 100 synthetic WS events/sec — verify zero React re-renders on note events, zero Tone.js glitches over 60 seconds.

**MIDI Panic Verification** (v5): Simulate peer disconnect with active notes — verify `note_off` broadcast within 100ms and no hanging audio.

**DO Hot-Path Verification** (v5): Load test with 10 synthetic peers × 10 notes/sec — verify WS relay latency stays <10ms p95, SQLite batch flush occurs every ~5s.

**Manual**: Two-tab jam test, latency feel test, BPM change propagation.

**Canary**: WS success rate >99%, note round-trip <150ms p95, SNTP sync accuracy <10ms, zero 5xx for 30 min.

---

## Checklist Before Code

- [x] Phase 2: 9 criticisms found and addressed (v5: expanded from 5 to 9)
- [x] Phase 3: Trade-off matrices for transport, state manager, synth engine, clock sync, audio architecture (v5: added 2 new matrices)
- [x] Phase 4: Hard limits for DO, Workers, Tone.js, Web Audio, WebSocket, React main thread, audio clock drift (v5: expanded)
- [x] Phase 5: UI data access defined (single WebSocket, no DB queries) + data flow architecture (v5: hot-path/cold-path diagram)
- [x] Phase 6: Failure mode table for 11 components (v5: expanded from 7 to 11)
- [x] Phase 7: Rollback plan (git revert, no DB migrations) + expanded canary criteria (v5)
- [x] Phase 8: ADR written with v5 trade-offs (playout delay, two-layer client, hot-path routing)
- [x] Phase 9a: Cross-system validation — no conflicts
- [x] Phase 9b: Compliance audit — all rules pass (v5: added 4 new audit items)
- [x] Phase 9c: File inventory — 24 files tracked (v5: +2 from v4)
- [x] Phase 9d: Prerequisites identified
- [x] Phase 9e: End-result vision documented with v5 capabilities + deferred LLM measure aggregation
- [x] Phase 10: Production-audio grade mitigations — 6 hidden dragons identified, all integrated
