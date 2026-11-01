# FINDINGS: AgentJam

Dated findings that are not defects in this repo, or not fixable in it. Each carries the command that
measures it, so the next reader re-measures instead of trusting this page.

## 2026-10-30 The app's own name is not a page door; a layer above this Worker answers it

`https://jam.zpe.vc/` answers `302` to `https://zpe.vc/services` on a GET, while a HEAD of the same
address reaches this Worker and gets its own `301` to `https://zpe.vc/jam/`. The room API on that host
still reaches this Worker (`426` on a plain GET of the socket route), so the route is alive and the
page request is being answered earlier in the edge.

```
curl -s  -D - -o /dev/null https://jam.zpe.vc/ | head -3     # HTTP/2 302, location: /services
curl -sI        -o /dev/null https://jam.zpe.vc/             # HTTP/2 301, location: /jam/
curl -s  -o /dev/null -w '%{http_code}\n' https://jam.zpe.vc/api/room/check/ws   # 426, this Worker
```

**Decision, his words (2026-10-30):** "Retire the claim in agentJam: drop the own-name redirect from
the worker comment and the registry row, and treat zpe.vc/jam as the only door."

So: the Worker's redirect branch stays (it is still what a HEAD gets, and it is correct for any request
that reaches this Worker), the comments that called the old name a door are corrected, and the registry
declaration records the measured truth. The room API keeping both names is left alone: it costs
nothing and the old address still answers sockets.

**Cost accepted:** a visitor who types `jam.zpe.vc` lands on `/services` and has to be told the mount.
**Reopens when:** the zone layer stops intercepting page requests, or a second app needs the same
hostname behaviour, which would make the redirect worth rebuilding in the repo that owns it.

## 2026-11-01 Four bars per call buys the ending and sells the line (measured, not argued)

The room asks the model for ONE bar at a time and builds the phrase arc in code. The question was
whether one call writing four bars would sound better. Measured with `tools/phrase-probe.ts` (8
phrases, llama-3.2-3b, the four arc positions) and then `tools/phrase-apply.ts`, which runs BOTH arms
through the same per-bar passes the room applies.

**CORRECTION, same day, after a critic pass.** The first version of this table came from a chain of
three passes (repair, completion, contour) and the numbers in it, and the verdict under it, followed
from that. `phrase-apply` now runs the room's real order, repair then the arc's own pass then the
bar line's lead-in then the contour rules then the shaping, and with the shaping pass included the
two arms land within three points of each other instead of nine. The paragraph stating the earlier
verdict is kept below, labelled, because the owner has already read it.

```
as the model wrote it        notes/bar  line4+  step%  rep%  leap%  restates-rhythm  lands-thin  ends-C/Eb/G
A four one-bar calls              7.0    29/32    42     7    20             0/8         4/8          5/8
B one four-bar call               5.2    25/32    25    19    17             4/8         7/8          4/8
as the room would play it   (repair, arc, lead-in, contour, shape; one agent, no clash filter)
A four one-bar calls              5.4    24/32    65     2    11             1/8         8/8          5/8
B one four-bar call               6.0    26/32    62     1     8             2/8         8/8          7/8
B + gap-only top-up               5.3    25/32    53     2    14             4/8         8/8          7/8
```

What the phrase ask BUYS: a bar 2 that repeats bar 1's rhythm (0/8 to 4/8 in the model's own notes;
four separate calls never do, because each call sees the previous bar only as text), a bar 4 that
thins and lands on a chord tone of the key (7 of 8 against 5 of 8 once the room plays it), more notes
per bar after the passes (6.0 against 5.4) and a bar that is a line more often (26 of 32 against 24),
and four times fewer calls (32 to 8; 4.65 s of render per phrase against 2.72 s for the single call).

What it SELLS: three points of stepwise motion (62% against 65%), and its own rhythm when the room's
completion pass is applied to every bar (4/8 down to 2/8). Applied only to nearly empty bars the
restatement survives at 4/8 but stepwise motion falls to 53%, so the top-up is a real trade either
way, not a free fix.

Robustness, same run: 8 of 8 four-bar answers arrived truncated or with a malformed bracket
(`}]],[[` between bars two and three) and one lost two of its four bars. Tokens used were 289 to 710
against a 2000 budget, so the model stops early rather than hitting the cap; a phrase ask is unusable
without a bar-level salvage (`looseNotes`/`groupIntoBars` in the probe) that groups notes by the bar
line instead of trusting the JSON envelope.

Decision, CORRECTED: the phrase ask is at least as good as four one-bar calls on every column but
stepwise motion, where it is three points behind, and it is clearly better at ending a phrase. The
earlier verdict below said the opposite; it rested on a chain that omitted the pass which shapes the
line.

