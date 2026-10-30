# SCREEN spec: the session panel Task 12 draws

Card `t_0c1e3366` (`plan:94001bdcfe09a08b:screen`), designer, 2026-10-31.
Plan: `.hermes/plans/2026-10-31_011630-jam-band-and-audit.md` (sha16 `94001bdcfe09a08b`, **unmodified by this card**).
Artifact: `.hermes/plans/artifacts/2026-10-30-jam-session-summary.html`, 4451 bytes, md5 `9a16cd9783e6ac563f5d474efd786f00` (unmodified by this card).
Downstream card: `t_09c2f561` (Task 12), whose body says "the five states the artifact draws" and names none of them.
Method: `python3 ~/.hermes/profiles/designer/cache/scratch/screen_check.py <artifact> --plan <plan> --repo . --mutate`.

**Verdict: the state names agree in both directions, five for five. The drawn CONTENT disagrees in
two places, and the panel's numbers are in the wrong unit for the label they carry. Task 12 has a
deterministic rule to implement below; it does not have to invent one.**

## 1. The five states, read out of the page and out of the plan

State keys come from the artifact's own `<section data-state="...">` attributes, never from the plan's
table, so the check counts the page it was pointed at.

| key | drawn heading (the words on the card) | chips drawn | row in the plan's screen table |
|---|---|---|---|
| `empty` | state: empty | 0 | "no session yet, one sentence and no chart" |
| `one` | state: one agent, short session | 8 | "one agent, model bars, rests, quiet bars, p50 and worst render" |
| `many` | state: three agents, long session | 10 | "three agents and a long session, the same numbers plus the bar strip" |
| `error` | state: a render failed | 6 | "a render failed, the reason printed, the failed bars marked" |
| `signed out` | state: signed out | 0 | "public tier, the panel states there is no decision layer instead of drawing an empty chart" |

Agreement, direction 1 (drawn with no row behind it): none at the level of state names.
Agreement, direction 2 (a row with nothing drawn): none at the level of state names.

The mutation check ran on a scratch copy, dropping each section in turn:

```
  dropped 'empty':      scratch draws 4 -> missing ['empty']
  dropped 'one':        scratch draws 4 -> missing ['one']
  dropped 'many':       scratch draws 4 -> missing ['many']
  dropped 'error':      scratch draws 4 -> missing ['error']
  dropped 'signed out': scratch draws 4 -> missing ['signed out']
 mutation check ok: every deleted state is named missing
```

A checker that counted the plan's table would report five on a four-state artifact. This one reports
the missing key each time, so the five it prints above are the page's five.

### The two content findings

**C1. `one` draws a bar strip its row does not promise (drawn with no row behind it).**
The artifact draws 8 chips in `one`; the plan's `one` row lists four numbers and no strip. Two of the
five states are drawn differently by the artifact than the table describes, and this is the one the
story card named as "one screen-table delta". Correction is in section 7.

**C2. `many` adds to 97 against its own denominator of 87.**
50 + 12 + 35 = 97, printed beside "50 of 87". The plan's only measured 45 s run at 160 BPM is
38 + 12 + 35 + 2 = 87, which reconciles exactly. The artifact raised the model count from 38 to 50 and
dropped the two fallback records, so its central number is one no session can produce. Task 12 must
not copy it: the numbers to print are in section 4.

The `error` state sums to 11 against 25, and that is not a defect: it prints two of the four additive
classes (model records and failures) and is a deliberate partial view. The checker reports it as a
partial row set and does not hold it against the panel.

## 2. The rule that picks a state, so Task 12 needs no invention

The five drawn states mix three independent axes (`who`, `how much recorded`, `any failure`), which is
why a flat five-way switch cannot describe a signed-out listener whose render failed (the story card's
F1). The panel is decided in this order, tier first:

| order | key | condition, all read off the recorder and the page's `whoami` | rows drawn |
|---|---|---|---|
| 1 | `signed out` | `signedIn === false` | no value rows; one sentence on what still plays (section 7, C4) |
| 2 | `empty` | `sessionSnapshot().bars.length === 0` | no rows, no chart, one sentence with the next action |
| 3 | `error` | `bars.filter(b => b.error).length >= 1` | the model/rest/quiet rows, the failed-renders row, the reason, plus the strip with the failed bars marked |
| 4 | `many` | distinct `bars[].agent` >= 2 | model/rest/quiet rows, latency, the strip, the agent names |
| 5 | `one` | distinct `bars[].agent === 1` | model/rest/quiet rows, latency, the strip, the agent name |

