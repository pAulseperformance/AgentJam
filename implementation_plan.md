# Agent-First Web DAW Jam Room — v4 (Architecture-Planned)

A real-time collaborative music environment where **human musicians and AI agents are equal peers**, connected via WebSocket to a shared jam room. All communication is lightweight JSON note events ("Cloud MIDI") — no audio transmitted.

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
| 1 | **NTP Clock Skew** — `beat_time` depends on `Date.now()` which varies across peers. 50ms skew = audible timing error. | 🔴 High | Server includes its own `Date.now()` in `room_state`. Clients compute `clockOffset = serverTime - localTime` and adjust all `beat_time` calculations by this offset. |
| 2 | **DO is SPOF per room** — if DO crashes, all peers disconnect and in-memory state is lost. | 🟡 Medium | Clients auto-reconnect with exponential backoff. DO re-instantiates from persisted storage. `sequences` survive in `ctx.storage`. Transport state persisted on every mutation. |
| 3 | **No auth in MVP** — any peer can impersonate any `peer_id`, send garbage, or spam notes. | 🟡 Medium | Acceptable for MVP (prototype). Phase 2 adds Bearer token for agents + rate limiting (max 100 note events/sec per peer). Server assigns `peer_id` — clients cannot choose their own. |
| 4 | **Broadcast O(N)** — at 20 peers × 10 notes/sec = 200 msgs/sec, DO broadcasts 200 × 19 = 3,800 sends/sec. Single-thread blocks inbound processing during broadcast. | 🟡 Medium | DO soft limit is 1000 inbound req/s. Outbound `ws.send()` is not rate-limited. At 20 peers this is fine. At 50+, shard rooms into sub-rooms or use fan-out Worker. |
| 5 | **Patch consistency** — peers use different Tone.js versions or configurations, causing different sounds for same note events. | 🟢 Low | MVP uses one hardcoded PolySynth patch. Server broadcasts `patch_config` in `room_state`. Future: hash-verified patch distribution. |

---

## Phase 3: Trade-off Matrices 📊

### Real-Time Transport

| Criteria | WebSocket (via DO) | WebRTC Data Channel | Server-Sent Events |
|----------|-------------------|--------------------|--------------------|
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

---

## Phase 4: Constraints & Limits Audit 🚧

| Service | Hard Limit | Escape Hatch |
|---------|-----------|-------------|
| **DO: SQLite storage** | 10 GB per DO (paid), unlimited per account | More than enough — 10K events ≈ 1.5MB |
| **DO: KV key+value** | 2 MB combined (SQLite-backed) | Use SQL API instead for sequences |
| **DO: SQL row/blob** | 2 MB max per row | Each note event JSON ≈ 150 bytes |
| **DO: Inbound requests** | ~1000 req/s (20 WS msgs = 1 req) | Shard rooms at 50+ peers |
| **DO: WS message size** | 32 MiB max | Note events are ~150 bytes — no risk |
| **Worker: CPU time** | 30s paid / 10ms free | Note relay is sub-1ms |
| **Worker: Memory** | 128 MB | DO state is <1MB even with 10K events |
| **Tone.js: AudioContext** | 6 per page (browser) | We use 1 |
| **Web Audio: Latency** | ~128 samples minimum (~3ms at 44.1kHz) | Acceptable for music |
| **WebSocket: Free tier** | 100K requests/day | MVP usage << 100K |

