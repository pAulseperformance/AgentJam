#!/usr/bin/env python3
"""Provenance for a page: a signed manifest beside it, and a verifier a stranger can run.

EACH REPO SIGNS WITH ITS OWN COPY. The copy lives at `scripts/attest_page.py` inside the repo that ships the
artefact, and that repo's check.sh runs it. The copy beside `~/.hermes/scripts` is the desk's, and it is kept out
of the signing and gating path: a signer reached by an absolute path outside the repo cannot run in CI, and it
drifts from the guard each repo needs. Change the guard here first, copy this file into a repo, then prove that
repo's own gate and commit both.

    python3 tools/attest.py --page public/answers/<slug>.html      # rewrite the prov line, hash, sign, write <slug>.json
    python3 tools/attest.py --all                                   # every page in public/answers
    python3 tools/attest.py --verify https://zpe.vc/answers/<slug>  # fetch, re-hash, check the signature, say fresh or stale
    python3 tools/attest.py --build                                 # BUILD MODE: sign the app's deployed build, not page bytes
    python3 tools/attest.py --build --deployed                      # AFTER a deploy: does the address serve the build signed here?
    python3 tools/attest.py --build --check                         # recompute that build's digest and re-verify the signature

BUILD MODE exists for an app whose HTML is assembled per request. A worker has no byte string that survives two
requests, so a manifest of the served bytes would be a manifest of one moment. What such an app CAN attest is the
artifact that renders every request: `--build` hashes the bundle `wrangler deploy --dry-run` produces, signs that,
and writes it as a constant the worker serves at `<mount>/index.json`. The manifest says so in its own field
(`"mode": "build"`) and in words (`attests` / `does_not_attest`), so a verifier never compares a hash it cannot
compute. `digest` is taken with the manifest constant EMPTIED, because a hash of a bundle containing itself is not
computable; `--build --check` recomputes it with the same rule, which is what makes the claim executable.

ONE BUILD, MANY ADDRESSES. A manifest binds to the address it is served at, so a worker that renders `/blog` and
`/blog/<slug>` cannot vouch for the second with the first: the statement would name another page. The repo lists the
addresses it renders under `page_paths`; `--build` signs one manifest per address (same digest, own `id` and `url`),
the worker serves each at `<page>.json`, and `--build --check` refuses a tree where a listed page has no manifest.

WHAT IS HASHED, EXACTLY. The page's main region, from <main> to </main>, because the zone rewrites the bytes on
the way out: Cloudflare's challenge-platform script is appended before </body> on every HTML response, measured on
this zone, so a digest of the served file can never match the file on disk. The region is what we author and what
we attest. `file_digest` records the file as built, and the verifier reports how many bytes arrived outside the
region so the gap is visible rather than hidden.

TWO DIGESTS inside that scope, because they answer two questions:

  digest          the file as served, byte for byte, no normalization. The verifier compares the bytes it fetches
                  against this, so a page edited on a server without a re-sign is caught.
  content_digest  the same file with the provenance line removed. The version number is inside that line, so hashing
                  it into the version would be circular; content_digest is what decides whether the version moves.

A build that changes nothing does not bump the version: the prov line is rewritten with the version it already has,
the file is byte-identical, and the digest does not move either.

THE SIGNATURE is ed25519 over the canonical JSON (sorted keys, no whitespace) with the signature field removed, made
with `ssh-keygen -Y sign -n zpe-attest`. The public key is published at /answers/.well-known/attest/allowed_signers,
so a reader can verify without asking us for anything.
"""
from __future__ import annotations

import datetime as dt
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile

def _repo_root() -> str:
    """The repo to attest, which is the directory this runs FROM, not the directory this file lives in: the
    shared copy sits in ~/.hermes/scripts and is called by repos that each have their own config."""
    cwd = os.getcwd()
    if os.path.exists(os.path.join(cwd, "attest.config.json")) or os.path.isdir(os.path.join(cwd, "public")):
        return cwd
    return os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


HERE = _repo_root()

# ONE IMPLEMENTATION, ONE CONFIG PER REPO. A repo drops `attest.config.json` beside its code and says where its
# pages are and how they are addressed; a repo that says nothing gets the answers defaults, which is what keeps the
# pipeline that already ships unmoved by this change.
CONFIG_PATH = os.path.join(HERE, "attest.config.json")
CONFIG = json.load(open(CONFIG_PATH, encoding="utf-8")) if os.path.exists(CONFIG_PATH) else {}

PAGES = os.path.join(HERE, CONFIG.get("pages_dir", "public/answers"))
KEY = os.path.expanduser(CONFIG.get("key", "~/.hermes/agent-identity/zpe-attest"))
NS = CONFIG.get("namespace", "zpe-attest")
KEY_ID = CONFIG.get("key_id", "zpe-attest-2026")
AGENT_PUB = KEY + ".pub"
BASE = CONFIG.get("base_url", "https://zpe.vc/answers")
DELEGATION_URL = CONFIG.get("delegation", "https://zpe.vc/answers/.well-known/attest/delegation.json")
ID_PREFIX = CONFIG.get("id_prefix", "zpe:answers")
EXCLUDE = set(CONFIG.get("exclude", ["index.html"]))   # the section index is not a page of its own
INDEX_NAME = CONFIG.get("index_name", "index")          # "index" maps to the directory's own address
WEB_PATH = CONFIG.get("web_path", "/answers")   # the URL path the pages directory is served at
VERIFY_URL = CONFIG.get("verify_url", "/answers/verify")
SIGNERS_URL = CONFIG.get("signers_url", "https://zpe.vc/answers/.well-known/attest/allowed_signers")

# BUILD MODE IS A PROPERTY OF THE REPO, not a flag on a command: an app either has pages with bytes or a bundle
# that renders them. The five keys below are the whole difference between one build-mode app and another.
MODE = CONFIG.get("mode", "page")
BUILD_FILE = os.path.join(HERE, CONFIG.get("manifest_file", "src/build-manifest.js"))
BUILD_EXPORT = CONFIG.get("export", "BUILD")
BUILD_COMMAND = list(CONFIG.get("build_command", ["npx", "--no-install", "wrangler", "deploy", "--dry-run", "--outdir"]))
# WHERE THE BUILD RUNS. Wrangler runs a config's `build.command` with the caller's cwd, not the config's, so an app
# whose wrangler.jsonc lives in a subdirectory (api-registry's docs worker is `docs/worker`) cannot be built from the
# repo root: its own build command resolves `../../tools/...` against the wrong directory and fails. `build_cwd` names
# the directory to run in, relative to the repo root; absent means the repo root, which is every app that had one.
BUILD_CWD = os.path.join(HERE, CONFIG["build_cwd"]) if CONFIG.get("build_cwd") else HERE
BUILD_BUNDLE = CONFIG.get("bundle", "index.js")

