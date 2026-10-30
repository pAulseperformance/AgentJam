# Story check: who walks in, and what they must see

Card `t_ce470719` (`plan:94001bdcfe09a08b:story`), designer, 2026-10-31.
Plan: `.hermes/plans/2026-10-31_011630-jam-band-and-audit.md` (sha16 `94001bdcfe09a08b`, unmodified by this card).
Artifact: `.hermes/plans/artifacts/2026-10-30-jam-session-summary.html`, 71 lines.
Method: `python3 ~/.hermes/profiles/designer/cache/scratch/story_check.py` parsed the plan's
`## The user story` and `## The screen` tables and the artifact's five `<section data-state>`
blocks, compared them cell by cell, and ran the card's mutation on a scratch copy of the plan.

**Verdict: story disagrees with the artifact in 8 named ways.** Two of them (F1, F2) block Task 12
before it draws anything, because the artifact is the spec Task 12 copies.

## The two roles, read out of the plan's story table

| Who | What they came to do | Worked state in the artifact | Failed state in the artifact |
|---|---|---|---|
| The listener (owner, signed in) | hear three agents trade phrases with a drummer under them, at the tempo he set | `one` and `many` (neither is labelled owner or signed in) | `error` (drawn, and it agrees that a fallback plays a code measure) |
| A guest (public tier, signed out) | join a room and hear it play without signing in | `signed out` (drawn) | **none**. The artifact has no state that is both signed out and failing |

## States each person meets

- The listener meets `empty` (nothing has played), `one` (one agent, short session), `many` (three
  agents, long session) and `error` (a render failed).
- A guest meets `empty` and `signed out`. A guest never meets `error`, because the only error state
  prints model bars, failed renders and a reason, and the artifact's own signed-out sentence says
  the public tier's bars carry "no rest and no role".
- The artifact draws 5 states and the screen section names the same 5: `empty, one, many, error,
  signed out`. The two rows need 6, counting the empty room.

## Findings

### F1. The guest's failure state does not exist (A, blocks Task 12)