> [!NOTE]
> **Storage clarified from official docs**: SQLite-backed DOs (new default) have **2 MB** key+value combined and **10 GB** SQLite storage per DO. The 128 KiB limit only applies to legacy KV-backed DOs. The 32 KiB figure previously cited was incorrect. We use `ctx.storage.sql` — no chunking needed.

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
sequences: NoteEvent[]  // ring buffer, persisted in SQLite table
```

**N+1 risk**: None. All data arrives via single WebSocket. No sub-queries.

---

## Phase 6: Failure Mode Analysis 💀

| Component | Failure Mode | User Impact | Mitigation | Recovery |
|-----------|-------------|-------------|-----------|----------|
| **DO instance** | Crash / eviction | All peers disconnect | Auto-reconnect with backoff | DO re-instantiates, loads state from storage |
| **WebSocket** | Network drop | Single peer loses connection | Client reconnect + re-hydrate from DO | Peer rejoins, gets `room_state` + `sequences` |
| **Tone.js** | AudioContext blocked | No sound | "Click to start" button (browser requirement) | User gesture triggers `Tone.start()` |
| **Agent** | Script crash | Agent stops playing, others unaffected | Agent-side reconnect logic | Agent rejoins room |
| **BPM change mid-playback** | Timeline drift | Notes play at wrong time | Recalculate `transportStartTime` | All peers receive corrected `room_state` |
| **Clock skew (NTP)** | `beat_time` drift between peers | Notes slightly out of sync | Server `clock_offset` correction | Peers adjust on every `room_state` sync |
| **Malicious peer** | Spam 1000 notes/sec | Room flooded | Server-side rate limit (100 events/sec/peer) | Excess events dropped, peer warned |

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
- Zero 5xx errors in Worker logs for 30 minutes post-deploy

---

## Phase 8: Architecture Decision Record

### Context
Building an agent-first collaborative music environment. Need real-time bidirectional communication between humans (browsers) and AI agents (headless scripts) with consistent state management and zero idle cost.

### Decision
Use **Cloudflare Durable Objects** with Hibernation WebSocket API as the central hub. Star topology with DO as state authority. JSON "Cloud MIDI" protocol with `beat_time` scheduling. **Tone.js** for client-side audio synthesis. No audio transmission.

### Trade-offs Accepted
- **Higher latency than WebRTC** (20-80ms vs 5-30ms) — acceptable because we're sending symbolic events, not audio. Lookahead scheduling absorbs jitter.
- **Single-thread bottleneck at scale** — DO caps around 50 active peers. Acceptable for MVP. Escape: shard into sub-rooms.
- **No preset ecosystem** — single hardcoded synth patch. Acceptable for prototype.

### Limits & Risks
- DO SQLite storage: 10GB per DO, 2MB per row — more than sufficient. No chunking needed.
- NTP clock skew → server-provided `clockOffset` correction
- No auth in MVP → server-assigned `peer_id`, rate limiting in Phase 2

### Alternatives Considered
- **WebRTC Data Channels**: Lower latency but mesh topology degrades at >8 peers and headless agents need full WebRTC stack. Rejected.
- **Upstash Redis**: External dependency, no native WebSocket, eventual consistency. Rejected.
- **Supabase Realtime**: Higher latency, Postgres overhead for ephemeral event relay. Rejected.

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
| 300 LOC limit | ✅ Pass | Largest file ~200 LOC (`jam-room.ts`) |
| TypeScript strict (no `any`) | ✅ Pass | All types defined in protocol |
| Zod at network boundary | ✅ Pass | All inbound WS messages validated |
| Conventional commits | ✅ Pass | Branch + PR workflow |
| PascalCase components, kebab-case files | ✅ Pass | Per file inventory |
| Unified Worker pattern | ✅ Pass | `wrangler.jsonc` with assets + DO |

### 9c: File Inventory (22 files)

| # | Action | Path | LOC |
|---|--------|------|-----|
| 1 | NEW | `package.json` | 35 |
| 2 | NEW | `tsconfig.json` | 20 |
| 3 | NEW | `wrangler.jsonc` | 20 |
| 4 | NEW | `vite.config.ts` | 25 |
| 5 | NEW | `src/shared/protocol/types.ts` | 90 |
| 6 | NEW | `src/shared/protocol/constants.ts` | 40 |
| 7 | NEW | `src/shared/protocol/index.ts` | 5 |
| 8 | NEW | `src/server/index.ts` | 25 |
| 9 | NEW | `src/server/jam-room.ts` | 200 |
| 10 | NEW | `src/server/env.ts` | 10 |
| 11 | NEW | `src/client/main.tsx` | 15 |
| 12 | NEW | `src/client/App.tsx` | 60 |
| 13 | NEW | `src/client/features/room/model/use-room-socket.ts` | 130 |
| 14 | NEW | `src/client/features/room/ui/JamRoom.tsx` | 100 |
| 15 | NEW | `src/client/features/room/ui/PeerList.tsx` | 50 |
| 16 | NEW | `src/client/features/room/ui/TransportBar.tsx` | 80 |
| 17 | NEW | `src/client/features/room/index.ts` | 5 |
| 18 | NEW | `src/client/features/synth/model/use-synth-engine.ts` | 100 |
| 19 | NEW | `src/client/features/synth/ui/Keyboard.tsx` | 120 |
| 20 | NEW | `src/client/features/synth/index.ts` | 5 |
| 21 | NEW | `src/client/features/visualizer/ui/Visualizer.tsx` | 80 |
| 22 | NEW | `src/client/features/visualizer/index.ts` | 5 |
| | | **Total** | **~1,220** |

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

**What's explicitly DEFERRED**:
- Agent SDK (Phase 1b — after core room proven)
- Multi-instrument selection
- Step sequencer / pattern recording
- AI composition endpoint
- Room persistence / lobby
- Authentication

**What DOESN'T change**: No existing projects affected. Greenfield workspace.

---

## Verification Plan

**Automated**: Vitest for protocol Zod schemas + DO unit tests (`@cloudflare/vitest-pool-workers`). Cypress for two-client WebSocket relay + frontend audio playback.

**Manual**: Two-tab jam test, latency feel test, BPM change propagation.

**Canary**: WS success rate >99%, note round-trip <150ms p95, zero 5xx for 30 min.

---

## Checklist Before Code

- [x] Phase 2: 5 criticisms found and addressed
- [x] Phase 3: Trade-off matrix for transport, state manager, synth engine
- [x] Phase 4: Hard limits for DO, Workers, Tone.js, Web Audio, WebSocket
- [x] Phase 5: UI data access defined (single WebSocket, no DB queries)
- [x] Phase 6: Failure mode table for 7 components
- [x] Phase 7: Rollback plan (git revert, no DB migrations)
- [x] Phase 8: ADR written
- [x] Phase 9a: Cross-system validation — no conflicts
- [x] Phase 9b: Compliance audit — all rules pass
- [x] Phase 9c: File inventory — 22 files tracked
- [x] Phase 9d: Prerequisites identified
- [x] Phase 9e: End-result vision documented