# WHERE THE DEPENDENCIES RESOLVED. The digest is the bundle, and the bundle carries esbuild's module-boundary
# comments whose `../` depth follows the path a dependency resolved from. Measured 2026-11-19: one commit at
# one Node version built to fae0155b with a real install inside the checkout and cb5da1dc in a worktree whose
# dependencies came from elsewhere, so a signature taken there describes a bundle nobody ships. The signer
# refuses a layout it cannot vouch for rather than signing it.
#
# ONE PACKAGE CAN BE THE LINK, ONE LEVEL BELOW THE GUARD. A real `node_modules` directory proves nothing about
# what is inside it: a single dependency installed as a symlink to a checkout elsewhere resolves the same way
# as a linked `node_modules` does, and its module comment names the target. Measured here 2026-11-19 with
# `node_modules` real and `node_modules/zpe-kit -> a sibling copy`: the bundle read `// ../kit-real/dist/index.js`
# and the digest was 6ff5b0a4, not the 31726a8a a clean install builds.
def linked_packages(root: str) -> list[str]:
    """Every top-level dependency that is a symlink resolving outside the build root, as `path -> target`."""
    dep = os.path.join(root, "node_modules")
    if os.path.islink(dep) or not os.path.isdir(dep):
        return []
    found = []
    for name in sorted(os.listdir(dep)):
        if name.startswith("."):
            continue
        entry = os.path.join(dep, name)
        if os.path.islink(entry):
            real = os.path.realpath(entry)
            if not real.startswith(root + os.sep):
                found.append(f"{entry} -> {real}")
    return found


def dependency_chain() -> list[str]:
    """Every `node_modules` the build can resolve from, nearest first: BUILD_CWD up to the repo root.

    A BUILD IN A SUBDIRECTORY RESOLVES ITS DEPENDENCIES FROM THE REPO ROOT, and nothing beside the build.
    `build_cwd` exists for exactly that shape: api-registry's wrangler.jsonc is `docs/worker`, its
    `npx --no-install wrangler` finds the binary by walking up to the repo's own node_modules, and no
    `docs/worker/node_modules` exists or should. A guard that looks only beside the build reports `missing`
    for a tree that installs perfectly, so it walks the same chain node does, stopped at the repo root.
    """
    here = os.path.realpath(HERE)
    cur = os.path.realpath(BUILD_CWD)
    chain = []
    while True:
        chain.append(os.path.join(cur, "node_modules"))
        if cur == here or os.path.dirname(cur) == cur:
            break
        nxt = os.path.dirname(cur)
        if nxt != here and not nxt.startswith(here + os.sep):
            break
        cur = nxt
    return chain


def declared_dependencies() -> list[str]:
    """The dependency names the repo declares, so "nothing installed" can be read as "nothing to install"."""
    try:
        pkg = json.load(open(os.path.join(HERE, "package.json"), encoding="utf-8"))
    except Exception:
        return ["(package.json unreadable)"]
    names = list((pkg.get("dependencies") or {}).keys())
    names += list((pkg.get("devDependencies") or {}).keys())
    return names


def install_layout() -> tuple[str, str]:
    """(state, detail) for every dependency directory the build will resolve from."""
    here = os.path.realpath(HERE)
    chain = dependency_chain()
    found = []
    for dep in chain:
        if not os.path.lexists(dep):
            continue
        real = os.path.realpath(dep)
        if os.path.islink(dep):
            return "linked", f"{dep} -> {real}"
        if not real.startswith(here + os.sep):
            return "outside", real
        packages = linked_packages(os.path.dirname(dep))
        if packages:
            return "linked", "; ".join(packages)
        found.append(real)
    if not found:
        return "missing", ", ".join(chain)
    return "inside", ", ".join(found)


def install_problem() -> str | None:
    """The sentence a person needs when the layout makes the digest unvouchable, or None when it is inside."""
    state, detail = install_layout()
    if state == "inside":
        return None
    if state == "missing" and not declared_dependencies():
        # NOTHING TO INSTALL IS NOT A DEFECT. zpe-mirror declares no dependency at all and builds with the
        # global wrangler, whose version it records inside the artifact; refusing here would red a gate that
        # is telling the truth. The bundle scan below still reads the artifact, which is the real guard.
        return None
    why = {
        "missing": "the repo declares dependencies and none is installed where the build resolves them",
        "linked": "a dependency is a symlink to a path outside the checkout, so the bundle's module paths follow it",
        "outside": "node_modules resolves outside the checkout, so the bundle's module paths follow that path",
    }[state]
    return (f"build: {why} ({detail}). The digest follows where dependencies resolve, so a signature taken "
            f"here would describe a bundle nobody ships. Install inside the checkout (npm ci) and re-run.")


# THE BUNDLE'S OWN BYTES ARE THE LAST WORD, AND THEY NAME PATHS. esbuild writes each module's path, relative to
# the build root, as a comment: a module inside the repo reads `src/x.js` or `node_modules/zpe-kit/dist/shell.js`,
# while one resolved outside reads `../...` whose depth is the checkout's own, or an absolute path. So the same
# commit builds to different bytes at different locations. The layout guard above catches the install shapes we
# know; this reads the artifact, so a shape nobody predicted still cannot be signed.
MODULE_COMMENT = re.compile(r"^// (?:\.\./|/)")
# A MODULE COMMENT NAMES ONE FILE, WITH NO SPACES AND WITH AN EXTENSION. The loose filter above is the
# reference's and is kept for its callers; this is the one the scan decides on, because prose that begins with
# a slash is not a module boundary. Measured 2026-11-19 in zpe-vc, whose artifact carries a source comment
# `// /pool and /privacy/remove answered 302 to /maintenance while the page counted them as open.` — the loose
# filter read that as a module named `/pool` and refused a bundle whose bytes a clean checkout reproduces.
MODULE_FILE_COMMENT = re.compile(r"^// (\S+\.(?:js|mjs|cjs|ts|tsx|jsx|json|css|wasm|node|txt))$")
BUNDLE_SUFFIXES = (".js", ".mjs", ".cjs")


def outside_module_comments(bundle_text: str) -> list[str]:
    """The bundle's module-boundary comments that name a path outside the build root, in file order."""
    return [line for line in bundle_text.splitlines() if MODULE_COMMENT.match(line)]


