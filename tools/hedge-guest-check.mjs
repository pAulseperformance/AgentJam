/**
 * Does a guest's set_hedge reach the live room? Connect the way a visitor does (no cookie), ask for
 * the spend switch, then read the room's own /health answer, which reports what it will actually spend.
 *
 *   node tools/hedge-guest-check.mjs [--room id]
 */
const args = process.argv.slice(2);
const at = args.indexOf('--room');
const room = at === -1 ? `guest-${Math.random().toString(36).slice(2, 10)}` : args[at + 1];
const BASE = 'https://zpe.vc/jam';
const WS = 'wss://zpe.vc/jam';

const { default: WebSocket } = await import('ws');

const health = async () => {
  const r = await fetch(`${BASE}/api/room/${room}/health`);
  return await r.json();
};

// A ROOM THAT HAS NEVER BEEN OPENED ANSWERS NOTHING: open it once so /health has a body.
const before = await health().catch(() => null);

const ws = new WebSocket(`${WS}/api/room/${room}/ws`);
const errors = [];
await new Promise((resolve, reject) => {
  ws.on('open', () => {
    ws.send(JSON.stringify({ type: 'join_room', name: 'Guest', kind: 'human' }));
    setTimeout(() => {
      ws.send(JSON.stringify({ type: 'set_hedge', enabled: true }));
      setTimeout(() => { ws.close(); resolve(); }, 700);
    }, 300);
  });
  ws.on('message', (raw) => {
    try { const m = JSON.parse(String(raw)); if (m.type === 'error') errors.push(m.message); } catch { /* binary */ }
  });
  ws.on('error', reject);
  setTimeout(resolve, 6000);
});

const after = await health();
console.log(`room ${room}`);
console.log(`  errors seen by the guest: ${errors.length ? errors.join(' | ') : '(none)'}`);
console.log(`  /health hedge before: ${JSON.stringify(before?.hedge)}   after: ${JSON.stringify(after?.hedge)}`);
console.log(after?.hedge === true ? '  RESULT: the guest turned it ON (the gate is not working)' : '  RESULT: the room kept it off');