Consequences an implementer must not skip:

- `error` outranks `one` and `many`, so a failed render cannot hide behind a clean populated card
  (story F4). It must still print the agent names it knows, so a failure does not erase the band.
- `signed out` outranks everything, which is the one place this rule loses information: a guest who
  heard a session gets no numbers. Section 7 C4 puts one conditional line inside the signed-out panel
  instead of a sixth state, and it is the cheapest fix that keeps the five.
- The panel is a retrospective card. Its title is "Last session" in all five states and it must stay
  retrospective: the plan's "never falls silent for more than one bar" is a live property this panel
  cannot show (story F5), and adding a live indicator here is a sixth state by another name. If he
  wants that, it is its own card.

## 3. Where the panel sits, measured from the page's own JSX

`src/client/pages/JamRoom.tsx`, read for the order of its top-level blocks:

```
  line  245 <TransportBar
  line  282 <Visualizer
  line  285 <Keyboard
  line  294 <MetricsPanel
  line  300 <AiDebugPanel
```

**Region: below the transport controls, at the page foot, as a full-width sibling after
`<AiDebugPanel>` (line 300), not inside `.jam-room__main` and not in the sidebar.** It takes the
`who` prop the page already holds (`JamRoom.tsx:29`), the same one `AiDebugPanel` receives
(`JamRoom.tsx:302`).

Why there: the top of the page is the live surface (transport, visualiser, keyboard) and a listener
must not scroll past a retrospective card to reach it; the panel belongs with the other
after-the-fact card, `AiDebugPanel`, which already reads the same message stream.

**The risk this placement carries, named once:** a render that falls back during the session is
invisible until the listener looks at the foot of the page. The plan's listener failure row says "the
panel names the failure in the same line", and at the foot it does so only after he scrolls. Keeping
the panel retrospective is the reason: a failure badge that appears mid-session is a live indicator
and belongs to the F5 question, not to a placement change. If he asks for it, the badge goes in the
`TransportBar`'s status slot (`JamRoom.tsx:247`), not into this panel.

## 4. Which recorder field feeds each number

Every row the artifact prints, and the field in
`src/client/features/room/lib/session-recorder.ts` that carries it. The anchors were checked in the
file, not remembered:

| on the panel | derivation | recorder field | anchor in source |
|---|---|---|---|
| `Model bars n of m` | count `source === 'llm'`; m = `bars.length` | `bars[].source` | `source: agentMeta.source` (line 114) |
| `Rests` | count `source === 'rest'` | `bars[].source` | same projection; values set at `llm-planner.ts:377` |
| `Quiet bars (generator)` | count `source === 'pattern'` | `bars[].source` | `llm-planner.ts:390` |
| `Failed renders` | count `bars[].error` truthy | `bars[].error` | `error: agentMeta.error` (line 125) |
| `Reason` | the `error` string of the latest such record | `bars[].error` | same |
| `Render p50 / worst` | median and max of `latencyMs` where `source === 'llm'` | `bars[].latencyMs` | `latencyMs: agentMeta.latencyMs` (line 116) |
| tag "45 s at 160 BPM" | `recordedMs`, `bpm` | `SessionFile.recordedMs`, `.bpm` | `recordedMs: meta.recordedFrom` (line 135), `bpm: roomState.bpm` (line 54) |
| agent names / lanes | distinct `bars[].agent` | `bars[].agent` | `agent: m.data.agentName` (line 113) |

Three traps in that table, each measured in the file:

1. **The projection is a whitelist and drops what it does not name.** `sessionSnapshot()` builds each
   bar row field by field (lines 111 to 126). Task 13's stride badge needs `stride` from
   `agentMeta`, and Task 13's card does not modify `session-recorder.ts`, so unless the projection
   gains `stride: agentMeta.stride ?? null` the badge reads `undefined` and every test that only
   asserts a badge exists still passes. Same for the trade pair if Task 9's `role` is extended.
2. **Records are not bars.** One room bar carries one record per agent, so 87 records is 30 room bars
   at 160 BPM (`240000 / bpm` ms per bar, `tools/probe-session.mjs:138`). The `one` state is coherent
   because one agent makes one record per bar; the `many` state silently changes unit under the same
   label. Section 7 C3 names the unit in the plan; the row label carries the unit either way.
