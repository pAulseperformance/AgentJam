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
through the same per-bar passes the room applies (repair, complete, contour):

```
as the model wrote it        notes/bar  line4+  step%  rep%  leap%  restates-rhythm  lands-thin  ends-C/Eb/G
A four one-bar calls              7.0    29/32    42     7    20             0/8         4/8          5/8
B one four-bar call               5.2    25/32    25    19    17             4/8         7/8          4/8
as the room would play it
A four one-bar calls              6.5    28/32    61     2    11             0/8         4/8          3/8
B one four-bar call               6.1    26/32    54     3     9             2/8         8/8          6/8
B + gap-only top-up               5.6    28/32    42     6    16             4/8         8/8          5/8
```

What the phrase ask BUYS: a bar 2 that repeats bar 1's rhythm (0/8 to 4/8; four separate calls never
do, because each call sees the previous bar only as text), a bar 4 that thins (4/8 to 8/8) and lands
on a stable tone (3/8 to 6/8), and four times fewer calls (32 to 8; 4.65 s of render per phrase
against 2.72 s for the single call).

What it SELLS: the line. The same span is 5.2 notes per bar instead of 7.0 and 25% stepwise motion
instead of 42%, and the room's completion pass is what rescues either arm (61% and 54%). That pass
also rewrites the rhythm bar 2 was written to repeat: applied to every bar it drops the restatement
from 4/8 to 2/8, and applied only to nearly empty bars it leaves stepwise motion at 42%. On a 3B
model the arc and the line are paid for from the same budget.

Robustness, same run: 8 of 8 four-bar answers arrived truncated or with a malformed bracket
(`}]],[[` between bars two and three) and one lost two of its four bars. Tokens used were 289 to 710
against a 2000 budget, so the model stops early rather than hitting the cap; a phrase ask is unusable
without a bar-level salvage (`looseNotes`/`groupIntoBars` in the probe) that groups notes by the bar
line instead of trusting the JSON envelope.

Decision: not a swap. Four one-bar calls plus the completion pass is still the best line measured
(61% stepwise, 28 of 32 bars a line). The phrase ask is worth taking once the line has an owner other
than the model, because its arc wins on every ending.
