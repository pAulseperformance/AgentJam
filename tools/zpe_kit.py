#!/usr/bin/env python3
"""agentJam: install zpe-kit inside this repo, and refuse a bundle that names anything outside it.

WHY THIS FILE EXISTS. The signed digest was a property of the directory, not of the commit.
Measured 2026-11-16 at 4b327ce: `python3 ~/.hermes/scripts/attest_page.py --build --check` printed
`sha256:cdbcafc5…` in /data/Projects/Music/agentJam - green, the manifest's own digest - and
`sha256:1e3ab2bf…` in a worktree of the same commit three directories deeper. The two bundles differ in
exactly two lines, the module comments esbuild writes for the kit:

    // ../../zpe-kit/dist/index.js                 here
    // ../../../../../zpe-kit/dist/index.js         three directories deeper

because `node_modules/zpe-kit` is a link to the checkout beside the projects directory, and esbuild names
a module by its realpath relative to the build root. The room at zpe.vc/jam could be rebuilt from one
directory only.

THREE COMMANDS, ONE RULE.

    python3 tools/zpe_kit.py install            copy the kit's bytes to node_modules/zpe-kit
    python3 tools/zpe_kit.py require-installed  exit 1 unless that copy is real files
    python3 tools/zpe_kit.py gate <bundle>      exit 1 if the bundle names a module outside the repo

`install` runs first in scripts/attest-build.sh, so `--build` and `--build --check` both build against
a copy that lives at one path inside the repo, whatever the checkout's own depth. `require-installed`
is the deploy's guard: a tree whose kit is still a link builds bytes no signed manifest names.
`gate` reads back the bundle esbuild wrote and refuses a module comment that resolves outside the
repository - the only mechanism by which the digest can depend on where the checkout lives.

The copy is refreshed from a checkout on every build, so the app still ships the kit's working tree
rather than an installed release. That checkout is the first of: ZPE_KIT_DIR, the realpath of an
existing `node_modules/zpe-kit` link, the path the last install recorded, and `zpe-kit` beside any of
the six directories above this one. node_modules is gitignored, so none of this copy reaches the repo.
"""
import os
import re
import shutil
import subprocess
import sys

TOOLS = os.path.dirname(os.path.abspath(__file__))
# THIS APP'S BUILD ROOT: the directory attest.config.json and wrangler.jsonc sit in. It is also the
# root esbuild writes its module comments relative to, which is why the gate resolves them from here.
ROOT = os.path.dirname(TOOLS)
KIT_DIR = os.path.join(ROOT, "node_modules", "zpe-kit")
KIT_SOURCE = os.path.join(ROOT, "node_modules", ".zpe-kit-source")
# What an install carries: the package's manifest, its README, and the three directories its own
# `files` list names, so every subpath it exports and every script a port runs is present.
KIT_CARRIES = ("package.json", "README.md", "dist", "src", "scripts")


def repo_root() -> str:
    """The repository this build belongs to: the git top level, so a monorepo's app is judged against its repo."""
    try:
        out = subprocess.run(["git", "-C", ROOT, "rev-parse", "--show-toplevel"],
                             capture_output=True, text=True, check=True).stdout.strip()
        if out:
            return os.path.realpath(out)
    except Exception:
        pass
    return os.path.realpath(ROOT)


def kit_checkout() -> str:
    """The kit checkout this build installs from, by the first of four answers that is a package."""
    candidates = []
    if os.environ.get("ZPE_KIT_DIR"):
        candidates.append(os.environ["ZPE_KIT_DIR"])
    if os.path.islink(KIT_DIR):
        candidates.append(os.path.realpath(KIT_DIR))
    if os.path.isfile(KIT_SOURCE):
        with open(KIT_SOURCE, encoding="utf-8") as fh:
            recorded = fh.read().strip()
        if recorded:
            candidates.append(recorded)
    above = repo_root()
    for _ in range(6):
        above = os.path.dirname(above)
        candidates.append(os.path.join(above, "zpe-kit"))
    for candidate in candidates:
        if os.path.isfile(os.path.join(candidate, "package.json")):
            return os.path.realpath(candidate)
    sys.exit("zpe-kit: no checkout to install, so the worker cannot resolve its imports. Looked at: "
             + ", ".join(candidates) + ". Set ZPE_KIT_DIR to the checkout.")


