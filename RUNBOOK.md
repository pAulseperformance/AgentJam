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
npm run build
npx wrangler versions upload            # prints the Version ID, does not move traffic
bash check.sh                          # suite + live probes against what is live NOW
npx wrangler versions deploy <id>@100% --yes
bash check.sh --live                   # the same probes against the new version, plus the page walk
```

A deploy is a version, traffic moves only at `versions deploy`, and every step is reversible by
`bash HALT`. Deploying without `check.sh` first is the same as trusting the last green suite to
describe a live edge it never touched.

## The two addresses

- `https://zpe.vc/jam/` is the door. It serves the shell, the assets and the room API under the mount.
- `https://jam.zpe.vc/` answers `api/room/...` from this same Worker, and its page requests are
  answered upstream with a 302 to `/services`. It is not a door. See `docs/FINDINGS.md`.

## When it is slow or the agent goes quiet

1. `bash check.sh --live`: the five probes and the page walk say whether the surface is up.
2. Open a room and read the AI panel: `source: llm` means the model answered, `fallback` means the
   model's answer could not be parsed, `pattern` means a bar was covered deterministically because
   the queue ran dry.
3. `npx wrangler versions list`: which version is serving, and whether a rollback landed.
