# ROADMAP: AgentJam

## Now

- The lifecycle artifacts that were missing: this spec, the roadmap and the decisions file, the repo
  gate (`check.sh`), the stop command (`HALT`), the runbook and the traps. Landed after the app was
  live, which is the debt this closes.
- The page walk (`docs/PATHS.md` plus `tools/walk-paths.py`) so the flows behind the socket have a
  reproduction instead of a paragraph.

## Next

- **A two-bar arc.** The agent's memory is one bar, so it cannot build a phrase the way a person does.
  The listener already summarises the last two bars; the motif needs the same depth.
- **Dynamics that follow.** Velocity is read from the human's notes and never shaped by them. A partner
  answers a loud phrase louder.
- **The rhythm section as its own peer kind.** The drummer and the bass are room layers that show the
  robot icon, because the protocol's kinds are `human` and `agent`. A third kind is honest labelling.

## Later

- **Beat-level composition for the reactive half.** The composed line is a bar because a bar is the
  chunk a model can fill; the research (arXiv 2510.22105) says smaller chunks buy reactivity at the
  cost of stability. A half-bar renderer with the comping layer underneath is the next trade to
  measure, not to assume.
- **A longer conversation window.** The listener reads two bars because that is what a prompt can hold.
  A rolling phrase history is a different data structure and a different prompt.
- **One model per job.** The renderer is the smallest chat model because the judgement is elsewhere.
  If a measure of musical quality ever separates model size from judgement quality, the ladder can be
  re-cut then.
