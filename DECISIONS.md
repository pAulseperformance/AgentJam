# DECISIONS: AgentJam

Append-only. One entry per decision, with what it beat and the fact that would overturn it.

## 2026-10-29 The renderer is Workers AI on the same Worker, not an external provider

Loser: a hosted LLM API called from the Durable Object with its own key. Reason: the AI binding is
already on the Worker, the small model answered in 557ms measured through this app, and an external
call adds a credential, a network hop and a bill to every bar. Falsifier: a measured bar where Workers
AI latency exceeds the bar budget on the p90 for a week, or a model answer that cannot be repaired into
a playable bar.

## 2026-10-29 Jev judges, the model renders, and the code applies policy

Loser: asking Jev to write the notes. Reason: Jev generates no text by contract; it answers typed
questions (`role`, `relation`, `density`, `register`, and a rest veto) in one call of 482 to 1104ms
from the edge. Falsifier: a signed room where the brief arrives later than the render can use it, or
where the repaired bar diverges from the brief in more than a fifth of bars.

## 2026-10-29 The composed line is one bar ahead, the reactive layer is one eighth

Loser: rendering the whole bar inside its own beat window. Reason: measured 923ms of phase error when
notes are scheduled from the API return, and the streaming-accompaniment research is explicit that a
large chunk costs reactivity (arXiv 2510.22105), so the two halves are separate. Falsifier: a human
phrase that the composed bar answers with no shared pitch class in more than half of replies after the
answer constraint, which would mean the bar is too coarse.

## 2026-10-29 The drummer and the bass are code, not models

Loser: a generated rhythm section. Reason: a drummer is fixed patterns plus a clock, so it cannot be
late or inconsistent, and it costs no model call; measured 0ms phase and a downbeat in 100% of bars.
Falsifier: a style where the fixed patterns are too repetitive to listen to for four bars, measured by
a person, not by me.

## 2026-10-29 The rest policy is bounded in code

Loser: trusting the decision layer's own rest judgement. Reason: asked whether to sit out, with its
recent activity in the state, Jev rested 7 of 20 live bars, a third of the room silent; with the policy
in code three runs rested exactly 3 in 20. Falsifier: a run where the agent is silent in more than a
fifth of bars, which means the governor is not holding.

## 2026-10-29 Velocity is MIDI 1 to 127 everywhere

Loser: the generator's own 0 to 1 range. Reason: the audio engine divides by 127, so a pattern bar
played at under one percent volume, which sounded like silence rather than like a defect. Falsifier:
a note whose velocity reads outside 1 to 127 in an `ai_debug` frame or a `note_on`.

## 2026-10-29 The tier comes from the door, on a header the browser cannot set

Loser: a per-app login or an Access gate. Reason: the fleet has one identity surface, and a second gate
is a second place to be signed out; the header is computed in the Worker from `get-session` and travels
to the room, so a client message cannot promote itself. Falsifier: a socket that reaches the signed tier
without the door's cookie.

## 2026-10-30 `zpe.vc/jam` is the only door; `jam.zpe.vc` is not

Loser: repairing the upstream interception in `zpe-vc` so the app's own name redirects to the mount.
His call, in his words: "Retire the claim in agentJam". Reason: a GET of `jam.zpe.vc/` answers 302 to
`/services` while HEAD reaches this Worker, so a layer above this Worker answers page requests and no
rule here can win that race; the room API still answers on the old host. Cost accepted: a visitor who
knows the old name lands on `/services` and has to be told the mount. Falsifier: a request where the
zone layer stops intercepting, or a second app that needs the same hostname behaviour, which would make
the redirect worth rebuilding in the right repo.

## 2026-10-30 The plan, its stamp and its review live in the repo, not in the machine's plan directory

Loser: `~/.hermes/plans/`. Reason: that directory is not version controlled, so a review there certifies
a document no other session can see. Falsifier: a tool that only reads the machine's plan directory and
cannot be pointed at a repo path.

## 2026-10-30 Dynamics follow the room, by a shift in the repairer, and a refresh that skips Jev

Loser: letting the model's own velocity follow the brief. Reason: measured with alternating loud and
quiet phrases the reply was a flat 100 either way, and after the shift rule the same probe read 112 to
119 against 42 to 57. Loser for the refresh: paying a Jev decision for the second render, which
measured 1.2s against a 2s bar and never landed. Falsifier: a run where a loud phrase and a quiet one
still get replies within 10 velocity points of each other, which would mean the refresh is missing its
bar again.

