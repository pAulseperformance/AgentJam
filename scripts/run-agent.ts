#!/usr/bin/env npx tsx
/**
 * AgentJam AI Agent Runner
 *
 * A standalone AI musician that connects to a jam room and plays along.
 * Uses pattern-based generation (no LLM required) for instant jamming.
 *
 * Usage:
 *   npx tsx scripts/run-agent.ts                     # local dev
 *   npx tsx scripts/run-agent.ts --url wss://agent-jam.admin-1e3.workers.dev  # production
 *   npx tsx scripts/run-agent.ts --room my-room --name "Jazz Bot" --style jazz
 */

// ─── Config ──────────────────────────────────────────────────────────────────

const ARGS = parseArgs(process.argv.slice(2));

const CONFIG = {
  wsUrl: ARGS['url'] ?? `ws://localhost:8787`,
  roomId: ARGS['room'] ?? 'default-room',
  name: ARGS['name'] ?? 'AI Musician',
  style: (ARGS['style'] ?? 'jazz') as 'jazz' | 'ambient' | 'funk' | 'random',
  instrument: ARGS['instrument'] ?? 'PolySynth',
  verbose: ARGS['verbose'] === 'true',
};

const FULL_WS_URL = `${CONFIG.wsUrl}/api/room/${CONFIG.roomId}/ws`;

// ─── Music Theory ────────────────────────────────────────────────────────────

const SCALES: Record<string, number[]> = {
  'C major':  [0, 2, 4, 5, 7, 9, 11],
  'C minor':  [0, 2, 3, 5, 7, 8, 10],
  'D major':  [2, 4, 6, 7, 9, 11, 1],
  'D minor':  [2, 4, 5, 7, 9, 10, 0],
  'E major':  [4, 6, 8, 9, 11, 1, 3],
  'E minor':  [4, 6, 7, 9, 11, 0, 2],
  'F major':  [5, 7, 9, 10, 0, 2, 4],
  'G major':  [7, 9, 11, 0, 2, 4, 6],
  'A major':  [9, 11, 1, 2, 4, 6, 8],
  'A minor':  [9, 11, 0, 2, 4, 5, 7],
  'B major':  [11, 1, 3, 4, 6, 8, 10],
};

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

function midiToNoteName(midi: number): string {
  const octave = Math.floor(midi / 12) - 1;
  const noteIndex = midi % 12;
  return `${NOTE_NAMES[noteIndex]}${octave}`;
}

function getScaleNotes(key: string, octaveRange: [number, number] = [3, 5]): string[] {
  const intervals = SCALES[key] ?? SCALES['C major']!;
  const notes: string[] = [];
  for (let oct = octaveRange[0]; oct <= octaveRange[1]; oct++) {
    for (const interval of intervals) {
      const midi = (oct + 1) * 12 + interval;
      notes.push(midiToNoteName(midi));
    }
  }
  return notes;
}

// ─── Pattern Generators ──────────────────────────────────────────────────────

interface GeneratedNote {
  pitch: string;
  beatTime: number;
  velocity: number;
  duration: number;
}

function generateJazzPattern(scaleNotes: string[], _bpm: number): GeneratedNote[] {
  const notes: GeneratedNote[] = [];
  const numNotes = 4 + Math.floor(Math.random() * 8); // 4-12 notes

  for (let i = 0; i < numNotes; i++) {
    // Swing timing: offset every 2nd note slightly
    const baseTime = (i / numNotes) * 4;
    const swing = i % 2 === 1 ? 0.08 : 0;
    const beatTime = Math.round((baseTime + swing) * 4) / 4; // quantize to 16th

    notes.push({
      pitch: scaleNotes[Math.floor(Math.random() * scaleNotes.length)]!,
      beatTime: Math.min(beatTime, 3.75),
      velocity: 0.4 + Math.random() * 0.4,
      duration: 0.25 + Math.random() * 0.75,
    });
  }

  return notes;
}