The story gives each role a worked state and a failed state: four cells. The artifact draws four
non-empty states, and one of them, `error`, is the listener's. A guest who hears a failed render
meets no state that describes them: `signed out` is a clean-session card, `error` is an
owner-visible card.
Evidence: the artifact's `signed out` note is "Signed out, the band renders without the decision
layer, so bars carry no rest and no role. The summary says so instead of showing an empty chart."
The `error` state's three rows are `Model bars 9 of 25`, `Failed renders 2`, `Reason AI call
exceeded 1565ms`, which is exactly the set the signed-out note says the public tier cannot produce.
Why it matters: Task 12's objective is "the five states the artifact draws". Copied as written, the
guest's failure row has no implementation target and the story row is unimplementable. Task 12
needs either a sixth state (`signed out` + failure, drawing what a guest *can* know: the bar fell to
the drummer and bass, the room kept playing) or the story row's failure cell withdrawn. That is his
call, not the card's.

### F2. The panel's "Model bars x of y" counts agent slots under a room-bar label (A, blocks Task 12)

The artifact's `many` state reads `Model bars 50 of 87` with the tag `45 s at 160 BPM`. The probe's
own arithmetic (`tools/probe-session.mjs:138`, `bar ${240000 / bpm} ms`) puts a 160 BPM bar at
1,500 ms, so 45 seconds is 30 room bars, not 87. 87 is 3 agents x ~29 agent-bar records:
`tools/probe-session.mjs:119` counts `bars` per `(agent, t)`, and `report()` prints "bar records
${bars.length}". The `one` state is coherent because one agent makes one record per bar (25 records =
25 bars, 37.5 s, tag says 38 s). With three agents the same panel silently changes unit.
The same confusion sits in the plan itself: Claims row 1 calls "38 model bars, 12 rests, 35
generator bars and 2 fallbacks in 45 seconds" bars, and those 87 are agent-bar records too.
Why it matters: a listener in one room hears 30 bars, not 87, and the panel's headline number
(57 percent) is a percentage of slots he never counted. Task 12 must pick the unit out loud:
room bars (29 or 30, where a bar "carries a model line" if any agent's line landed) or per-agent
records (with the agent named). The story row's phrase "how many bars carry a model line" only
works in room-bar units.

### F3. The many state's numbers do not add up, and its model count contradicts the measured run (A)

`many`: 50 model + 12 rests + 35 quiet = 97 against its own denominator 87, off by 10.
The plan's only measured 45 s run at 160 BPM (Claims row 1) is 38 model + 12 rests + 35 generator +
2 fallbacks = 87. Two of the four numbers match the artifact exactly (12, 35), the model count is
raised from 38 to 50, and the 2 fallbacks are absent. The `one` state sums exactly (12 + 3 + 10 =
25).
Why it matters: the panel's central number is the one that does not reconcile, and its arithmetic
failure is invisible to a reader who does not add three rows.

### F4. The many state drops the failures, so the measured night reads clean (A)

The measured run had 2 fallbacks. The `many` state prints four rows and none of them is failures;
`error` is the only state with a failure row. So the session the plan measured, with two failed
renders, would draw as a clean panel at 50 of 87.
Why it matters: the plan's own promise in the listener failure row is "a bad model night reads as a
number rather than as a mystery". In this artifact a bad model night reads as nothing at all
unless every bar failed.

### F5. "Never falls silent for more than one bar" is not drawable from this panel (A)

The listener's success cell promises a live property of the room. The artifact is a retrospective
card: the title is "Last session", the empty state says the panel "fills at the bar line", and the
plan's Decision row says the summary is computed in the client from the recorder, i.e. from bars
already recorded. The artifact contains no occurrence of "silence", "live", or a present-tense
indicator (`0` for each in the presence count). No state draws the room as it is playing.
Why it matters: the story row's strongest success criterion cannot be verified on the screen at
all, so the OWNER STEP that checks it (Verification, owner step 1: "listen for two minutes") is the
only place it lives. Either the row drops that clause or Task 12's panel gains a live bar line and
the artifact a state that shows it. As drawn, a listener who wants to know the room did not go
silent has to listen, not look.

### F6. The trade and the stride are invisible (A for the counts, C for the reading)

The listener came to hear three agents trade phrases. The `many` state draws one combined strip of
10 chips with no per-agent lanes, no call or answer markers, and no role names; its note says only
"Jazz Bot, Funk Bot and Ambient Bot, each writing every 2 bars, with the drummer and bass under
them." The artifact contains `trade` 0 times, `answer` 0 times, `stride` 0 times, and `tempo
ceiling` 0 times. Task 13's stride badge and tempo ceiling marker appear in no state.
Why it matters: the one thing the listener came for is the one thing the panel cannot show. "Every
2 bars" is prose, not a badge, and a call-and-response pair is indistinguishable from two
independent writes in a single strip.

### F7. The signed-out panel names only the absence (A)

The guest's success cell says the drummer and bass still carry the bar. The `signed out` state says
nothing about what continues; its whole note is about what is missing. `drummer` and `bass` each
appear once in the artifact, both in the `many` state's note, neither in the signed-out state.
Why it matters: the guest's reassurance is that the room still plays. The panel as drawn leaves a
signed-out listener with three negatives and no statement that music is reaching him.

### F8. The bar strip is a sample that misstates its own totals and cannot name a bar (A)

Chip counts per state against the numbers beside them: `one` draws 6 model and 2 gap chips against
`12 of 25`; `many` draws 7 model and 3 gap against `50 of 87`; `error` draws 3 model and 2 fail
against `9 of 25` and `Failed renders 2`. Only the failure chips match. The chips are
`<i class="b model|gap|fail">` with no text, no title, no legend and no bar numbers, distinguished
by fill colour alone.
Why it matters: two defects in one element. The strip cannot be a faithful strip of the session it
describes (7 coloured cells for 50 claimed bars), and a red cell names nothing, so the listener
failure row's "the panel names the failure in the same line" is not drawn. A reader who is colour
blind gets no signal at all from the strip.

## Where the story and the artifact agree

- `Model bars` is a count row in both populated states: the promise "shows how many bars carry a
  model line" has a home, and it is the rows, not the strip.
- The `error` state prints the reason (`AI call exceeded 1565ms`) and its note says "A failed render
  plays a code measure", matching the listener failure row exactly.
- `signed out` says "renders without the decision layer" in those words, and refuses to draw an
  empty chart, matching the guest success row.
- `empty` says "Join, spawn an agent", which matches the plan's "What a person creates": a route
  the app already serves, no form.
- The screen section's five state names and the artifact's five `data-state` values match one to
  one, so the artifact is a faithful rendering of the screen table even where it is not a faithful
  rendering of the story rows. One screen-table delta: it places the bar strip at `many` only,
  while the artifact draws one at `one` as well.

## Mutation check, run on a scratch copy

Source copied to `~/.hermes/profiles/designer/cache/scratch/story-mutation.md`, one story row
deleted at a time, the extractor re-run on the result:

```
dropped the row for: The listener (owner, signed in)
  mutated table still yields 1 row(s): ['A guest (public tier, signed out)']
  MISSING ROLE NAMED: ['The listener (owner, signed in)']