## 2026-10-30 An answer carries two of their pitch classes, not one

Loser: the original single-note gesture. Reason: measured with phrases a default C-D-E answer cannot
accidentally match, every reply shared exactly one pitch class (0 of 5 bars cleared a two-note bar),
which reads as its own material with a note borrowed; with two it cleared 4 of 8, and 2 of 2 on bars
rebuilt from a freshly heard window. Falsifier: a run where replies still share one pitch class on
most bars, which would mean the model's own line overrides the constraint.

## 2026-10-30 One agent leads a bar, the turn rotates, and a human outranks both

Loser: letting each agent decide for itself whether to lead. Reason: measured with two agents and no
human, both chose lead or both chose answer, 2 slot collisions, and the room read as an echo. With the
turn rule and a publish-time slot check the same probe measured 0 collisions, a lead in 12 of 14 bars,
never two leads, and no silent bar. Loser also for one synth playing every drum code: a kick, a snare
and a hat are three different voices, so the client builds a kit. Falsifier: a run where two agents
sound the same pitch on the same beat, or a run of 16 bars where neither agent leads any bar.

## 2026-10-30 A melody is a shape in code with notes from the model

Loser: leaving the melody to the decision layer and the model. Reason: measured live, a solo agent
played 3.2 notes per bar with no bar above four and the same arpeggio repeated (Jev answered sparse
every bar, and the prompt's sparse rule asks for 2-4 notes). Loser also for the pitch lottery in the
fallback pattern: it spread across three octaves. With a four-bar arc, a five-note floor and a
completion step the same probe measured 6.1 notes per bar, 12 bars of five or more, and 64 stepwise
moves against 14 leaps. Falsifier: a run where a lead bar still has fewer than four notes, or where
more than a third of the moves are leaps of a fourth or more.

## 2026-10-30 A room with no judge still gets a brief, and dynamics are code

Loser: passing `null` as the brief when Jev is absent (every public session). Reason: recorded, sixteen
bars of eight sixteenths at a flat velocity 100, with no arc, no role and no completion, because all
three hung off the brief. The brief is now code's fallback: lead, medium, mid, new or vary. Loser also
for leaving velocity to the model: a 3B model writes one number per bar, so `shapeLine` swells to the
bar's peak, tapers the ends, holds strong beats and lands the last note, and drops a third consecutive
sixteenth. Measured on a recorded 20-bar solo session after: 5-7 notes per bar, 0 bars at a single
velocity, a median gap of 250ms against 125ms. Falsifier: a recorded session where more than a quarter
of the bars sit at a single velocity, or a bar with eight or more consecutive sixteenths.

## 2026-10-30 A cadence lands short, and a reference phrase exists to judge against

Loser: a five-note floor on every position including the cadence. Reason: the recorded 20-bar session
had 5 to 7 notes in every bar, no bar under four and no silence, so no phrase sounded finished. The
cadence is now three notes with the rest of the bar open. Measured after, 2 of 16 bars landed at three
notes, which is fewer than expected because the phrase position is the ABSOLUTE bar number modulo four,
so a listener who joins mid-bar hears a cadence on a different bar than the first phrase. Also recorded:
a hand-written 8-bar phrase in the same key through the same renderer (`reference-8-bars.mp3`), so
"in key and on the scale" can be judged against something that is deliberately intentional. Falsifier:
a session where no bar lands under four notes across sixteen bars, which would mean the cadence rule
is not reaching the renderer.

## 2026-10-30 The phrase is anchored to the agent, the hook comes back, and the line obeys counterpoint

Loser: a free-running model bar per bar, with the four-bar arc read from the ROOM's bar number. Reason:
measured, the cadence fired on 2 of 16 bars and no bar was ever under four notes, so nothing sounded
finished. The arc now runs from the agent's own phrase start, so a listener always hears
state, restate, develop, cadence.

Three researched rules, each measured on a recording:

- restate returns the HOOK with exactly one change (arXiv 2501.17759: vary slightly, never transform
  blindly), which produced a bar identical to its predecessor except one note or slot
- `applyContourRules` enforces the cantus firmus rules (mostly steps, a leap answered by a step the
  other way, no two leaps in one direction, no repeated pitch), which removed three C5s in a row
- `cadenceLine` lands on the tonic in two notes, approached by step, and leaves the bar open

Falsifier: a recording where the second bar of a phrase differs from the first by more than one note,
or where any bar has two notes on one beat, or where no bar in sixteen is under four notes.
