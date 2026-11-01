/**
 * DOES THE AGENT HEAR THE BAND? Join a room, turn the rhythm section on, spawn one signed agent, and
 * print the "They are playing" line of every prompt the room sends it.
 *
 *   node tools/band-check.mjs [--seconds 45] [--bpm 130]
 */
const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};
const seconds = Number(arg('seconds', 45));
const bpm = Number(arg('bpm', 130));
const room = arg('room', `band-${Math.random().toString(36).slice(2, 8)}`);

const { default: WebSocket } = await import('ws');
const ws = new WebSocket(`wss://zpe.vc/jam/api/room/${room}/ws`);
const metas = [];

await new Promise((resolve, reject) => {
  ws.on('open', () => {
    ws.send(JSON.stringify({ type: 'join_room', name: 'BandProbe', kind: 'human' }));
    setTimeout(() => {
      ws.send(JSON.stringify({ type: 'set_bpm', bpm }));
      ws.send(JSON.stringify({ type: 'set_backing', drummer: true, bass: true }));
      setTimeout(() => {
        ws.send(JSON.stringify({ type: 'spawn_agent', name: 'Funk Bot', style: 'funk' }));
      }, 400);
    }, 300);
    setTimeout(() => { try { ws.close(); } catch { /* closed */ } resolve(); }, (seconds + 2) * 1000);
  });
  ws.on('message', (raw) => {
    let m; try { m = JSON.parse(String(raw)); } catch { return; }
    if (m.type === 'ai_debug' && m.meta?.prompt) metas.push(m.meta);
  });
  ws.on('error', reject);
  setTimeout(resolve, (seconds + 12) * 1000);
});

const line = (meta) => (meta.prompt.split('\n').find(l => l.startsWith('They are playing')) ?? '(no line)');
const silent = metas.filter(m => line(m).includes('the room is silent')).length;

console.log(`room ${room}  bpm ${bpm}  ai_debug metas ${metas.length}`);
for (const [i, m] of metas.entries()) {
  console.log(`  ${String(i).padStart(2)} ${(m.source ?? '?').padEnd(8)} role ${(m.brief?.role ?? '-').padEnd(7)} notes ${String(m.noteCount ?? 0).padStart(2)}  ${line(m).slice(0, 96)}`);
}
console.log(`\n  prompts told the agent the room was SILENT: ${silent} of ${metas.length}`);
console.log(silent > metas.length / 2
  ? '  RESULT: the agent still cannot hear the section'
  : '  RESULT: the agent hears what is playing under it');