3. **The recorder has no change event.** `messages` is a module-level array with no subscription;
   `recordedCount()` is a plain read. If the panel calls `sessionSnapshot()` in a render triggered
   only by mount, it draws the empty state forever and the artifact's own promise ("this panel fills
   at the bar line") is false. The trigger must come from the socket: `useRoomSocket` already calls
   `recordMessage` per message (`use-room-socket.ts:123`) and `beginSession` once per room
   (`use-room-socket.ts:142`), so the cheapest honest trigger is the page's `aiDebugEntries` (which
   changes on every `ai_debug`) or a small counter on the same message path.

## 5. The numbers Task 12 must print for the measured night

The plan's Claims row 1, in the unit the recorder actually counts:

```
agent-bar records   87        room bars 30        (45 s at 160 BPM, 1500 ms per bar)
model 'llm'         38        rest 12   quiet 'pattern' 35   fallback 2
identity            38 + 12 + 35 + 2 = 87   -> reconciles
latency             838 ms median, 2067 ms worst
```

So the measured night, under section 2's rule, draws as `error` (two records carry an `error`) and
reads `Model bars 38 of 87`, `Rests 12`, `Quiet bars (generator) 35`, `Failed renders 2`,
`Render p50 / worst 838 / 2067 ms`, with the head tag naming both units:
`45 s at 160 BPM, 30 room bars`. A clean three-agent session draws as `many` with the same rows minus
the failure pair. The artifact's `50 of 87` is a placeholder that cannot reconcile; do not copy it.

## 6. Markup and the sheet, kept off the network

Rule 4 of the card: inline styles only, the estate's theme variables, no sheet loaded from a URL. The
artifact complies: one `<style>` block, `sheets: ['inline']` measured in the browser, zero
`src=`/`href=` URLs, no `<script>`.

Measured on the artifact in a browser (1280 and a forced 390 CSS px viewport):

```
1280  innerWidth 1280  body scrollWidth 1280  panel 554 x 262 (one), 554 x 279 (many)   sideways spill 0
 390  innerWidth  390  body scrollWidth  390  panel 390 wide, strip 356 wide            sideways spill 0
```

The artifact carries **no `<meta name="viewport">`** (0 occurrences), which is correct for a drawing
and wrong for a page: a real phone lays it out at the browser's 980 px default, which is how the first
measurement read `innerWidth 980` on a 390 device. Task 12's panel lives inside the app's own layout,
so it inherits the app's viewport tag; nobody should paste the artifact's `<head>` into the app.

Tokens the panel takes, from the app's own sheet (`src/client/index.css`), not from the artifact's
`var(--x, fallback)` defaults: `--bg-surface` for the card fill (the artifact's `#141416` is a
near-match of `#161628`, close enough that a copy of the fallback would look right and be wrong),
`--border`, `--text-secondary` for the keys, `--text-primary` for the values, `--radius-md` (10px),
`--font-mono` (`--font-data` in the estate's words) for **every number**: counts, ms, seconds, BPM.

Two corrections inside the artifact's treatment that Task 12 applies on the way in:

- **The strip cannot signal by colour alone.** The artifact's chips are `<i>` with no text, no
  `title`, no legend (story F8), and the app already maps four sources to four accent colours in
  `AiDebugPanel.tsx:58-61` (emerald, amber, indigo, rose). Reuse that map rather than inventing a
  fifth palette, give every chip a `title` naming its bar and source, and print a one-line legend.
  A chip is a mark, not a pointer target, so the 24x24 floor (WCAG 2.5.8) does not apply to it; what
  applies is that colour alone carries no information.
- **The `.tag` is all caps with `.08em` tracking.** Sentence case in the panel, because the same
  uppercase treatment appears on every card in the estate's generated pages and reads as a template
  tell, not as a decision for this room. The tag's job is to state the session's length and tempo,
  which it already does in words.

`--ok`, `--warn` and `--alert` keep their meaning: only `--alert` appears here, on the failure row and
the failed chips, because a failure is a state. Rests and quiet bars are not states, they are sources,
so they take neutrals or the source map, never amber-as-warning.

## 7. Corrections to the plan's screen section (dated note, the plan is not edited)

Recorded here for the next edit of the plan, since this card may not touch the plan's bytes (its sha16
is pinned on every downstream card):

- **C1** `one` row gains the strip: "one agent, model bars, rests, quiet bars, p50 and worst render,
  plus the bar strip". The artifact already draws it.
