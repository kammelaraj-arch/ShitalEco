#!/usr/bin/env python3
"""Idempotent AndroidManifest.xml patcher for the Shital Kiosk Android wrapper.

Capacitor regenerates AndroidManifest.xml from a template every time you run
`npx cap add android`, so we can't check the file into git — instead, this
script applies the kiosk-specific elements *after* generation. Re-running is
safe (no-ops if our boot receiver is already there).

Inputs:
    --manifest  path to apps/kiosk/android/app/src/main/AndroidManifest.xml
    --snippet   path to android-kiosk-overlay/AndroidManifest.kiosk-snippet.xml

The snippet file is fragments (not a full document); we parse it by injecting
a wrapper element so xml.etree can handle it, then walk the children.
"""
from __future__ import annotations

import argparse
import re
from pathlib import Path

NS = "http://schemas.android.com/apk/res/android"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--manifest", required=True, type=Path)
    ap.add_argument("--snippet",  required=True, type=Path)
    args = ap.parse_args()

    manifest_text = args.manifest.read_text()
    snippet_text  = args.snippet.read_text()

    # The snippet starts with a multi-line <!-- ... --> doc comment whose
    # text happens to mention `<activity android:name=".MainActivity">` and
    # `<receiver>` literally. Because the regexes below treat the file as
    # plain text (not XML), they were matching INSIDE the comment, swallowing
    # the doc text as the "MainActivity block" and producing malformed XML
    # — silently for the patcher (it printed "patched"), but the Android
    # manifest merger then failed with "Error parsing AndroidManifest.xml"
    # on every build for over a month. Strip XML comments up front.
    snippet_text = re.sub(r"<!--[\s\S]*?-->", "", snippet_text)

    if "KioskBootReceiver" in manifest_text:
        print("  manifest already patched — no changes")
        return 0

    # --- 1) Add <uses-permission> elements before <application> ---------------
    # Extract every <uses-permission … /> line from the snippet that isn't
    # already present in the manifest, then insert them right before the
    # opening <application> tag.
    perm_pattern = re.compile(
        r'<uses-permission\s+android:name="([^"]+)"\s*/>'
    )
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

    # --- 2) Replace the existing <activity android:name=".MainActivity"> -----
    # block with the kiosk-mode one from the snippet. We match from the
    # opening <activity … MainActivity to its matching </activity>.
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

    # --- 3) Insert the two receiver blocks before </application> -------------
    receivers = re.findall(r"<receiver[\s\S]*?</receiver>", snippet_text)
    if not receivers:
        raise SystemExit("No <receiver> blocks found in snippet")
    receiver_xml = "\n\n        ".join(receivers)
    manifest_text = manifest_text.replace(
        "</application>",
        f"        {receiver_xml}\n    </application>",
        1,
    )

    args.manifest.write_text(manifest_text)
    print(f"  patched {args.manifest}")
    print(f"    + {len(new_perm_lines)} permissions")
    print(f"    + replaced MainActivity with kiosk-mode block")
    print(f"    + {len(receivers)} receivers")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