dropped the row for: A guest (public tier, signed out)
  mutated table still yields 1 row(s): ['The listener (owner, signed in)']
  MISSING ROLE NAMED: ['A guest (public tier, signed out)']
mutation check ok for every row: the extractor names the missing role
```

The extractor reads rows from the table, not from a remembered count of two, so a one-row story
reports the missing role instead of reporting clean.

## Run line

The check script's own output, unedited where it matters:

```
ROLES IN THE STORY TABLE (2):
  - The listener (owner, signed in) | came to: hear three agents trade phrases with a drummer under them, at the tempo he set
  - A guest (public tier, signed out) | came to: join a room and hear it play without signing in
STATES THE SCREEN SECTION NAMES (5): empty, one, many, error, signed out
STATES THE ARTIFACT DRAWS (5): empty, one, many, error, signed out
ARITHMETIC:
  one        12 + 13 = 25 against 25 -> SUMS
  many       50 + 47 = 97 against 87 -> DOES NOT SUM (off by 10)
    tag says 45 s; at the plan's 1500 ms bar that is 30 bars, not 87
VERDICT: the named disagreements
  F1 the guest has no failure state                        HOLDS
      evidence: signed out draws 0 value rows; error draws ['Model bars', 'Failed renders', 'Reason'], and the signed-out note says the public tier has no rest and no role
  F2 the panel counts agent slots under a room-bar label   HOLDS
      evidence: many says 50 of 87 with the tag "45 s at 160 BPM", but 45 s at the probe's 1500 ms bar is 30 room bars, so 87 records is 3 agents x ~29
  F3 the many state does not sum, and its model count contradicts the measured 38 HOLDS
      evidence: 50 + 12 + 35 = 97 against 87; the plan claims 38 + 12 + 35 + 2 = 87 for the same run
  F4 the many state drops the failures                     HOLDS
      evidence: many prints ['Model bars', 'Rests', 'Quiet bars (generator)', 'Render p50 / worst'], no failed-renders row; the measured run had 2 fallbacks
  F5 "never falls silent for more than one bar" is not drawable here HOLDS
      evidence: every panel head reads "Last session"; the room is only drawn after the bar line; "silence" 0, "live" 0 in the artifact
  F6 the trade and the stride are invisible                HOLDS
      evidence: trade 0, answer 0, stride 0, tempo ceiling 0; many draws one combined strip of 10 chips
  F7 the signed-out panel never names the drummer and bass HOLDS
      evidence: drummer 1, bass 1, both in the many note; signed-out note: Signed out, the band renders without the decision layer, so
  F8 the strip misstates its own totals and names nothing  HOLDS
      evidence: one draws 6 model chips against 12 (12 of 25); many draws 7 against 50 (50 of 87); fail chips 2 match
  story disagrees with the artifact in 8 named ways (F1 to F8)
```

The script exits 0 with every finding asserted, so the verdict is parsed facts, not prose.

## What this card did not do

The plan's story rows are unread and unedited. The artifact is unedited. No code was touched.
F1 and F2 need a decision from him (a sixth state, and the unit the panel counts in) before Task 12
can be drawn; F3, F4, F5, F7 and F8 are fixes inside Task 12's surface once those two are settled;
F6 needs F2's answer to know whether the strip carries lanes or bars.