- **C2** `many` row states the failure row explicitly: "the same numbers plus the bar strip, and the
  failed-renders row whenever a render fell back in that session". As drawn, a session with two
  fallbacks reads clean.
- **C3** one sentence under the table, naming the unit: "Model bars counts agent-bar records; one
  room bar carries one record per agent, so 87 records at 160 BPM is 30 room bars." Without it, the
  table and Task 12 can both be right and disagree.
- **C4** `signed out` row gains what still plays: "public tier, the panel says there is no decision
  layer and that the drummer and bass still carry the bar". The story card's F7 is the same finding
  from the other side: the drawn note names only the absence.
- **C5** the section names the region: "below the transport controls, at the page foot after the AI
  debug panel". The table says what each state shows and never where the panel sits.

## 8. Open items, each needing his yes or no

**OPEN-1, the guest's failure cell (story F1).** Recommended: no sixth state. `signed out` gains one
conditional line, "a render fell back, the drummer and bass carried the bar", printed only when
`bars` carries an error. The five states stand, Task 12's acceptance does not change, and the story's
guest failure cell gets a place. Undo: delete the line. The alternative, a sixth drawn state, widens
both this artifact and Task 12 and needs its own row in the plan.

**OPEN-2, the unit (story F2).** Recommended: count agent-bar records, and say so on the row (section
7 C3), because the recorder only holds records and the per-agent attribution is what the `one`/`many`
split and Task 13's stride badge need. Undo: count room bars, where a bar "carries a model line" if
any agent record in it is `llm`, which yields at most 30 at 160 BPM and loses per-agent attribution.

## 9. Acceptance for Task 12, exactly these five

`npx vitest run src/client` green with a case per key, and no state outside this list:

1. `empty`: `bars.length === 0`, no value rows, no chips, one sentence naming the next action.
2. `one`: one distinct agent, model/rest/quiet rows, latency, strip, the agent's name.
3. `many`: two or more distinct agents, the same rows, the strip, every agent named.
4. `error`: at least one record with `error`, the failure count and the reason printed verbatim from
   `bars[].error`, the failed bars marked on the strip, the agent names kept.
5. `signed out`: `signedIn === false`, no value rows, one sentence on what still plays (OPEN-1's
   conditional failure line if he says yes).

Task 12 must not add: a sixth state, a live silence indicator, a rating control, or a second palette
for the strip. Its own mutation (return the empty state always) still catches a panel that never
reads the recorder.

## 10. Run

```
$ python3 ~/.hermes/profiles/designer/cache/scratch/screen_check.py \
    .hermes/plans/artifacts/2026-10-30-jam-session-summary.html \
    --plan .hermes/plans/2026-10-31_011630-jam-band-and-audit.md --repo . --mutate
ARTIFACT 2026-10-30-jam-session-summary.html: 4451 bytes
STATES THE ARTIFACT DRAWS (5):
  - 'empty'        heading 'state: empty'  chips 0
  - 'one'          heading 'state: one agent, short session'  chips 8
  - 'many'         heading 'state: three agents, long session'  chips 10
  - 'error'        heading 'state: a render failed'  chips 6
  - 'signed out'   heading 'state: signed out'  chips 0
STATES THE PLAN'S SCREEN TABLE NAMES (5): empty, one, many, error, signed out
 mutation check ok: every deleted state is named missing
2 finding(s)
FINDING DRAWN WITH NO ROW BEHIND IT: 'one' draws 8 bar chips and its screen row promises no strip
FINDING ARITHMETIC: 'many' adds to 97 against its own denominator 87
```

The checker exits 1 on those two findings, both of which are the artifact's; they are this card's
deliverable, not a failure of it. The gate the card names is the next command, and it passes.

```
$ python3 ~/.hermes/skills/software-development/plan/scripts/verify_screen_artifact.py \
    .hermes/plans/artifacts/2026-10-30-jam-session-summary.html --repo . --must "Model bars" --no-git
artifact 2026-10-30-jam-session-summary.html: 4451 bytes, sha256 777ca64f82fd, states drawn ['empty', 'one', 'many', 'error', 'signed out']
PASS (ad-hoc: structure, state coverage and git identity, never whether a person likes the page)
```

## 11. What this card did not do

The artifact is unedited. The plan is unedited, and its sha16 still reads `94001bdcfe09a08b`. No
product code was written. Task 12's card body is unedited; it carries a comment pointing here, because
this card may not add an enumeration to a body it does not own.
