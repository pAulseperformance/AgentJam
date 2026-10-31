# RUNBOOK: AgentJam (agent-jam)

The app is live at `https://zpe.vc/jam/`. It is one Cloudflare Worker (`agent-jam`) with one Durable
Object class, and every room is a DO instance with its own SQLite storage.

## Stop it

```
bash HALT                              # roll the Worker back to the previous deployment
bash HALT <version-id>                 # roll back to a version you name
bash HALT <version-id> "reason"        # the same, with the message that lands in the deploy log
```

A rollback keeps the Durable Object storage. Deleting the Worker does not: every room's note history
goes with it, so deleting is never the stop command.

## What dies, and what does not

- **Dies:** the running code. Every open socket is closed on the rollback, every agent stops, every
  room's queue of prepared bars is lost, and the page answers from the older build.
- **Does not die:** the room data. Each DO keeps its `roomState` and its `note_events` table across a
  rollback, because a rollback replaces code and not storage.
- **Does not die either:** the secret `JEV_API_KEY`. Secrets are per Worker, not per version, so a
  rollback keeps the signed-in room's Jev layer working. A secret that must be removed is
  `npx wrangler secret delete JEV_API_KEY`, and that IS the one-way door: signed rooms fall back to
  the free model and nobody is told except the panel's missing `jev` badge.

## Who hears

Nobody. There is no watcher on this app and none is to be added unasked. The person who hears is
whoever runs `check.sh`; the next scheduled pass is his to ask for.

## A data defect needs no rollback

If a room's rows are wrong (a malformed note, a duplicated bar), rolling the code back does not
undelete them. Read what landed first:

```
curl -s https://zpe.vc/jam/api/room/<room>/health
```

then open the room with the SQLite console through `npx wrangler` if the row has to be corrected. The
storage belongs to that room; nothing else reads it.

## Deploy

```
bash deploy.sh
```

One command: it resolves the account from the zone, refuses a tree with uncommitted tracked changes,
builds, runs `bash check.sh` against what is live NOW, uploads a version, moves 100% of traffic to it,
**reads the version id back from Cloudflare** and fails when the version serving is not the one it
uploaded, then runs `bash check.sh --live --version <id>`. It prints `uploaded <id>`,
`deployed <id>@100%`, and the rollback line.

The steps it runs, in order, each of which is reversible on its own:

```
npm run build                          # the build the upload ships
bash check.sh                          # suite + five live readings against what is live NOW
npx wrangler versions upload           # prints the Version ID, does not move traffic
npx wrangler versions deploy <id>@100% --yes
bash check.sh --live --version <id>    # the same readings on the new version, plus the 45 s session probe, the browser smoke and the page walk
```

The browser smoke (`tools/browser-smoke.mjs`) needs Playwright and its chromium once per machine:
`npm i -D playwright && npx playwright install chromium`. A machine without them prints that reading
as NOT ASSERTED; the gate never counts it as a pass. The smoke loads `https://zpe.vc/jam/` in headless
Chromium, joins a fresh room, spawns one agent, and fails unless the page opened ONE socket and heard
one model bar inside twelve seconds.

A deploy is a version, traffic moves only at `versions deploy`, and every step is reversible by
`bash HALT`. `wrangler deploy` is deliberately not the path: it prints success and leaves no id this
repo can hold the system to.

## The two addresses

- `https://zpe.vc/jam/` is the door. It serves the shell, the assets and the room API under the mount.
- `https://jam.zpe.vc/` answers `api/room/...` from this same Worker, and its page requests are
  answered upstream with a 302 to `/services`. It is not a door. See `docs/FINDINGS.md`.

## When it is slow or the agent goes quiet

1. `bash check.sh --live`: the five probes, the browser smoke, the page walk and the probe gate say
   whether the surface is up. The gate's own line is the one that settles whether the MODEL is writing:
   `model bars 66 (floor 20)` means the room published 66 bars from the model and the floor held; a
   number under the floor means the room is filling its own bars and looks alive while the model is
   not.
2. Open a room and read the AI panel: `source: llm` means the model answered, `fallback` means the
   model's answer could not be parsed, `pattern` means a bar was covered deterministically because
   the queue ran dry.
3. `npx wrangler versions list`: which version is serving, and whether a rollback landed.