def escaped_module_comments(bundle_text: str, base: str) -> list[str]:
    """The module comments that NAME A PATH OUTSIDE THE REPO, resolved from the directory the build ran in.

    A COMMENT IS RELATIVE TO `build_cwd`, NOT TO THE REPO ROOT, so the test is a resolution and not a prefix.
    Measured 2026-11-19 in api-registry, whose build runs in `docs/worker`: its bundle names
    `// ../../api.json`, which is the repo's own root file, and `// ../../vendor/zpe-kit/dist/shell.js`, which
    is inside the repo too. A regex that refuses every `../` refuses a bundle a clean checkout reproduces
    exactly; the escape is the resolved path leaving the checkout.
    """
    here = os.path.realpath(HERE)
    escaped = []
    for line in bundle_text.splitlines():
        if not MODULE_FILE_COMMENT.match(line):
            continue
        named = line[3:].strip()
        target = named if os.path.isabs(named) else os.path.join(base, named)
        target = os.path.realpath(os.path.normpath(target))
        if target != here and not target.startswith(here + os.sep):
            escaped.append(line)
    return escaped


def escaped_comments_in_tree(outdir: str, base: str) -> list[str]:
    """Every escaping module comment in every JavaScript file the artifact contains, deduplicated in order.

    THE SIGNED BUNDLE IS NOT ALWAYS ONE FILE. music/agentJam's `bundle` is `index.js` in the outdir, and
    `scripts/attest-build.sh` writes it as a text sha256 inventory of the worker bundle and the client assets;
    the wrangler bundle is `worker/index.js` beside it. Reading only `bundle` reads the inventory and sees no
    module comments at all, so the scan reads every JavaScript file the build emitted.
    """
    escaped = []
    for root, _dirs, files in os.walk(outdir):
        for name in sorted(files):
            if not name.endswith(BUNDLE_SUFFIXES):
                continue
            path = os.path.join(root, name)
            try:
                text = open(path, encoding="utf-8", errors="replace").read()
            except OSError:
                continue
            for line in escaped_module_comments(text, base):
                if line not in escaped:
                    escaped.append(line)
    return escaped


def outside_problem(lines: list[str]) -> str:
    """The refusal a signing run prints, with every offending module comment named in it."""
    return ("build: the bundle names a module outside this repo, so its bytes depend on where the "
            "checkout lives and no clean checkout reproduces the digest:\n  "
            + "\n  ".join(lines[:10])
            + "\n  install that dependency inside the checkout (npm ci, so it is real files under "
              "node_modules/) and rebuild")

# WHAT THE DIGEST IS OVER, said by the app that knows. An app whose page is assembled by the worker and
# an app whose page is a static shell out of a build directory do not sign the same artifact, and the
# sentence a reader sees must be the one that is true of the app in front of them. The default is the
# worker bundle; a repo that also ships assets names both halves in its own config.
BUILD_DIGEST_SCOPE = CONFIG.get(
    "digest_scope",
    "the worker bundle wrangler deploy --dry-run builds from this commit, taken with the build manifest emptied",
)
# ONE BUILD, MANY ADDRESSES. A manifest binds to the address it is served at (`url` is checked against what was
# served), so a worker that renders `/blog/<slug>` as well as `/blog` needs one signed statement per address, all
# naming the SAME bundle digest: the build is one, the addresses are many. A repo lists the page addresses it renders
# under `page_paths`; `--build` signs one manifest for each, the constant beside `BUILD` is what the worker serves at
# `<page>.json`, and `--build --check` fails when a listed page has no manifest, because a page this build renders
# and nobody signed is a page a stranger cannot check.
PAGE_PATHS = [p if str(p).startswith("/") else "/" + str(p) for p in CONFIG.get("page_paths", [])]
PAGES_EXPORT = CONFIG.get("pages_export", "PAGES")

PROV_RE = re.compile(r'\n *<p class="prov">.*?</p>', re.S)
REGION_RE = re.compile(r"<main\b.*?</main>", re.S)


def region(text: str) -> str:
    """The attested bytes: the page's main region, which the edge does not rewrite."""
    m = REGION_RE.search(text)
    return m.group(0) if m else text


def sha(path_or_bytes) -> str:
    h = hashlib.sha256()
    if isinstance(path_or_bytes, bytes):
        h.update(path_or_bytes)
    else:
        with open(path_or_bytes, "rb") as fh:
            h.update(fh.read())
    return "sha256:" + h.hexdigest()


def agent_fingerprint() -> str:
    """The fingerprint a verifier compares against the delegation's `agent` field."""
    try:
        out = subprocess.run(["ssh-keygen", "-lf", AGENT_PUB], capture_output=True, text=True, check=True).stdout
        return out.split()[1]
    except Exception:
        return "unknown"


def git_commit() -> str:
    try:
        return subprocess.run(["git", "-C", HERE, "rev-parse", "HEAD"], capture_output=True, text=True, check=True).stdout.strip()
    except Exception:
        return "unknown"


