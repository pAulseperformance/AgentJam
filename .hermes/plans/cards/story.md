# STORY: who walks in, and what they must see

Repo `agentJam` | Plan `.hermes/plans/2026-10-31_011630-jam-band-and-audit.md` (sha16 bc1c6ce369f30093) | Card key `plan:bc1c6ce369f30093:story`

**Objective:** put the two people this plan serves in front of the designer, in their own words, before any implementation card runs.

## Who they are

| Who | What they came to do | What each person sees when it worked | What each person sees when it fails |
|---|---|---|---|
| The listener (owner, signed in) | hear three agents trade phrases with a drummer under them, at the tempo he set | Model bars land on the grid, the panel shows how many bars carry a model line, a failed render prints its reason, and the room never falls silent for more than one bar | A bar falls back to a code measure and the panel names the failure in the same line, so a bad model night reads as a number rather than as a mystery |
| A guest (public tier, signed out) | join a room and hear it play without signing in | The room plays, the panel says it is rendering without the decision layer, and the drummer and bass still carry the bar | A render fails and the panel says so, without a rest marker it cannot compute, and the room keeps playing |

## What the story card must produce

1. Read the plan's `## The user story` and `## The screen` sections and the artifact at `.hermes/plans/artifacts/2026-10-30-jam-session-summary.html`.
2. Write `story.md` beside the plan recording any disagreement between the plan's two rows and what the artifact actually draws, and report it as a finding.
3. Do not change the plan's story rows: this card reports, it does not re-specify.

**Files:** read `.hermes/plans/2026-10-31_011630-jam-band-and-audit.md`
read `.hermes/plans/artifacts/2026-10-30-jam-session-summary.html`
create `.hermes/plans/2026-10-31_011630-jam-band-and-audit.md.story.md`

**Mutation:** delete one row from the story table in a scratch copy and the card's own report must name the missing role; a card that reports clean on a one-row story has not read it.

**Run:** the card prints the two roles, the states each person meets, and either `story agrees with the artifact` or the named disagreements, then writes the report file.
