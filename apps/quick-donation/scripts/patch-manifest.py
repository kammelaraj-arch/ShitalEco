#!/usr/bin/env python3
"""Idempotent AndroidManifest.xml patcher for the Quick Donation Android wrapper.

Capacitor regenerates AndroidManifest.xml from a template every time you run
`npx cap add android`, so we can't check the file into git — instead, this
script applies the fullscreen-kiosk tweaks *after* generation. Re-running is
safe (no-ops if the manifest is already patched).

Inputs:
    --manifest  path to apps/quick-donation/android/app/src/main/AndroidManifest.xml
    --snippet   path to android-kiosk-overlay/AndroidManifest.kiosk-snippet.xml

Unlike the main Kiosk patcher this does NOT insert boot or device-admin
receivers — Quick Donation is also installed on devotees' personal phones
and must not grab device-owner rights there.
"""
from __future__ import annotations

import argparse
import re
from pathlib import Path


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--manifest", required=True, type=Path)
    ap.add_argument("--snippet",  required=True, type=Path)
    args = ap.parse_args()

    manifest_text = args.manifest.read_text()
    snippet_text  = args.snippet.read_text()

    # Strip comments from the snippet before any regex match. The doc comment
    # at the top contains `<uses-permission` and `<activity` literally; without
    # this step the comment body would be matched as real elements.
    snippet_text = re.sub(r"<!--[\s\S]*?-->", "", snippet_text)

    # Sentinel: the launchMode on our replacement MainActivity. If present,
    # the manifest already carries the fullscreen tweaks.
    if 'android:launchMode="singleTask"' in manifest_text:
        print("  manifest already patched — no changes")
        return 0

    # 1) <uses-permission> additions
    perm_pattern = re.compile(r'<uses-permission\s+android:name="([^"]+)"\s*/>')
    snippet_perms = perm_pattern.findall(snippet_text)
    existing_perms = set(perm_pattern.findall(manifest_text))
    new_perm_lines = [
        f'    <uses-permission android:name="{p}" />'
        for p in snippet_perms if p not in existing_perms
    ]
    if new_perm_lines:
        manifest_text = re.sub(
            r"(\n\s*<application\b)",
            "\n" + "\n".join(new_perm_lines) + r"\1",
            manifest_text,
            count=1,
        )

    # 2) Replace the existing <activity android:name=".MainActivity"> block
    mainact_match = re.search(
        r'<activity\s+[^>]*android:name="\.MainActivity"[\s\S]*?</activity>',
        manifest_text,
    )
    snippet_mainact = re.search(
        r'<activity\s+[^>]*android:name="\.MainActivity"[\s\S]*?</activity>',
        snippet_text,
    )
    if not (mainact_match and snippet_mainact):
        raise SystemExit("Could not locate MainActivity block in manifest or snippet")
    manifest_text = (
        manifest_text[: mainact_match.start()]
        + snippet_mainact.group(0)
        + manifest_text[mainact_match.end() :]
    )

    args.manifest.write_text(manifest_text)
    print(f"  patched {args.manifest}")
    print(f"    + {len(new_perm_lines)} permissions")
    print(f"    + replaced MainActivity with fullscreen block")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