function generateAmbientPattern(scaleNotes: string[], _bpm: number): GeneratedNote[] {
  const notes: GeneratedNote[] = [];
  const numNotes = 2 + Math.floor(Math.random() * 4); // 2-6 long notes

  for (let i = 0; i < numNotes; i++) {
    notes.push({
      pitch: scaleNotes[Math.floor(Math.random() * scaleNotes.length)]!,
      beatTime: Math.round(Math.random() * 3 * 4) / 4,
      velocity: 0.2 + Math.random() * 0.3,
      duration: 1.0 + Math.random() * 2.0, // long sustained notes
    });
  }

  return notes;
}

function generateFunkPattern(scaleNotes: string[], _bpm: number): GeneratedNote[] {
  const notes: GeneratedNote[] = [];
  // Funky 16th-note patterns with rests
  const pattern = [1, 0, 1, 1, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 0]; // funk groove

  for (let i = 0; i < 16; i++) {
    if (pattern[i]) {
      notes.push({
        pitch: scaleNotes[Math.floor(Math.random() * Math.min(5, scaleNotes.length))]!,
        beatTime: i * 0.25,
        velocity: i % 4 === 0 ? 0.8 : 0.5 + Math.random() * 0.2,
        duration: 0.125 + Math.random() * 0.125,
      });
    }
  }

  return notes;
}

function generateRandomPattern(scaleNotes: string[], _bpm: number): GeneratedNote[] {
  const notes: GeneratedNote[] = [];
  const numNotes = 3 + Math.floor(Math.random() * 10);

  for (let i = 0; i < numNotes; i++) {
    notes.push({
      pitch: scaleNotes[Math.floor(Math.random() * scaleNotes.length)]!,
      beatTime: Math.round(Math.random() * 15) / 4, // random 16th grid
      velocity: 0.3 + Math.random() * 0.5,
      duration: 0.125 + Math.random() * 1.0,
    });
  }

  return notes;
}

const GENERATORS: Record<string, typeof generateJazzPattern> = {
  jazz: generateJazzPattern,
  ambient: generateAmbientPattern,
  funk: generateFunkPattern,
  random: generateRandomPattern,
};

// ─── Agent Logic ─────────────────────────────────────────────────────────────

interface RoomState {
  bpm: number;
  key: string;
}

let ws: WebSocket | null = null;
let roomState: RoomState = { bpm: 120, key: 'C major' };
let peerId: string | null = null;
let connected = false;
let peerCount = 0;
let measureTimer: ReturnType<typeof setInterval> | null = null;
let measureCount = 0;

function log(msg: string): void {
  const ts = new Date().toISOString().slice(11, 23);
  console.log(`[${ts}] ${msg}`);
}

function connectToRoom(): void {
  log(`🔌 Connecting to ${FULL_WS_URL}...`);

  ws = new WebSocket(FULL_WS_URL);

  ws.onopen = () => {
    log('✅ WebSocket connected');

    // Send join message
    ws!.send(JSON.stringify({
      type: 'join_room',
      name: CONFIG.name,
      kind: 'agent',
      instrument: CONFIG.instrument,
    }));
  };

  ws.onmessage = (event: MessageEvent) => {
    const data = String(event.data);

    // Hot path: note events from other peers
    if (data.includes('"note_o')) {
      if (CONFIG.verbose) {
        try {
          const note = JSON.parse(data);
          log(`  🎵 ${note.peerId?.slice(0, 8)}: ${note.type} ${note.pitch}`);
        } catch { /* skip */ }
      }
      return;
    }

    // Cold path: parse server messages
    try {
      const msg = JSON.parse(data);
      handleServerMessage(msg);
    } catch {
      log(`⚠️  Failed to parse: ${data.slice(0, 60)}`);
    }
  };

  ws.onclose = (event) => {
    connected = false;
    stopMeasureTimer();
    log(`🔴 Disconnected (code: ${event.code}). Reconnecting in 3s...`);
    setTimeout(connectToRoom, 3000);
  };

  ws.onerror = () => {
    log('❌ WebSocket error');
  };
}

