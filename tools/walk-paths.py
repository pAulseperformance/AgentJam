#!/usr/bin/env python3
"""walk-paths.py: drive the machine rows of docs/PATHS.md against a live app.

The map is the artifact and the script is the driver. Rows marked MANUAL are SKIPPED with their
reason, never passed: a path nobody walked is not a path that works.

Exit codes, three of them, because "nowhere to ask" is not a verdict:
  0  every machine row answered
  2  a machine row DISAGREED with the app
  3  no machine row got an HTTP answer at all, so the walk was not asserted

Usage:
  python3 tools/walk-paths.py --base https://zpe.vc
  python3 tools/walk-paths.py --base https://nope.example     # proves the exit-3 contract
"""

import argparse
import re
import sys
import urllib.error
import urllib.request

ROWS = "docs/PATHS.md"


def rows_from(path):
    """Read the PATH table: id, actor, what, expected, how."""
    out = []
    for line in open(path, encoding="utf-8"):
        s = line.strip()
        if not s.startswith("|"):
            continue
        cells = [c.strip() for c in s.strip("|").split("|")]
        if not cells or not re.match(r"^P\d+$", cells[0]):
            continue
        out.append({"id": cells[0], "how": cells[4] if len(cells) > 4 else "MANUAL"})
    return out


def get(url, want_body=False):
    """An HTTP status is an ANSWER, a connection failure is NOT. A 404 from a live host must read as
    disagreement, never as "nothing answered", which is the distinction the exit codes exist for."""
    req = urllib.request.Request(url, headers={"user-agent": "agentjam-walker"})
    try:
        with urllib.request.urlopen(req, timeout=20) as res:
            body = res.read().decode("utf-8", "ignore") if want_body else ""
            return res.status, body, res.geturl()
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", "ignore") if want_body else ""
        return exc.code, body, url


def check_p1(base):
    status, body, _ = get(base.rstrip("/") + "/jam/", want_body=True)
    return (status == 200 and "AgentJam" in body, f"{status}, title {'present' if 'AgentJam' in body else 'missing'}")


def check_p2(base):
    status, body, _ = get(base.rstrip("/") + "/jam/", want_body=True)
    if status != 200:
        return (False, f"the shell answered {status}, so its asset could not be read")
    match = re.search(r'/jam/assets/[^"]+\.js', body)
    if not match:
        return (False, "the shell names no /jam/assets script")
    astatus, _, _ = get(base.rstrip("/") + match.group(0))
    return (astatus == 200, f"{match.group(0)} answered {astatus}")


def check_p3(base, app_host):
    url = f"https://{app_host}/api/room/check/ws"
    status, _, _ = get(url)
    return (status == 426, f"{url} answered {status} (426 is this Worker's own refusal)")


def check_p4(base):
    status, body, _ = get(base.rstrip("/") + "/jam/api/whoami", want_body=True)
    return (status == 200 and '"tier":"public"' in body, f"{status}, body {body[:90]}")


HANDLERS = {"P1": check_p1, "P2": check_p2, "P4": check_p4}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", default="https://zpe.vc")
    parser.add_argument("--app-host", default="jam.zpe.vc")
    parser.add_argument("--paths", default=ROWS)
    args = parser.parse_args()

    rows = rows_from(args.paths)
    machine = [r for r in rows if r["how"] == "machine"]
    if not machine:
        print("NOT ASSERTED: the map carries no machine rows")
        return 3

    answered = disagreed = 0
    for row in rows:
        if row["how"] != "machine":
            print(f"SKIP {row['id']}  MANUAL: a person walks this one, with its date in {args.paths}")
            continue
        if row["id"] == "P3":
            ok, detail = check_p3(args.base, args.app_host)
        elif row["id"] in HANDLERS:
            ok, detail = HANDLERS[row["id"]](args.base)
        else:
            print(f"SKIP {row['id']}  no handler for a machine row, which is a walker defect")
            continue
        answered += 1
        if ok:
            print(f"PASS {row['id']}  {detail}")
        else:
            disagreed += 1
            print(f"FAIL {row['id']}  {detail}")

    if answered == 0:
        print("NOT ASSERTED: no machine row got an HTTP answer, so nothing is claimed about the app")
        return 3
    if disagreed:
        print(f"WALK FAILED: {disagreed} of {answered} machine rows disagreed with the app")
        return 2
    print(f"WALK PASSED: {answered} machine rows answered")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except urllib.error.URLError as exc:
        print(f"NOT ASSERTED: no machine row got an HTTP answer ({exc})")
        sys.exit(3)