def canonical(manifest: dict) -> bytes:
    body = {k: v for k, v in manifest.items() if k != "signature"}
    return json.dumps(body, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()


def sign(payload: bytes) -> str:
    with tempfile.TemporaryDirectory() as tmp:
        src = os.path.join(tmp, "payload")
        with open(src, "wb") as fh:
            fh.write(payload)
        subprocess.run(["ssh-keygen", "-Y", "sign", "-f", KEY, "-n", NS, src],
                       check=True, capture_output=True)
        with open(src + ".sig", encoding="utf-8") as fh:
            return fh.read().strip()


def prov_line(slug: str, version: str, day: str, href: str) -> str:
    # TWO LINKS, ONE JOB EACH: the manifest is the record, and the verifier is what a reader does with it. A
    # page that ships the evidence but no way to check it leaves the check to whoever thinks of it.
    check = BASE if not slug else f"{BASE}/{slug}"
    return (f'\n  <p class="prov"><span>Version {version}</span>'
            f'<span>Signed {day}</span><span>ZPE</span>'
            f'<a href="{href}" rel="alternate" type="application/json">Provenance</a>'
            f'<a href="{VERIFY_URL}?url={check}">Check this page</a></p>')


def page_files() -> list:
    """Every page under PAGES, at any depth, minus the excluded ones. A subdirectory's index.html is that
    directory's address, which is how a site with / and /vn ends up with two pages and not four candidates."""
    out = []
    for root, _, files in os.walk(PAGES):
        for name in sorted(files):
            if not name.endswith(".html") or name in EXCLUDE or name.startswith("_"):
                continue
            out.append(os.path.join(root, name))
    return sorted(out)


def slug_of(page: str) -> str:
    rel = os.path.relpath(page, PAGES)[:-5].replace(os.sep, "/")
    parts = rel.split("/")
    if parts[-1] == INDEX_NAME:
        parts = parts[:-1]
    return "/".join(parts)


def build(page: str) -> dict:
    slug = slug_of(page)
    manifest_name = os.path.basename(page)[:-5] + ".json"
    raw = open(page, encoding="utf-8").read()
    stripped = PROV_RE.sub("", raw)

    man_path = os.path.join(os.path.dirname(page), manifest_name)
    old = json.load(open(man_path, encoding="utf-8")) if os.path.exists(man_path) else None

    content_digest = sha(region(stripped).encode())
    if old and old.get("content_digest") == content_digest:
        version = old["version"]
        published = old["published_at"]
    else:
        version = "1.0" if not old else bump(old["version"])
        published = dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")

    day = dt.datetime.now(dt.timezone.utc).strftime("%-d %B %Y")
    rel_dir = os.path.dirname(os.path.relpath(page, PAGES)).replace(os.sep, "/")
    href = "/" + "/".join(p for p in (WEB_PATH.strip("/"), rel_dir, manifest_name) if p)
    with_prov = stripped.replace("\n</main>", prov_line(slug, version, day, href) + "\n</main>", 1)
    if with_prov == stripped:                      # a page with no </main> still gets a line, at the end of body
        with_prov = stripped.replace("</body>", prov_line(slug, version, day, href) + "\n</body>", 1)
    if with_prov != raw:
        open(page, "w", encoding="utf-8").write(with_prov)

    digest = sha(region(with_prov).encode())
    file_digest = sha(with_prov.encode())
    published_day = dt.date.fromisoformat(published[:10])
    manifest = {
        "id": f"{ID_PREFIX}:{slug}" if slug else ID_PREFIX,
        "url": BASE if not slug else f"{BASE}/{slug}",
        "digest": digest,
        "digest_scope": "the page's main region, <main> to </main>, with no normalization",
        "file_digest": file_digest,
        "file_digest_scope": "the file as built, which the edge may append to before it reaches a reader",
        "content_digest": content_digest,
        "content_digest_scope": "the same region with the provenance line removed",
        "prev_digest": old["digest"] if old else None,
        "version": version,
        "published_at": published,
        "generated_at": dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "author": "ZPE",
        "approver": "ZPE",
        "signing_key": {"fingerprint": agent_fingerprint(), "key_id": KEY_ID},
        "delegation": DELEGATION_URL,
        "commit": git_commit(),
        "review_by": (published_day + dt.timedelta(days=180)).isoformat(),
        "status": "live",
        "superseded_by": None,
        "attests": "these bytes are the bytes that were signed by the key named below, at the time recorded",
        "does_not_attest": "that the content is true, or that a claim on the page is correct",
    }
    manifest["signature"] = {"alg": "ssh-ed25519", "key_id": KEY_ID, "namespace": NS, "value": sign(canonical(manifest))}
    open(man_path, "w", encoding="utf-8").write(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n")
    return manifest


def bump(version: str) -> str:
    parts = (version.split(".") + ["0", "0"])[:3]
    return f"{parts[0]}.{int(parts[1]) + 1}"


# ── BUILD MODE ───────────────────────────────────────────────────────────────────────────────────────────────
# An app whose HTML is assembled per request has no byte string to hash, so it attests the artifact instead:
# the bundle the deploy uploads. Everything below is app-independent; a repo says which bundle to hash and
# where to write the constant in attest.config.json, and nothing here changes when a second app is onboarded.

BUILD_HEAD = (
    "// GENERATED by `python3 scripts/attest_page.py --build`. Do not edit by hand.\n"
    "// The signature covers every field below, and `--build --check` recomputes the digest from this tree.\n"
)


def read_constant():
    """The manifest the app serves, or None. Found by its export, never by a line number.

    PARSED WITH raw_decode, not json.loads over the rest of the file: the constant file carries a second export
    (`PAGES`) after this one, and a parse that ran to the end of the file would read the two objects as one and
    report no manifest at all - which is what the first build after page_paths was added did, silently, with a
    signed file on disk.
    """
    if not os.path.exists(BUILD_FILE):
        return None
    text = open(BUILD_FILE, encoding="utf-8").read()
    marker = f"export const {BUILD_EXPORT} = "
    at = text.find(marker)
    if at < 0:
        return None
    body = text[at + len(marker):].lstrip()
    try:
        value, _ = json.JSONDecoder().raw_decode(body)
    except Exception:
        return None
    return value if isinstance(value, dict) else None


def read_pages_constant() -> dict:
    """The per-address manifests the app serves, keyed by the address path ("/why-a-post")."""
    if not os.path.exists(BUILD_FILE):
        return {}
    text = open(BUILD_FILE, encoding="utf-8").read()
    marker = f"export const {PAGES_EXPORT} = "
    at = text.find(marker)
    if at < 0:
        return {}
    body = text[at + len(marker):].lstrip()
    try:
        got, _ = json.JSONDecoder().raw_decode(body)
    except Exception:
        return {}
    return got if isinstance(got, dict) else {}


def write_constant(manifest: dict, pages: dict | None = None) -> None:
    body = (BUILD_HEAD + f"export const {BUILD_EXPORT} = "
            + json.dumps(manifest, indent=2, ensure_ascii=False) + ";\n")
    if pages:
        body += (
            "\n// ONE SIGNED STATEMENT PER PAGE ADDRESS THIS BUILD RENDERS. The digest, version and commit are the\n"
            "// build's, so every entry names the same artifact; only `id` and `url` differ, because a manifest binds to\n"
            "// the address it is served at. The worker serves each entry at <page>.json, where a verifier probes.\n"
            f"export const {PAGES_EXPORT} = " + json.dumps(pages, indent=2, ensure_ascii=False) + ";\n"
        )
    open(BUILD_FILE, "w", encoding="utf-8").write(body)


def dirty_paths() -> list:
    """What git reports as changed, minus the constant this tool writes and then re-reads."""
    try:
        out = subprocess.run(["git", "-C", HERE, "status", "--porcelain", "--untracked-files=all"],
                             capture_output=True, text=True, check=True).stdout
    except Exception:
        return ["(git could not report the tree)"]
    mine = os.path.relpath(BUILD_FILE, HERE)
    return [line[3:].strip() or line for line in out.splitlines() if line[3:].strip() != mine]


def build_digest() -> str:
    """sha256 of the bundle the deploy uploads, taken with the manifest constant EMPTIED.

    THE EMPTYING IS THE POINT. The bundle contains this manifest and the manifest must name the bundle's hash,
    which cannot be computed from bytes that contain the answer. So the hash is of the same source with
    `export const BUILD = {};` in that one file: a definition anyone holding the repo can reproduce, and the
    exact rule `--build --check` re-runs on every gate. The previous constant is restored afterwards, including
    when the build fails, so an interrupted run leaves the tree as it found it."""
    previous = open(BUILD_FILE, encoding="utf-8").read() if os.path.exists(BUILD_FILE) else None
    with tempfile.TemporaryDirectory() as out:
        try:
            # BOTH EXPORTS HAVE TO SURVIVE THE EMPTYING, or a worker importing `PAGES` fails to bundle and the digest
            # cannot be taken at all. The emptied file is the same shape for every app that declares no page_paths,
            # so their digests are unmoved by this.
            emptied = (f"// emptied for the digest: see attest_page.py --build\n"
                       f"export const {BUILD_EXPORT} = {{}};\n")
            if PAGE_PATHS:
                emptied += f"export const {PAGES_EXPORT} = {{}};\n"
            open(BUILD_FILE, "w", encoding="utf-8").write(emptied)
            res = subprocess.run(BUILD_COMMAND + [out], cwd=BUILD_CWD, capture_output=True, text=True)
            if res.returncode != 0:
                raise SystemExit("build: the bundle could not be produced:\n" + (res.stderr or res.stdout)[-3000:])
            bundle = os.path.join(out, BUILD_BUNDLE)
            if not os.path.exists(bundle):
                raise SystemExit(f"build: the bundle produced no {BUILD_BUNDLE}")
            escaped = escaped_comments_in_tree(out, BUILD_CWD)
            if escaped:
                raise SystemExit(outside_problem(escaped))
            problem = install_problem()
            if problem:
                # JUDGED HERE, ON THE TREE THE ARTIFACT CAME FROM. If the build did not install its
                # dependencies inside the checkout, the digest that was just taken describes a bundle whose
                # module paths follow a link, and signing it would be a false statement.
                raise SystemExit(problem)
            return sha(bundle)
        finally:
            if previous is None:
                if os.path.exists(BUILD_FILE):
                    os.remove(BUILD_FILE)
            else:
                open(BUILD_FILE, "w", encoding="utf-8").write(previous)


def allowed_signers() -> str:
    import urllib.request
    req = urllib.request.Request(SIGNERS_URL, headers={"user-agent": "zpe-attest/1.0 (+https://zpe.vc/answers)"})
    with urllib.request.urlopen(req, timeout=15) as r:
        return r.read().decode()


def build_app(allow_dirty: bool = False) -> dict:
    if install_problem():
        print(f"build: layout before the build is {install_layout()[0]}; judging it again on the tree the "
              f"build produces")
    old = read_constant()
    dirty = dirty_paths()
    if dirty and not allow_dirty:
        raise SystemExit("build: refusing to sign a dirty tree, because the digest would name no commit.\n"
                         "       commit first, or pass --allow-dirty for a local manifest you will not deploy:\n  "
                         + "\n  ".join(dirty))
    digest = build_digest()
    commit = git_commit()
    now = dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    # THE VERSION MOVES ONLY WHEN THE BUILD DOES, which is the page module's rule applied to a bundle: a rebuild
    # of unchanged source neither bumps the version nor moves the published date.
    same = bool(old) and old.get("digest") == digest and old.get("commit") == commit and old.get("source_clean") == (not dirty)
    if old and same:
        version, published = old["version"], old["published_at"]
    else:
        version = "1.0" if not old else bump(old["version"])
        published = now
    published_day = dt.date.fromisoformat(published[:10])
    manifest = {
        "id": ID_PREFIX,
        "url": BASE,
        "mode": "build",
        "digest": digest,
        "digest_scope": BUILD_DIGEST_SCOPE,
        "version": version,
        "published_at": published,
        "generated_at": now,
        "author": "ZPE",
        "approver": "ZPE",
        "signing_key": {"fingerprint": agent_fingerprint(), "key_id": KEY_ID},
        "delegation": DELEGATION_URL,
        "commit": commit,
        "source_clean": not dirty,
        "review_by": (published_day + dt.timedelta(days=180)).isoformat(),
        "status": "live",
        "superseded_by": None,
        "attests": "the build that renders this address",
        "does_not_attest": "the bytes served for one request",
        # THE ONE FIELD THE SIGNATURE DOES NOT COVER, said out loud. `served_by` is written by the app at request
        # time from the platform's version metadata, because a bundle cannot contain the id the deploy assigns it.
        # A verifier drops every name in this list before canonicalising, so a signed field cannot be smuggled out.
        "unsigned_fields": ["served_by"],
    }
    manifest["signature"] = {"alg": "ssh-ed25519", "key_id": KEY_ID, "namespace": NS, "value": sign(canonical(manifest))}
    # THE PAGES THIS BUILD RENDERS, each with its own signed statement. Cloned from the build's body so the digest,
    # version and commit cannot drift between them, and re-signed because `id` and `url` are inside the signature: a
    # manifest that named one address while being served at another is the copy the address bind exists to refuse.
    pages = {}
    for path in PAGE_PATHS:
        body = dict(manifest)
        body.pop("signature", None)
        body["id"] = f"{ID_PREFIX}:{path.strip('/')}"
        body["url"] = BASE.rstrip("/") + path
        body["signature"] = {"alg": "ssh-ed25519", "key_id": KEY_ID, "namespace": NS,
                             "value": sign(canonical(body))}
        pages[path] = body
    write_constant(manifest, pages)
    return manifest


def commit_problem(commit: str | None, root: str | None = None) -> str | None:
    """Why the manifest's `commit` names no tree a stranger can check out, or None.

    THE OTHER HALF OF THE CLAIM, AND NOTHING ELSE HERE CHECKED IT. `digest` proves the bytes; `commit` says which
    tree those bytes came from, and a rebase falsifies it without moving the digest at all: the tree keeps building
    to the signed hash while the named commit drops off every ref. Measured on zpe:tv on 2026-11-08: the manifest
    named fc6ef89, an object still on disk but on no branch, tag or history, signed before the branch was rebuilt
    onto 72959b4. Every gate stayed green because each one only ever recomputed the digest. A commit that is not an
    ancestor of HEAD is not one a stranger can check out from this history, so the manifest is refused. Ancestor
    rather than equal, because `--build` signs HEAD and the commit that carries the manifest is the next one.
    """
    root = root or HERE
    commit = str(commit or "")
    if not commit:
        return "no commit to check"
    present = subprocess.run(["git", "-C", root, "cat-file", "-e", commit + "^{commit}"],
                             capture_output=True, text=True)
    if present.returncode != 0:
        return (f"commit {commit[:12]} is not an object in this repository: the field names a tree nobody can "
                "check out; re-run --build from the commit you actually ship")
    anc = subprocess.run(["git", "-C", root, "merge-base", "--is-ancestor", commit, "HEAD"],
                         capture_output=True, text=True)
    if anc.returncode == 0:
        return None
    if anc.returncode == 1:
        head = subprocess.run(["git", "-C", root, "rev-parse", "--short=12", "HEAD"],
                              capture_output=True, text=True).stdout.strip() or "HEAD"
        return (f"commit {commit[:12]} is not an ancestor of HEAD ({head}): it was rebased or squashed away, so "
                "the manifest names a tree no one can check out; re-run --build on the merged commit")
    return f"git could not compare commit {commit[:12]} with HEAD: {(anc.stderr or '').strip()[:200]}"


def signature_problem(man: dict, signers: str) -> str | None:
    """Why this manifest's signature does not hold, or None. One rule, so the build and its pages cannot diverge."""
    sig = man.get("signature") or {}
    if not sig.get("value"):
        return "no signature value"
    try:
        with tempfile.TemporaryDirectory() as tmp:
            payload = os.path.join(tmp, "payload")
            open(payload, "wb").write(canonical(man))
            sig_path = os.path.join(tmp, "payload.sig")
            open(sig_path, "w", encoding="utf-8").write(sig["value"] + "\n")
            allowed_path = os.path.join(tmp, "allowed")
            open(allowed_path, "w", encoding="utf-8").write(signers)
            res = subprocess.run(["ssh-keygen", "-Y", "verify", "-f", allowed_path, "-I", "zpe",
                                  "-n", sig.get("namespace", NS), "-s", sig_path],
                                 stdin=open(payload, "rb"), capture_output=True, text=True)
    except SystemExit:
        raise
    except Exception as exc:
        return f"the signature could not be checked: {exc}"
    return None if res.returncode == 0 else "the signature does not verify against the published allowed_signers"


def build_check() -> int:
    """Is the committed constant a true statement about this tree? Recomputes the digest and re-verifies."""
    if install_problem():
        # THE LAYOUT IS JUDGED AFTER THE BUILD, NOT BEFORE IT. A repo may install its own dependencies inside
        # the checkout as the first step of its build command: zpe-vault, zpe-blog and zpe-vc run
        # `tools/zpe_kit.py install` from scripts/attest-build.sh, so `npm ci` leaves the link that the build
        # then replaces with real files. Refusing before the build would refuse the tree the build repairs.
        print(f"build: layout before the build is {install_layout()[0]}; judging it again on the tree the "
              f"build produces")
    man = read_constant()
    if not man:
        print(f"build: no manifest at {os.path.relpath(BUILD_FILE, HERE)}; run --build first")
        return 2
    problems = []
    for field in ("id", "url", "mode", "digest", "version", "published_at", "commit", "signature"):
        if not man.get(field):
            problems.append(f"missing {field}")
    if man.get("mode") != "build":
        problems.append(f"mode is {man.get('mode')!r}, not 'build'")
    if man.get("source_clean") is not True:
        problems.append("source_clean is not true: this was signed from a dirty tree and names no commit")
    # THE COMMIT, BEFORE THE NETWORK CALL, AND AS A WARNING RATHER THAN A FAILURE. A squash merge rewrites history,
    # so a signature taken on a PR head can name a commit the merged main never contains; measured 2026-11-19, #306
    # squashed its signed head 26e5f7c into e47d1ff, and every branch cut from main afterwards failed here while
    # building exactly the signed bundle. The digest is the claim that the artifact is the one signed, and a digest
    # mismatch still fails a few lines below; the commit is provenance, and a missing one says "re-sign on the
    # merged commit" rather than "the record is false".
    warnings = []
    bad_commit = commit_problem(man.get("commit"))
    if bad_commit:
        warnings.append(bad_commit + " (provenance, not the claim)")
    signers = allowed_signers()
    bad = signature_problem(man, signers)
    if bad:
        problems.append(bad)
    recomputed = build_digest()
    if recomputed != man.get("digest"):
        problems.append(f"this tree builds to {recomputed} while the manifest names {man.get('digest')}: "
                        "a source change shipped without re-running --build")
    # EVERY PAGE THIS BUILD RENDERS HAS TO CARRY A STATEMENT, or a stranger reading that address gets nothing to
    # check while the app's root index reads FRESH. The digest is the build's, so one bundle can vouch for all of
    # them; `url` is each page's own, so the address bind still decides where each statement may be read.
    pages = read_pages_constant()
    for path in PAGE_PATHS:
        pm = pages.get(path)
        if not pm:
            problems.append(f"no signed manifest for page {path}: this build renders it and a verifier would read "
                            "UNSIGNED; re-run --build")
            continue
        for field in ("id", "url", "mode", "digest", "version", "published_at", "commit", "signature"):
            if not pm.get(field):
                problems.append(f"page {path}: missing {field}")
        if pm.get("url") != BASE.rstrip("/") + path:
            problems.append(f"page {path}: names {pm.get('url')!r}, not its own address")
        if pm.get("digest") != man.get("digest"):
            problems.append(f"page {path}: names {pm.get('digest')} while the build is {man.get('digest')}")
        # A PAGE IS CLONED FROM THE BUILD'S BODY, so a commit that differs here is drift the digest check cannot
        # see: the two would attest the same bytes and claim different trees.
        if pm.get("commit") != man.get("commit"):
            problems.append(f"page {path}: names commit {str(pm.get('commit'))[:12]} while the build is "
                            f"{str(man.get('commit'))[:12]}")
        bad = signature_problem(pm, signers)
        if bad:
            problems.append(f"page {path}: {bad}")
    print(f"build: {man.get('id')} v{man.get('version')}  {man.get('digest', '')[:19]}…  commit {str(man.get('commit'))[:12]}"
          f"  pages signed: {len(pages)}/{len(PAGE_PATHS)}")
    for w in warnings:
        print(f"  WARN  {w}")
    for p in problems:
        print(f"  FAIL  {p}")
    print("build: ok, the manifest describes the tree in front of you" if not problems else "build: FAILED")
    return 0 if not problems else 1


ANCHOR_NAME = "_zpe-attest.zpe.vc"


def anchor_state(published, root) -> tuple:
    """(ok, sentence). A mismatch is proof; an unreadable record is not evidence of anything, so it does not fail."""
    if published is None:
        return True, "not checked (no DNS over HTTPS from this tool)"
    if not published:
        return False, f"NO ROOT PUBLISHED at {ANCHOR_NAME}"
    if root and published != root:
        return False, f"THE ZONE PUBLISHES A DIFFERENT ROOT: {published}"
    return True, f"the zone publishes this key ({published.replace('SHA256:', '')[:16]}...)"


def published_root(timeout: float = 12.0):
    """The root fingerprint the ZONE publishes, read over DNS-over-HTTPS so it is not fetched from the site under
    test. None means the lookup itself failed, which is a different state from a record that names a different key."""
    import urllib.request
    u = f"https://cloudflare-dns.com/dns-query?name={ANCHOR_NAME}&type=TXT"
    req = urllib.request.Request(u, headers={"accept": "application/dns-json",
                                             "user-agent": "zpe-attest/1.0 (+https://zpe.vc/answers)"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            data = json.loads(r.read())
    except Exception:
        return None
    for answer in data.get("Answer", []):
        txt = str(answer.get("data", "")).replace('"', "")
        m = re.search(r"zpe-attest-root=(\S+)", txt)
        if m:
            return m.group(1)
    return ""


def verify(url: str) -> int:
    import urllib.request

    def get(u: str) -> bytes:
        return get_final(u)[0]

    def get_final(u: str):
        # a named agent, because the zone answers 403 to python's default user-agent (measured on the pilot)
        req = urllib.request.Request(u, headers={"user-agent": "zpe-attest/1.0 (+https://zpe.vc/answers)"})
        with urllib.request.urlopen(req, timeout=20) as r:
            return r.read(), r.geturl()

    def as_manifest(blob: bytes):
        """A manifest, or None when the document at that address is not one.

        AN APP'S OWN DATA DOCUMENT IS NOT A MANIFEST, and the two can share an address. `/api/docs` serves its build
        manifest at the only address the convention leaves it, but the app already answers `/api/docs.json` with its
        own 62 KB index document, which carries a `digest` and no `id`. Treating any parseable JSON as a manifest
        crashed this verifier with a KeyError on `signature`, and the sweep reported the page as UNREACHABLE — a lie
        about a page that answered 200. The two fields a manifest cannot omit are the test, so a document that is not
        one falls through to the next candidate address instead of being read as a broken manifest.
        """
        try:
            doc = json.loads(blob)
        except Exception:
            return None
        if not isinstance(doc, dict) or not doc.get("id") or not doc.get("digest"):
            return None
        return doc

    page, served_url = get_final(url)
    # a root address has no `.json` sibling: its manifest is the index of the same directory
    man = None
    for candidate in (url.rstrip("/") + ".json", url.rstrip("/") + "/index.json"):
        try:
            man = as_manifest(get(candidate))
        except Exception:
            man = None
        if man is not None:
            break
    if man is None:
        # NO MANIFEST IS AN ANSWER, NOT A CRASH: the footer offers this check from every page that wears it, so
        # most arrivals are pages the estate has not signed yet. Say so and exit 2, which is neither fresh (0)
        # nor stale (1): nothing was checked, so nothing is claimed either way.
        print(f"page      {url}")
        print("manifest  none beside this address")
        print("verdict   UNSIGNED")
        return 2
    text = page.decode("utf-8", "replace")
    # A MANIFEST NAMES ITS OWN UNSIGNED FIELDS, and they are dropped before anything is canonicalised, so the
    # bytes verified are exactly the bytes that were signed. Dropping a name that WAS signed only breaks the
    # signature, which is why this cannot be used to smuggle a field out of the signed body.
    mode = man.get("mode", "page")
    served = {k: man.get(k) for k in man.get("unsigned_fields", [])}
    for k in man.get("unsigned_fields", []):
        man.pop(k, None)
    if mode == "build":
        # NO BYTE COMPARISON, AND NOT AS A CONCESSION: a worker assembles its HTML per request, so there is no
        # byte string that survives two requests to compare. What this manifest claims is the build, so the
        # checks that remain are the ones that can be made about a build.
        live = "(not compared: this manifest attests a build, not a response)"
        ok_hash = True
        outside = 0
    else:
        live = sha(region(text).encode())
        ok_hash = live == man["digest"]
        outside = len(page) - len(region(text).encode())
    # A MANIFEST WITH NO SIGNATURE IS A REFUSED CLAIM, NOT A TRACEBACK. It has already named an id and a digest, so
    # it is holding itself out as a manifest; the check cannot pass it and must say why rather than die on the field
    # it expected. Anything that answers here will be read by a stranger's browser, so every shape gets a verdict.
    sig = man.pop("signature", None)
    if not isinstance(sig, dict) or not sig.get("value"):
        print(f"page      {url}")
        print("signature ABSENT  this address serves a document with an id and a digest, and no signature")
        print("verdict   STALE")
        return 1
    allowed = get(SIGNERS_URL).decode()

    with tempfile.TemporaryDirectory() as tmp:
        payload = os.path.join(tmp, "payload")
        open(payload, "wb").write(canonical(man))
        sig_path = os.path.join(tmp, "payload.sig")
        open(sig_path, "w", encoding="utf-8").write(sig["value"] + "\n")
        allowed_path = os.path.join(tmp, "allowed")
        open(allowed_path, "w", encoding="utf-8").write(allowed)
        res = subprocess.run(["ssh-keygen", "-Y", "verify", "-f", allowed_path, "-I", "zpe", "-n", sig["namespace"],
                              "-s", sig_path], stdin=open(payload, "rb"), capture_output=True, text=True)
    ok_sig = res.returncode == 0

    # THE MANIFEST MUST BELONG TO THIS ADDRESS, or any host can copy a signed page and its manifest elsewhere and be
    # called Fresh. Same two conditions as the browser verifier: its `url` equals what was served after redirects, and
    # the site its id names appears in that address.
    import urllib.parse
    def canon(u: str) -> str:
        s = urllib.parse.urlsplit(u or "")
        return f"{s.scheme.lower()}://{s.netloc.lower()}" + (s.path.rstrip("/") or "/")
    bound = canon(man.get("url", "")) == canon(served_url)
    idparts_all = [p for p in str(man.get("id", "")).split(":") if p]
    site_id = idparts_all[1] if len(idparts_all) > 1 else ""
    addr = canon(served_url)
    host_labels = addr.split("//")[-1].split("/")[0].split(".")
    first_seg = addr.split("/")[3] if len(addr.split("/")) > 3 else ""
    site_in_addr = bool(site_id) and (site_id in host_labels or first_seg == site_id)
    ok_addr = bound and site_in_addr

    # scope, the half a signature alone does not carry
    import fnmatch
    parts = [p for p in str(man.get("id", "")).split(":") if p]
    subject = (parts[1] if len(parts) > 1 else "") + "/" + "/".join(parts[2:])
    scopes = (json.loads(get(man.get("delegation", "")).decode()) if man.get("delegation") else {}).get("scope", [])
    ok_scope = any(fnmatch.fnmatchcase(subject, pat) for pat in scopes)

    # the anchor: the root the ZONE publishes, not the one the page says authorised it
    try:
        del_obj = json.loads(get(man.get("delegation", "")).decode()) if man.get("delegation") else {}
    except Exception:
        del_obj = {}
    ok_anchor, anchor_text = anchor_state(published_root(), del_obj.get("root", ""))

    print(f"page      {url}")
    if mode == "build":
        sb = served.get("served_by") or {}
        print("mode      BUILD  this manifest attests the build that renders the address, not one response")
        print(f"digest    {man['digest']}")
        print(f"digest of {man.get('digest_scope', '')}")
        print(f"serving   {sb.get('version_id') or 'not reported by this app'}"
              + (f"  created {sb.get('created_at')}" if sb.get("created_at") else "")
              + "  (unsigned: read from the platform at request time)")
    else:
        print(f"digest    {man['digest']}")
        print(f"served    {live}  {'MATCH' if ok_hash else 'MISMATCH'}")
        print(f"outside   {outside} bytes arrived outside the attested region (edge chrome, not covered)")
    print(f"signature {'VALID' if ok_sig else 'INVALID'}  ({sig['alg']}, key {sig['key_id']})")
    print(f"scope     {'covers' if ok_scope else 'DOES NOT COVER'} {subject}  ({', '.join(scopes) or 'none declared'})")
    print(f"domain    {anchor_text}")
    print(f"address   {'belongs here' if ok_addr else 'IS A COPY: the manifest names ' + str(man.get('url'))}"
          + f"  (served {served_url})")
    print(f"version   {man['version']}   published {man['published_at']}   review by {man['review_by']}")
    print(f"commit    {man['commit']}   status {man['status']}")

    ok = ok_hash and ok_sig and ok_scope and ok_addr and ok_anchor
    print(f"verdict   {'FRESH' if ok else 'STALE'}")
    return 0 if ok else 1


def build_deployed() -> int:
    """AFTER a deploy: is the address serving the build this tree signs?

    `--build --check` compares the signed constant to the tree, which is the right gate BEFORE a deploy. Neither it
    nor `--verify` answers the question a deploy raises, because a build manifest names a bundle rather than a
    response: `--verify` proves the manifest is signed, delegated and served by its own address, and says so in as
    many words, while the address can be serving a DIFFERENT build that was signed yesterday. That is silent drift,
    and this is the assertion that catches it: recompute the digest from the tree, read the digest the address
    actually serves, and refuse when they differ.

    A MATCHING DIGEST IS NOT A BUILD A STRANGER CAN CHECK OUT. `digest` proves the bytes and `commit` says which
    tree they came from, so both documents have their commit checked by the same rule as `--build --check`: the
    address can serve a manifest naming a commit this history cannot produce while the digest pair agrees, which
    is exactly what it did for mind-mapper on 2026-11-08 (served a833c3c, only on a side branch; exit 0).
    """
    import urllib.request

    man = read_constant()
    if not man:
        print(f"deployed: no manifest at {os.path.relpath(BUILD_FILE, HERE)}; run --build first")
        return 2
    base = (CONFIG.get("base_url") or "").rstrip("/")
    if not base:
        print("deployed: attest.config.json declares no base_url")
        return 2
    url = base + "/index.json"
    req = urllib.request.Request(url, headers={"user-agent": "zpe-attest/1.0 (+https://zpe.vc/answers)"})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            live = json.loads(r.read())
    except Exception as exc:
        print(f"deployed: {url} did not answer: {exc}")
        return 2

    mine = build_digest()
    served_by = (live.get("served_by") or {})
    print(f"address   {url}")
    print(f"tree      {mine}   v{man.get('version')}   commit {str(man.get('commit'))[:12]}")
    print(f"served    {live.get('digest')}   v{live.get('version')}   commit {str(live.get('commit'))[:12]}")
    if served_by:
        print(f"running   {served_by.get('version_id') or 'not reported'}"
              + (f"   created {served_by.get('created_at')}" if served_by.get("created_at") else ""))
    same = mine == man.get("digest") and live.get("digest") == man.get("digest")
    # three ways to disagree, and they mean different things, so they are named apart
    if mine != man.get("digest"):
        print("  FAIL  this tree builds to a digest the manifest does not name: re-run --build")
    if live.get("digest") != man.get("digest"):
        print("  FAIL  the address serves a different build than the one signed here: the deploy did not ship")
    if live.get("commit") != man.get("commit"):
        print(f"  note  commit differs: signed {str(man.get('commit'))[:12]}, served {str(live.get('commit'))[:12]}")
    # THE COMMIT AFTER THE DEPLOY TOO: an address serving a manifest whose commit this history cannot produce is
    # exactly the state this card found live, so `--deployed` must not call it ok. BOTH DOCUMENTS ARE READ, because
    # the digest pair above agreeing says nothing about which tree either one claims: a rebase moves the commit and
    # leaves the digest where it was, which is the whole reason this rule exists. The label names the document that
    # failed, because a served commit the tree cannot produce and a tree commit HEAD cannot produce are two
    # different repairs.
    for label, doc in (("tree manifest", man), ("served manifest", live)):
        bad_commit = commit_problem(doc.get("commit"))
        if bad_commit:
            print(f"  FAIL  {label}: {bad_commit}")
            same = False
    # THE PAGE ADDRESSES TOO: a deploy that ships the mount and not its pages leaves half the app checked. Each is
    # read at `<page>.json`, the address its own manifest claims, and refused when it names another digest.
    for path in PAGE_PATHS:
        purl = base + path + ".json"
        try:
            req = urllib.request.Request(purl, headers={"user-agent": "zpe-attest/1.0 (+https://zpe.vc/answers)"})
            with urllib.request.urlopen(req, timeout=20) as r:
                pman = json.loads(r.read())
        except Exception as exc:
            print(f"  FAIL  page {purl} did not answer a manifest: {exc}")
            same = False
            continue
        if pman.get("digest") != man.get("digest"):
            print(f"  FAIL  page {path} serves {pman.get('digest')} while the build is {man.get('digest')}")
            same = False
        else:
            print(f"  ok    page {path} serves this build's digest")
        # THE SAME RULE ONE LEVEL DOWN: a page manifest is a served document too, so its digest row cannot see a
        # commit that was rebased away either. Ancestry rather than equality: an older ancestor is still a tree a
        # stranger can check out, and the digest row above already decided whether it is this build.
        bad_page = commit_problem(pman.get("commit"))
        if bad_page:
            print(f"  FAIL  page {path} manifest: {bad_page}")
            same = False
    print("deployed: ok, the address serves the build this tree signs" if same else "deployed: FAILED")
    return 0 if same else 1


def main() -> int:
    args = sys.argv[1:]
    if "--verify" in args:
        return verify(args[args.index("--verify") + 1])
    if "--layout" in args:
        state, detail = install_layout()
        print(state)
        if state != "inside":
            print(f"  {detail}")
        return 0 if install_problem() is None else 1
    if "--build" in args:
        if MODE != "build":
            raise SystemExit(f"build: this repo's attest.config.json does not declare mode: build (it says {MODE!r})")
        if "--check" in args:
            return build_check()
        if "--deployed" in args:
            return build_deployed()
        m = build_app(allow_dirty="--allow-dirty" in args)
        print(f"{m['id']:32s} build v{m['version']}  {m['digest'][:19]}…  signed  {str(m['commit'])[:12]}")
        return 0
    if MODE == "build":
        raise SystemExit("page mode: this repo declares mode: build; use --build, --build --check, or --verify")
    if "--all" in args:
        pages = page_files()
    elif "--page" in args:
        pages = [args[args.index("--page") + 1]]
    else:
        raise SystemExit("usage: attest.py --page <page.html> | --all | --verify <url>")
    for p in pages:
        m = build(p)
        print(f"{os.path.basename(p)[:-5]:55s} v{m['version']}  {m['digest'][:19]}…  signed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