function handleServerMessage(msg: Record<string, unknown>): void {
  switch (msg['type']) {
    case 'room_state': {
      const rs = msg['roomState'] as RoomState;
      roomState = { bpm: rs.bpm, key: rs.key };
      const peers = msg['peers'] as Array<{ peerId: string; name: string; kind: string }>;
      peerCount = peers.length;

      // Find our peerId (we're the last joined agent)
      const me = peers.find(p => p.name === CONFIG.name && p.kind === 'agent');
      if (me) peerId = me.peerId;

      connected = true;
      log(`🎼 Room state: ${roomState.bpm} BPM, ${roomState.key}, ${peerCount} peers`);
      log(`🤖 I am: ${peerId?.slice(0, 8)} (${CONFIG.name})`);

      startMeasureTimer();
      break;
    }
    case 'peer_joined': {
      const peer = msg['peer'] as { name: string; kind: string };
      peerCount++;
      log(`👋 ${peer.name} (${peer.kind}) joined — ${peerCount} peers now`);
      break;
    }
    case 'peer_left': {
      peerCount--;
      log(`👋 Peer left — ${peerCount} peers now`);
      break;
    }
    case 'error':
      log(`❗ Server error: ${msg['message']}`);
      break;
  }
}

// ─── Measure Timer & Note Generation ─────────────────────────────────────────

function startMeasureTimer(): void {
  stopMeasureTimer();

  const measureDurationMs = (60 / roomState.bpm) * 4 * 1000;
  log(`⏱️  Measure duration: ${Math.round(measureDurationMs)}ms at ${roomState.bpm} BPM`);
  log(`🎨 Style: ${CONFIG.style}`);
  log(`🎹 Generating notes every measure...\n`);

  measureTimer = setInterval(() => {
    measureCount++;
    generateAndPlayMeasure();
  }, measureDurationMs);
}

function stopMeasureTimer(): void {
  if (measureTimer) {
    clearInterval(measureTimer);
    measureTimer = null;
  }
}

function generateAndPlayMeasure(): void {
  if (!ws || ws.readyState !== WebSocket.OPEN || !peerId) return;

  const scaleNotes = getScaleNotes(roomState.key);
  const generator = GENERATORS[CONFIG.style] ?? generateJazzPattern;
  const notes = generator(scaleNotes, roomState.bpm);

  const beatDurationMs = (60 / roomState.bpm) * 1000;

  log(`🎵 Measure ${measureCount}: ${notes.length} notes (${CONFIG.style})`);

  for (const note of notes) {
    const delayMs = note.beatTime * beatDurationMs;

    // Schedule note_on
    setTimeout(() => {
      if (!ws || ws.readyState !== WebSocket.OPEN) return;

      ws.send(JSON.stringify({
        type: 'note_on',
        peerId,
        pitch: note.pitch,
        beatTime: note.beatTime,
        velocity: note.velocity,
        timestamp: Date.now(),
      }));

      if (CONFIG.verbose) {
        log(`    → note_on  ${note.pitch} v${note.velocity.toFixed(2)} @beat ${note.beatTime}`);
      }
    }, delayMs);

    // Schedule note_off
    setTimeout(() => {
      if (!ws || ws.readyState !== WebSocket.OPEN) return;

      ws.send(JSON.stringify({
        type: 'note_off',
        peerId,
        pitch: note.pitch,
        beatTime: note.beatTime + note.duration,
        velocity: 0,
        timestamp: Date.now(),
      }));
    }, delayMs + note.duration * beatDurationMs);
  }
}

// ─── CLI Arg Parser ──────────────────────────────────────────────────────────

function parseArgs(args: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg?.startsWith('--')) {
      const key = arg.slice(2);
      const next = args[i + 1];
      result[key] = next && !next.startsWith('--') ? (i++, next) : 'true';
    }
  }
  return result;
}

// ─── Main ────────────────────────────────────────────────────────────────────

console.log(`
╔════════════════════════════════════════════╗
║        🤖 AgentJam AI Musician 🎵         ║
╠════════════════════════════════════════════╣
║  Name:       ${CONFIG.name.padEnd(28)}║
║  Room:       ${CONFIG.roomId.padEnd(28)}║
║  Style:      ${CONFIG.style.padEnd(28)}║
║  Target:     ${CONFIG.wsUrl.slice(0, 28).padEnd(28)}║
╚════════════════════════════════════════════╝
`);

connectToRoom();

// Graceful shutdown
process.on('SIGINT', () => {
  log('\n🛑 Shutting down gracefully...');
  stopMeasureTimer();
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.close();
  }
  process.exit(0);
});
