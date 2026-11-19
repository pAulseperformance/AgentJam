#!/usr/bin/env python3
"""Does this repo's own signer refuse a digest it cannot vouch for, and pass the layout it does ship?

Run from the repo root, by check.sh, after the manifest leg:

    python3 scripts/attest-layout-test.py

Stdlib only, because it runs on whatever python3 a clean clone has. Every case drives the REAL functions in
this repo's `scripts/attest_page.py`, so a case that stops discriminating is a case that goes red here rather
than a guard that quietly stops guarding.

The pre-change failure is not subtle: before this file landed, the signer had no `install_layout`, no
`--layout`, and no bundle scan at all, so this test fails on the first attribute lookup. It is the test the
card asked for: both answers, from the same functions the gate calls.
"""
import importlib.util
import json
import os
import subprocess
import sys
import tempfile

FAILED = []


def check(name, ok, detail=""):
    print(("  ok    " if ok else "  FAIL  ") + name + (f"  [{detail}]" if detail and not ok else ""))
    if not ok:
        FAILED.append(name)


def load_signer(here):
    path = os.path.join(here, "scripts", "attest_page.py")
    if not os.path.exists(path):
        raise SystemExit(f"attest-layout-test: no signer at {path}")
    spec = importlib.util.spec_from_file_location("attest_page_under_test", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def fixture(root, name, deps=None):
    """A repo-shaped directory: a package.json that declares `deps`, and nothing else."""
    d = os.path.join(root, name)
    os.makedirs(d, exist_ok=True)
    pkg = {"name": name, "version": "0.0.0"}
    if deps is None:
        pkg["dependencies"] = {"zpe-kit": "file:../zpe-kit"}
    elif deps:
        pkg["dependencies"] = {k: "1.0.0" for k in deps}
    with open(os.path.join(d, "package.json"), "w") as fh:
        json.dump(pkg, fh)
    return d


def real_install(repo, *packages):
    node_modules = os.path.join(repo, "node_modules")
    os.makedirs(node_modules, exist_ok=True)
    for name in packages:
        pkg = os.path.join(node_modules, name)
        os.makedirs(pkg, exist_ok=True)
        open(os.path.join(pkg, "index.js"), "w").write("export const a = 1;\n")
    return node_modules


def link(where, target):
    if os.path.lexists(where):
        os.unlink(where)
    os.symlink(target, where)


def main():
    here = os.getcwd()
    mod = load_signer(here)
    # READ THIS CHECKOUT'S OWN DECLARATION FIRST, because every fixture below re-points mod.HERE at a
    # temporary repo and the honest answer about THIS repo would then be read from the wrong package.json.
    own_deps = mod.declared_dependencies()
    root = tempfile.mkdtemp(prefix="attest-layout-test.")
    elsewhere = os.path.join(root, "elsewhere")
    os.makedirs(elsewhere)

    # --- the layout, one shape at a time -------------------------------------------------------------------
    empty = fixture(root, "declares-and-never-installed")
    mod.HERE, mod.BUILD_CWD = empty, empty
    check("a repo that declares dependencies with none installed is refused",
          mod.install_layout()[0] == "missing" and mod.install_problem() is not None)

    nothing = fixture(root, "declares-nothing", deps=[])
    mod.HERE, mod.BUILD_CWD = nothing, nothing
    check("a repo that declares no dependency is not refused for having none",
          mod.install_layout()[0] == "missing" and mod.install_problem() is None)

    inside = fixture(root, "real-install")
    real_install(inside, "zpe-kit")
    mod.HERE, mod.BUILD_CWD = inside, inside
    check("a real node_modules with real packages is the pass",
          mod.install_layout()[0] == "inside" and mod.install_problem() is None)

    linked_nm = fixture(root, "node_modules-is-a-link")
    link(os.path.join(linked_nm, "node_modules"), os.path.join(elsewhere, "node_modules"))
    mod.HERE, mod.BUILD_CWD = linked_nm, linked_nm
    state, detail = mod.install_layout()
    check("a symlinked node_modules is refused, and the refusal names the target",
          state == "linked" and detail.endswith("node_modules -> " + os.path.realpath(os.path.join(elsewhere, "node_modules")))
          and mod.install_problem() is not None, detail)

    linked_pkg = fixture(root, "one-package-is-a-link")
    real_install(linked_pkg, "wrangler")
    link(os.path.join(linked_pkg, "node_modules", "zpe-kit"), elsewhere)
    mod.HERE, mod.BUILD_CWD = linked_pkg, linked_pkg
    state, detail = mod.install_layout()
    check("a linked package inside a real node_modules is refused by name",
          state == "linked" and detail.endswith("node_modules/zpe-kit -> " + os.path.realpath(elsewhere))
          and mod.install_problem() is not None, detail)

    inner = fixture(root, "link-resolving-inside")
    real_install(inner, "zpe-kit")
    os.makedirs(os.path.join(inner, "vendor", "kit"))
    link(os.path.join(inner, "node_modules", "kit-alias"), os.path.join(inner, "vendor", "kit"))
    mod.HERE, mod.BUILD_CWD = inner, inner
    check("a link that resolves inside the checkout is not an escape",
          mod.install_layout()[0] == "inside" and mod.install_problem() is None)

    sub = fixture(root, "build-runs-in-a-subdirectory")
    real_install(sub, "wrangler")
    os.makedirs(os.path.join(sub, "docs", "worker"))
    mod.HERE = sub
    mod.BUILD_CWD = os.path.join(sub, "docs", "worker")
    check("a build in a subdirectory finds the repo's own node_modules",
          mod.install_layout()[0] == "inside" and mod.install_problem() is None, mod.install_layout()[1])

    # --- the artifact, which is the last word --------------------------------------------------------------
    sub_base = os.path.join(sub, "docs", "worker")
    mod.HERE = sub
    escaped = mod.escaped_module_comments("// ../../../zpe-kit/dist/index.js\n", sub_base)
    check("a comment naming a path outside the repo is refused, relative to the build directory",
          escaped == ["// ../../../zpe-kit/dist/index.js"], str(escaped))
    check("the refusal quotes the line, so a reader knows which module",
          escaped and "// ../../../zpe-kit/dist/index.js" in mod.outside_problem(escaped))

    mod.HERE, mod.BUILD_CWD = sub, sub_base
    inside_comment = mod.escaped_module_comments("// ../../api.json\n// ../../vendor/zpe-kit/dist/shell.js\n", sub_base)
    check("a ../ comment that resolves back inside the repo is not an escape",
          inside_comment == [], str(inside_comment))

    absolute = mod.escaped_module_comments("// /Users/someone/kit/dist/index.js\n", sub_base)
    check("an absolute path outside the repo is refused", absolute == ["// /Users/someone/kit/dist/index.js"])

    trailer = mod.escaped_module_comments("const x = 1; // ../not-a-module-boundary\n", sub_base)
    check("a trailing comment is not a module boundary", trailer == [])

    prose = mod.escaped_module_comments(
        "// /pool and /privacy/remove answered 302 to /maintenance while the page counted them as open.\n"
        "// /maintenance while this page offered both as addresses that answer\n", sub_base)
    check("prose that begins with a slash is not a module named /pool", prose == [], str(prose))

    # a two-part artifact: the escaping comment lives in a file that is not the signed `bundle`
    tree = os.path.join(root, "two-part")
    os.makedirs(os.path.join(tree, "worker"))
    open(os.path.join(tree, "index.js"), "w").write("assets\n" + "0" * 64 + "  index.html\n")
    open(os.path.join(tree, "worker", "index.js"), "w").write("// ../../zpe-kit/dist/shell.js\n")
    found = mod.escaped_comments_in_tree(tree, os.path.join(root, "totally-somewhere-else"))
    check("the scan reads every JavaScript file the build emitted, not only the signed bundle",
          found == ["// ../../zpe-kit/dist/shell.js"], str(found))

    # --- this checkout's own answer, from the command the gate runs ----------------------------------------
    proc = subprocess.run([sys.executable, os.path.join(here, "scripts", "attest_page.py"), "--layout"],
                          cwd=here, capture_output=True, text=True)
    state = (proc.stdout.splitlines() or [""])[0].strip()
    check("this checkout's own --layout exits 0", proc.returncode == 0,
          (proc.stdout + proc.stderr).strip()[:300])
    if state == "inside":
        check("this checkout's own --layout prints inside", True)
    else:
        check("this checkout declares no dependency, so a missing install is its honest answer",
              state == "missing" and own_deps == [], state)

    print(f"attest-layout-test: {'FAILED' if FAILED else 'ok'} — {len(FAILED)} failing")
    return 1 if FAILED else 0


if __name__ == "__main__":
    raise SystemExit(main())
