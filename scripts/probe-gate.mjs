#!/usr/bin/env node
/**
 * PROBE GATE. Two readings off one session file, and a floor on the first.
 *
 * A dead model path does not silence the room: the generator fills every bar, the queue stays fed,
 * the socket answers and the panel draws a session. So the surface readings in check.sh cannot see it,
 * and neither can a listener in the first bar. This gate reads what the room PUBLISHED:
 *
 *   model bars   the bars the model wrote, counted the way `tools/probe-session.mjs` counts them
 *                (`source: 'llm'`), held to a floor. Under the floor the room is not writing bars,
 *                it is filling them, and that is the defect no other reading catches.
 *   drum codes   prompts that name a drum pitch as a strong beat. The room's rhythm section is
 *                filtered out of what an agent is told about (`othersRecent`, jam-room.ts:1016), so a
 *                prompt naming a drum code means that filter stopped holding and the agents are
 *                answering the drummer instead of the people.
 *
 * WHY A FLOOR AND NOT A COUNT: the probe's numbers move run to run. Five runs of the identical
 * command (`--bpm 160 --seconds 45 --agents jazz,funk,ambient --backing 1`) wrote 66 to 74 model
 * bars on 2026-10-31, and the plan's own review measured 37 and 41 for the same command a day
 * earlier. An exact count in a gate fails on the second run; a floor under the low-water mark does
 * not. The floor lives in check.sh (`PROBE_FLOOR`) so raising it is one line in the same commit as
 * the evidence that the room's low-water mark rose.
 *
 * THE DRUM CODES COME FROM THE ROOM'S SOURCE, not from a copy: `src/server/groove.ts` exports DRUM
 * with the kick, snare, hat and tom pitches, and a fifth voice added there must reach this gate with
 * no second edit. If that export cannot be read, the gate fails rather than checking an empty set.
 *
 *   node scripts/probe-gate.mjs /tmp/jam-probe.json          the floor is 20
 *   node scripts/probe-gate.mjs file.json --floor 40         a higher floor
 *
 * Exit: 0 both readings made and both passed, 1 a reading failed, 2 the file or the drum codes could
 * not be read, 3 the floor held but this file records no prompt, so the drum reading was not made.
 */
import { readFileSync } from 'node:fs';

const FLOOR_DEFAULT = 20;
// A prompt field that is only a parenthetical is the room's own placeholder: pattern, cell and late
// bars record what they are (`"(pattern bar)"`) instead of the prompt they never sent. It is still a
// string the room published, so it counts in the same total the probe prints; `asked` names how many
// of those prompts were actually sent to a model, so an all-generator file carries that note on its
// line rather than reading as a room that was asked and answered nothing.
const PLACEHOLDER = /^\([^)]*\)$/;
const STRONG_BEATS = /strong beats: ([^;\n]*)/;

function synopsis(out) {
  out('usage: node scripts/probe-gate.mjs <session.json> [--floor <n>]');
}
function usage(why) {
  if (why) console.error(`probe-gate: ${why}`);
  synopsis(console.error);
  process.exit(2);
}

const args = process.argv.slice(2);
let file = null;
let floor = FLOOR_DEFAULT;
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--floor') {
    floor = Number(args[++i]);
    continue;
  }
  if (a === '-h' || a === '--help') { synopsis(console.log); process.exit(0); }
  if (a.startsWith('--')) usage(`unknown flag ${a}`);
  if (file) usage(`one session file, not two (${file} and ${a})`);
  file = a;
}
if (!file) usage('name a session file');
if (!Number.isInteger(floor) || floor < 1) usage(`--floor takes a positive whole number, not "${floor}"`);

let session;
try {
  session = JSON.parse(readFileSync(file, 'utf8'));
} catch (err) {
  console.error(`probe-gate: ${file} could not be read as a session file: ${err.message}`);
  process.exit(2);
}
if (!Array.isArray(session?.bars)) {
  console.error(`probe-gate: ${file} carries no bars array, so there is no session to gate`);
  process.exit(2);
}

