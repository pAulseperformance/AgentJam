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
