# SCREEN: the session panel, drawn before the code that fills it

Repo `agentJam` | Plan `.hermes/plans/2026-10-31_011630-jam-band-and-audit.md` (sha16 17f5bf3e0eb41cfb) | Card key `plan:17f5bf3e0eb41cfb:screen`

**Objective:** the panel that Task 12 implements is designed here, in the estate's own sheets, before any implementer invents it. The artifact already exists as a drawing of five states; this card turns it into the spec an implementer follows.

## What this card owns

The artifact `.hermes/plans/artifacts/2026-10-30-jam-session-summary.html` draws exactly five states: `empty`, `one`, `many`, `error`, `signed out`. This card must:

1. Read the artifact and the plan's `## The screen` section, and make the artifact's own state headings and the plan's states table agree in both directions. A state the artifact draws with no row behind it is a finding, and so is a row with nothing drawn.
2. Name where the panel sits in `src/client/pages/JamRoom.tsx` (which region, above or below the transport controls) and which recorder fields feed each number, reading `src/client/features/room/lib/session-recorder.ts`.
3. Keep the drawn states as the acceptance for Task 12: Task 12's body names the same five, and neither may add a state the other does not carry.
4. Draw no network reference: inline styles only, the estate's theme variables, and no sheet loaded from a URL, because the artifact checker refuses one.

## What it must not do

It must not write product code. The panel is implemented by Task 12; this card's output is the spec plus any correction to the plan's screen section, recorded as a dated note in `.hermes/plans/2026-10-31_011630-jam-band-and-audit.md.screen.md`.

**Files:** read `.hermes/plans/artifacts/2026-10-30-jam-session-summary.html`
read `src/client/features/room/lib/session-recorder.ts`
read `src/client/pages/JamRoom.tsx`
create `.hermes/plans/2026-10-31_011630-jam-band-and-audit.md.screen.md`

**Mutation:** remove one state from the artifact in a scratch copy and the card must report it as a missing drawn state; a card that reports five on a four-state artifact has counted the plan's table, not the page.

**Run:** the card prints the five states, the agreement verdict in both directions, the region and the recorder fields, and writes the spec file. Then `python3 ~/.hermes/skills/software-development/plan/scripts/verify_screen_artifact.py .hermes/plans/artifacts/2026-10-30-jam-session-summary.html --repo . --must "Model bars" --no-git` prints PASS.
