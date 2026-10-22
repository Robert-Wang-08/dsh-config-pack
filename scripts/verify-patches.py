#!/usr/bin/env python3
"""Verify that the patches this pack declares are actually applied in a profile.

Run after the pack is installed. Exits non-zero when a declared patch stopped
applying, which happens when a patched upstream package changes version.

Usage:
    python verify-patches.py <profile-dir>            # report and check
    python verify-patches.py <profile-dir> --quiet    # exit code only
"""
import sys
from pathlib import Path


def declared_patches(workspace_yaml: Path):
    """Return {package@version: patch-path} from pnpm-workspace.yaml."""
    text = workspace_yaml.read_text(encoding="utf-8")
    mapping = {}
    in_block = False
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        if line.startswith("patchedDependencies:"):
            in_block = True
            continue
        if in_block:
            if not line.startswith((" ", "\t")):
                in_block = False
                continue
            if ":" not in stripped:
                continue
            key, _, value = stripped.partition(":")
            mapping[key.strip().strip("'\"")] = value.strip().strip("'\"")
    return mapping


def main(argv):
    if not argv:
        print("usage: verify-patches.py <profile-dir>", file=sys.stderr)
        return 2
    profile = Path(argv[0]).expanduser()
    quiet = "--quiet" in argv
    workspace = profile / "pnpm-workspace.yaml"
    if not workspace.is_file():
        print("FAIL: no pnpm-workspace.yaml in " + str(profile))
        return 1

    patches = declared_patches(workspace)
    if not patches:
        print("FAIL: no patchedDependencies declared; patches are not being applied")
        return 1

    failures = []
    for key, rel in sorted(patches.items()):
        if not quiet:
            print("declared: " + key + " -> " + rel)
        patch_file = profile / rel
        if not patch_file.is_file():
            failures.append("patch file missing: " + str(patch_file))
            continue
        # The patch must already be applied: pnpm removes it from the store copy
        # and the installed package carries the changed lines.
        name = key.rsplit("@", 1)[0]
        target = profile / "node_modules" / name
        if not target.is_dir():
            failures.append("package not installed: " + name)
            continue
        body = ""
        for candidate in target.rglob("*.js"):
            try:
                body += candidate.read_text(encoding="utf-8", errors="replace")
            except OSError:
                continue
        if "causeDetail" not in body:
            failures.append("patch marker absent in installed " + name)
            continue
        if not quiet:
            print("  OK applied")

    if failures:
        print("FAIL")
        for f in failures:
            print("  " + f)
        return 1
    print("PASS: all declared patches are applied")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))