# PATHS: the way through AgentJam

One row per path a person walks. `how` is `machine` when `tools/walk-paths.py` can drive it over HTTP,
`MANUAL` when it needs a browser, an audio gesture or the door's cookie. A MANUAL row carries the date it
was last walked and stays SKIPPED until someone walks it again.

| id | actor | what they do | what the app must answer | how | last walked |
|---|---|---|---|---|---|
| P1 | any visitor | opens the mount | 200, and the shell names AgentJam | machine | 2026-10-30 |
| P2 | any visitor | loads the script the shell names | 200 from the same origin, no redirect off the mount | machine | 2026-10-30 |
| P3 | any visitor | asks for the room socket on the app's own host | 426 Expected WebSocket upgrade, from this Worker | machine | 2026-10-30 |
| P4 | any visitor | asks who they are | 200 JSON carrying tier public | machine | 2026-10-30 |
| P5 | a signed-in person | asks who they are with the door's cookie | 200 JSON carrying tier signed and their name | MANUAL | not walked |
| P6 | any visitor | opens the app's old name, a page request | a 301 to https://zpe.vc/jam/ ; currently a 302 to https://zpe.vc/services | MANUAL | 2026-10-30 |

Rows P5 and P6 are MANUAL for different reasons and both are honest:

- **P5** needs the door's session cookie, which the walker does not carry. Steps: hold
  `__Secure-better-auth.session_token` for a signed-in principal, open `https://zpe.vc/jam/`, spawn an
  agent, and read the header chip, which must say `Jev agent` rather than `Free agent`. Last walked
  2026-10-29 by the agent's own door principal, which read `tier: signed` from the endpoint.
- **P6** is the open finding: the row expects a 301 and the edge answers a 302 to `/services`. It stays
  MANUAL, with its date, until `docs/FINDINGS.md`'s finding is closed or the row's expectation is
  rewritten by whoever closes it.

What this map does not walk, and says so: the audio itself, the socket's join and spawn messages, and
the drummer's count-in. A walker that speaks HTTP can see a route answer; it cannot hear a bar. Those
live in the manual steps above and in the live probes inside `check.sh`.
