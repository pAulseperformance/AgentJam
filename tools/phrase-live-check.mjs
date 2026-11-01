/**
 * IS THE PHRASE ASK REAL ON THE WIRE? Join a room as a peer, turn the setting on, spawn one agent, and
 * read what the room publishes: how many bars arrived, and how many of them were paid for with a model
 * call. With the setting on, three of every four bars answer `calls: 0`, because one call wrote them.
 *
 *   node tools/phrase-live-check.mjs [--seconds 45] [--bpm 140]
 */
const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};
const seconds = Number(arg('seconds', 45));
const bpm = Number(arg('bpm', 140));
const room = arg('room', `phrase-${Math.random().toString(36).slice(2, 8)}`);

const { default: WebSocket } = await import('ws');
const ws = new WebSocket(`wss://zpe.vc/jam/api/room/${room}/ws`);

const bars = [];
const debug = [];
const notes = [];
let phraseAsked = false;

await new Promise((resolve, reject) => {
  ws.on('open', () => {
    ws.send(JSON.stringify({ type: 'join_room', name: 'PhraseProbe', kind: 'human' }));
    setTimeout(() => {
      ws.send(JSON.stringify({ type: 'set_bpm', bpm }));
      setTimeout(() => {
        ws.send(JSON.stringify({ type: 'set_phrase_ask', enabled: true }));
        setTimeout(() => {
          ws.send(JSON.stringify({ type: 'spawn_agent', name: 'Phrase Bot', style: 'jazz' }));
          phraseAsked = true;
        }, 300);
      }, 300);
    }, 300);
    setTimeout(() => { try { ws.close(); } catch { /* closed */ } resolve(); }, (seconds + 3) * 1000);
  });
  ws.on('message', (raw) => {
    let m;
    try { m = JSON.parse(String(raw)); } catch { return; }
    if (m.type === 'bar') bars.push(m);
    if (m.type === 'ai_debug') debug.push(m.meta ?? {});
    if (m.type === 'note' && m.kind === 'on') notes.push({ t: m.at ?? Date.now(), pitch: m.pitch, beatTime: m.beatTime, peerId: m.peerId });
  });
  ws.on('error', reject);
  setTimeout(resolve, (seconds + 12) * 1000);
});

const withCall = debug.filter((m) => (m.calls ?? 0) > 0);
const without = debug.filter((m) => (m.calls ?? 0) === 0);
const positions = debug.map((m) => m.position);

console.log(`room ${room}  bpm ${bpm}  seconds ${seconds}  phraseAsk sent: ${phraseAsked}`);
console.log(`  bars published:        ${bars.length}`);
console.log(`  ai_debug metas:        ${debug.length}`);
console.log(`  paid for (calls > 0):  ${withCall.length}`);
console.log(`  queued free (calls 0): ${without.length}`);
console.log(`  positions seen:        ${positions.length ? positions.join(' ') : '(none)'}`);
console.log(`  phrases detected:      ${withCall.length} (a phrase = one call, four bars)`);
console.log(`  notes on the wire:     ${notes.length}`);
console.log(withCall.length > 0 && without.length >= withCall.length * 2
  ? '  RESULT: the phrase ask is running: most bars answer calls 0 from one call per phrase'
  : '  RESULT: NOT running as a phrase (most bars paid individually, or nothing published)');

if (debug[0]) {
  console.log(`  first meta: source ${debug[0].source} position ${debug[0].position ?? '?'} calls ${debug[0].calls} model ${debug[0].model ?? '?'} latency ${debug[0].latencyMs ?? '?'}ms notes ${debug[0].noteCount ?? '?'}`);
}
