# SPEC: AgentJam

**Last verified:** 2026-10-31 by bash check.sh --live

A real-time jam room where a human, an AI agent and a rhythm section play the same bar together.
Humans join by name, spawn an agent, hear its notes on the same synth engine, and watch what it is
about to play in a panel. One Cloudflare Worker, one Durable Object class, one room per DO instance.

## What it is

- `src/server/` is the Worker: the mount plumbing, the room Durable Object, the bar clock, the listener,
  the repairer, the Jev decision client and the rhythm section's patterns.
- `src/client/` is the page: the synth engine, the visualizer, the keyboard and the observability panel.
- `src/shared/` is what both sides agree on: the wire protocol, the model list, the key arithmetic and
  the pattern generators.

## How it plays

Measured behaviour, not aspiration. Bars render ahead into a two-deep queue and publish on the transport
bar line; every note is addressed to an absolute slot. A signed-in room is judged by Jev before the
model writes. A deterministic comping layer answers inside the beat. The drummer and the bass are code
on the same clock. Each of those has a measurement in `README.md` beside the change that produced it.

## Ownership

- Own repository: ~/Projects/Music/agentJam
- Own deploy target: Cloudflare Worker agent-jam, live at https://zpe.vc/jam/ (version 54e3bcab, deployed 2026-10-30)
- Serves users outside the host app: yes, the mount is public and any stranger with the address reaches it
- Data owner: this repo's Durable Object class JamRoom, whose per-room SQLite storage holds the room state and the note history; no other app reads it

## The one address

`https://zpe.vc/jam/` is the door. `https://jam.zpe.vc/` answers the room API from this same Worker but
its page requests are answered upstream with a 302 to `/services`, so it is not a second door. The
decision to leave it that way, and the measurement behind it, is in `docs/FINDINGS.md`.

## Gates

| what | command |
|---|---|
| the suite and the live surface | `bash check.sh` |
| the above plus the page walk | `bash check.sh --live` |
| the stop command | `bash HALT` |
| the fleet's repo gate | `python3 ~/.hermes/agent-hooks/spec_gate.py repo .` |