> **What this paragraph said before the correction (kept, not deleted):** "Decision: not a swap. Four
> one-bar calls plus the completion pass is still the best line measured (61% stepwise, 28 of 32 bars
> a line)." The 61% and the 28 of 32 were real numbers for a chain without `shapeLine`; on the room's
> full chain the same arm is 65% and 24 of 32, and the phrase arm is 62% and 26 of 32. The failure
> class is a measurement labelled as the room's when it was three of the room's six passes.

## 2026-11-01 The arc was not arcing, and the cadence was erasing the bar

Two of the losses above were the room's own code, not the ask shape, and both are fixed.

THE ARC RAN ON THE ROOM'S CLOCK. The phrase position was `(bar - phraseStartBar) % 4`, so an agent
paced to write every other bar reached only two of the four positions: the recorded session's sixteen
model bars came out 2 states, 6 restates, 3 developments and 5 cadences. It is now a count of the bars
THIS agent takes, one position per bar, and a bar already claimed keeps its position so a re-render is
not a new bar. The position is also PUBLISHED on every bar record (`meta.position`), so a session file
proves the arc instead of a reader re-parsing the prompt.

```
node tools/probe-session.mjs --bpm 190 --seconds 60 --agents jazz,funk --backing 1 --out /tmp/x.json
# phrase    Probe jazz     | state 10  restate 9  develop 10  cadence 10  | next-in-arc 36/38
# phrase    Probe funk     | state 10  restate 9  develop 9  cadence 10   | next-in-arc 34/37
```

Both agents at 190 BPM with the drummer on and 20 of 92 bars paced to stride 2: 38 and 37 bars taken,
each position landing 9 or 10 times, and 36 and 34 of the steps the next one in the cycle. The session
recorded before the fix read 2/6/3/5. A bar the agent rests on, fills with cells or answers on still
takes a position: the phrase is the room's time, and which pass runs on a bar depends on the decision,
not on the position.

THE CADENCE ERASED THE BAR. `cadenceLine` replaced every cadence bar with the same two notes in the
same two slots. `tools/note-loss.ts` replays a recorded session's own model answers through the
pipeline one pass at a time and attributes the loss. With `--legacy-cadence` the same session reads:
completion takes 95 to 100, the cadence pass 100 to 86, the contour rules change nothing, the shaping
86 to 75. So the pass cost 14 of the 100 notes the pipeline held at that point, more than any other
pass, and five cadence bars that carried 23 model notes played 10, so thirteen of the model's own
notes never sounded there. `cadenceFrom` keeps the model's opening, resolves its last note onto a chord
tone OF THE KEY (the first version accepted either third, so a C minor line ending on E counted as a
landing), drops only what follows, and writes the fixed gesture only when the bar is empty.

```
npx tsx tools/note-loss.ts --in ~/.hermes/attachments/jam-session-default-room-2026-11-01T14-56-37-736Z.json --legacy-cadence
# arc (cadence resolved)  100 -> 86 (-14) ... shaping 86 -> 75 ... kept 75 of 95 = 79%
npx tsx tools/note-loss.ts --in ~/.hermes/attachments/jam-session-default-room-2026-11-01T14-56-37-736Z.json
# arc (cadence resolved)  100 -> 91 (-9) ...  shaping 91 -> 80 ... kept 80 of 95 = 84%
```

The remaining losses are deliberate: the shaping pass rests a sixteenth run (11 notes of the same
session) and the cadence thins on purpose (9).

## 2026-11-01 Four bars per call: the switch, and the two things it needed to be real

The room has a setting now, `set_phrase_ask`, off by default. Off, the model writes one bar per call.
On, it is asked once on the bar that opens the agent's phrase and four bars are queued at once, so
three of the four cost no model call.

```
node tools/phrase-live-check.mjs --seconds 42 --bpm 140
```

Measured on the live room, one jazz agent, 140 BPM, setting sent after joining:

```
ai_debug metas:        22
paid for (calls > 0):  4
queued free (calls 0): 18
positions seen:        0 1 2 3  0 1 2 3  0 1 2 3  0
notes on the wire:     120
```

Four calls wrote four phrases; the 18 bars that followed them answer `calls: 0`. The positions cycle
0 1 2 3, so the arc travels with the phrase.

**Two defects only the live room showed, both fixed:** the mid-bar refresh re-asked 13 of the 26 bars
in the first run (a refreshed bar is the one place a phrase stops being a phrase, and it paid the call
the setting exists to save), and the phrase's first bar was announced twice in the debug stream
because `queuePhrase` broadcast a meta that the publish of that bar broadcasts again.

**What this does not settle:** whether it sounds better. The probe said the one-phrase answer wins the
ending (7 of 8 against 5 of 8) and loses three points of stepwise motion, and that is a listener's
call. The switch exists so the call can be made by ear rather than by this page.