/** The four drum pitches, read from the room's own export rather than copied into this file. */
function drumCodes() {
  let src;
  try {
    src = readFileSync(new URL('../src/server/groove.ts', import.meta.url), 'utf8');
  } catch (err) {
    console.error(`probe-gate: src/server/groove.ts could not be read: ${err.message}`);
    process.exit(2);
  }
  const block = /export const DRUM = \{([\s\S]*?)\} as const/.exec(src);
  const codes = block ? [...block[1].matchAll(/'([A-Ga-g][#b]?\d)'/g)].map(m => m[1]) : [];
  // THREE is the floor on the parse, not on the room: DRUM carries four voices today, so a block
  // this gate reads as fewer than three pitch codes means the export or the regex broke, not that a
  // voice was retired. An empty set would pass every file, so a partial read must fail instead.
  if (codes.length < 3) {
    console.error('probe-gate: src/server/groove.ts no longer exports DRUM with its pitch codes, so the drum reading cannot be made');
    process.exit(2);
  }
  return new Set(codes);
}

const bars = session.bars.filter(b => b && typeof b === 'object');
const count = (source) => bars.filter(b => b.source === source).length;
const modelBars = count('llm');
const fill = ['rest', 'cell', 'pattern', 'fallback', 'late']
  .map(s => `${s} ${count(s)}`)
  .join('  ');
// EVERY PROMPT STRING THE ROOM PUBLISHED, placeholders included: counted the way the probe counts
// them (`bars.map(b => b.prompt).filter(Boolean)`), so the gate's prompt total and the probe's agree
// on one file. `asked` is the subset that went to a model, and it only chooses the note on the line.
const promptStrings = bars.map(b => (typeof b.prompt === 'string' ? b.prompt.trim() : '')).filter(Boolean);
const asked = promptStrings.filter(p => !PLACEHOLDER.test(p));
const codes = drumCodes();

/** The drum codes a prompt names on its strong-beats line, or none. A prompt with no such line is a
 * room that was silent, not a prompt that named a drum: `describePhrase` writes `strong beats: ...`
 * only when somebody else's notes landed on a beat. */
function namedDrumCodes(prompt) {
  const m = STRONG_BEATS.exec(prompt);
  if (!m) return [];
  return m[1]
    .split(',')
    .map(p => p.trim())
    .filter(p => codes.has(p));
}
const hits = promptStrings.flatMap(namedDrumCodes);
const placeholderNote = asked.length ? '' : '  (every prompt is a placeholder: this room asked no model)';
const drumLine = promptStrings.length
  ? `prompts   ${promptStrings.length}  naming a drum code as a strong beat: ${hits.length}${placeholderNote}`
  : 'prompts   not measurable  this file records no prompt';

console.log(`probe     ${file}`);
console.log(`session   room ${session.room ?? '?'}  bpm ${session.bpm ?? '?'}  bar records ${bars.length}  ${fill}`);
console.log(`model bars ${modelBars} (floor ${floor})`);
console.log(drumLine);

let failed = false;
if (modelBars < floor) {
  failed = true;
  console.log(`          FAIL: ${modelBars} model bars against a floor of ${floor}. The room still plays when the` +
    ' model path dies');
  console.log('          (the generator fills every bar), so this is the reading that says whether the model is writing.');
}
if (hits.length) {
  failed = true;
  const example = [...new Set(hits)].slice(0, 4).join(', ');
  console.log(`          FAIL: ${hits.length} prompt(s) name a drum code as a strong beat (${example}): the rhythm` +
    ' section is reaching the agents\' ears');
}
if (failed) {
  const drum = promptStrings.length ? `${hits.length} drum code(s) named` : 'drum codes not measured (no prompt recorded)';
  console.log(`          ${modelBars} model bars, ${drum}: the gate refuses this session`);
  process.exit(1);
}
if (!promptStrings.length) {
  console.log('          not asserted: the floor held, and this file records no prompt, so nothing was read for drum codes');
  process.exit(3);
}
console.log(`          ok: ${modelBars} model bars at or above the floor of ${floor}, and no prompt names a drum code`);
