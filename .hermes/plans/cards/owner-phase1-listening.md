# OWNER GATE: listen to the room once, then release Phase 2

Repo `agentJam` | Plan `.hermes/plans/2026-10-31_011630-jam-band-and-audit.md` (sha16 94001bdcfe09a08b) | Card key `plan:94001bdcfe09a08b:owner-phase1-listening`

**Objective:** the eighteen-card chain stops here on purpose. Phase 1 (Tasks 1 to 6) changes what the room IS at high tempo, and the owner hears it before the band, the surface and the tools land on top of it.

## What he does

1. Open `https://zpe.vc/jam/` on a fresh tab, join, set 160 BPM, spawn jazz, funk and ambient, switch the drummer and bass on, and listen for two minutes.
2. Compare what he hears against the run this gate was written from: at 160 BPM the room played 38 model bars, 12 rests, 35 generator bars and 2 failures in 45 seconds, with the model writing every second bar.
3. Say `carry on` and this card is completed, which releases Task 7 and the rest of the chain. Say `stop` and the chain stays parked where it is, with the room on Phase 1.

## What this card must NOT do

It must not run a probe, edit the room, or complete itself. It is the owner's turn, assigned to `default`, and only a message from him moves it.

**Files:** none: an owner gate, and the verdict goes back into this plan's own record at `.hermes/plans/cards/README-jam-band-audit.md`

**Mutation:** remove this card's link to Task 7 and Task 7 promotes the moment Task 6 finishes, which is the stop this card exists to enforce; the link is the whole mechanism.

**Run:** the owner opens the room, listens once, and answers `carry on` or `stop`. The card completes on `carry on`.