def install() -> int:
    """Put the kit's bytes inside the repo as real files, and remember where they came from.

    THE LINK IS REPLACED BY THE BYTES IT NAMED. Keeping it would keep the checkout's own location in
    the module comment esbuild writes, which is the defect this function exists to remove, and
    removing the copy first means a file the kit dropped cannot survive in node_modules.
    """
    source = kit_checkout()
    if os.path.islink(KIT_DIR):
        os.unlink(KIT_DIR)
    os.makedirs(KIT_DIR, exist_ok=True)
    for name in KIT_CARRIES:
        src, dst = os.path.join(source, name), os.path.join(KIT_DIR, name)
        if os.path.islink(dst) or os.path.isfile(dst):
            os.unlink(dst)
        elif os.path.isdir(dst):
            shutil.rmtree(dst)
        if os.path.isdir(src):
            shutil.copytree(src, dst, symlinks=True)
        elif os.path.isfile(src):
            shutil.copyfile(src, dst)
    with open(KIT_SOURCE, "w", encoding="utf-8") as fh:
        fh.write(source + "\n")
    print(f"zpe-kit: installed from {source} as real files at node_modules/zpe-kit")
    return 0


def require_installed() -> int:
    """The deploy's guard: the tree that ships must be the tree a signed build produced."""
    if os.path.islink(KIT_DIR):
        print(f"zpe-kit: node_modules/zpe-kit is a link to {os.path.realpath(KIT_DIR)}, so this tree "
              "builds a bundle no signed manifest names, and a deploy from it would ship bytes nobody "
              "signed. Run `python3 ~/.hermes/scripts/attest_page.py --build`, then deploy that tree.",
              file=sys.stderr)
        return 1
    if not os.path.isfile(os.path.join(KIT_DIR, "package.json")):
        print("zpe-kit: no installed copy at node_modules/zpe-kit. Run "
              "`python3 ~/.hermes/scripts/attest_page.py --build` first.", file=sys.stderr)
        return 1
    print("zpe-kit: installed inside the repo, so this tree's bundle is the one the manifest names")
    return 0


# A MODULE COMMENT IS A BARE PATH ENDING IN A SOURCE EXTENSION, which is what esbuild writes for every
# module it inlines (`// src/app.ts`, `// node_modules/zpe-kit/dist/index.js`). A prose comment that
# happens to start with a slash - several files here carry one - never ends that way, so it is skipped.
MODULE = re.compile(r"\.(?:m?js|cjs|jsx|tsx?|json)$")


def gate(bundle: str) -> int:
    """Refuse a bundle whose bytes depend on where this checkout lives."""
    repo = repo_root()
    outside = []
    with open(bundle, encoding="utf-8", errors="replace") as fh:
        for number, line in enumerate(fh, 1):
            if not line.startswith("// "):
                continue
            name = line[3:].strip()
            if " " in name or not MODULE.search(name) or not name.startswith((".", "/")):
                continue
            resolved = os.path.realpath(os.path.join(ROOT, name))
            if resolved == repo or resolved.startswith(repo + os.sep):
                continue
            outside.append(f"{number}: {name} -> {resolved}")
    if outside:
        print(f"zpe-kit: {os.path.basename(bundle)} names modules outside {repo}, so its bytes depend "
              "on where the checkout lives:", file=sys.stderr)
        for line in outside:
            print("  " + line, file=sys.stderr)
        print("zpe-kit: install that module inside the repo before it reaches the bundle "
              "(tools/zpe_kit.py install does this for the kit)", file=sys.stderr)
        return 1
    print(f"zpe-kit: every module in {os.path.basename(bundle)} is named inside {repo}")
    return 0


def main() -> int:
    args = sys.argv[1:]
    if not args:
        print("usage: tools/zpe_kit.py install | require-installed | gate <bundle>", file=sys.stderr)
        return 2
    if args[0] == "install":
        return install()
    if args[0] == "require-installed":
        return require_installed()
    if args[0] == "gate":
        if len(args) != 2:
            print("zpe-kit: gate needs the bundle path: tools/zpe_kit.py gate <bundle>", file=sys.stderr)
            return 2
        return gate(args[1])
    print(f"zpe-kit: unknown command {args[0]!r}", file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main())
