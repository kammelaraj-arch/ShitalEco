"""OTA client — pulls a firmware bundle from the Master and stages it on
flash. Stage 4 will add the signature + base_firmware_version gate; this
slice provides the download + manifest parse + version comparison.
"""
import json
import os

import logger
import trace

try:
    import urequests as requests  # type: ignore
except ImportError:
    try:
        import requests  # type: ignore
    except ImportError:
        requests = None  # type: ignore


def _semver_ge(a, b):
    pa = [int(x) for x in a.split("-")[0].split(".") if x.isdigit()]
    pb = [int(x) for x in b.split("-")[0].split(".") if x.isdigit()]
    while len(pa) < 3: pa.append(0)
    while len(pb) < 3: pb.append(0)
    return pa >= pb


def check_compatibility(manifest, dna):
    if dna.hardware_revision not in manifest.get("supported_hardware_revisions", []):
        return False, "hardware_revision %s not in supported list" % dna.hardware_revision
    min_base = manifest.get("min_supported_base_firmware_version", "0.0.0")
    if not _semver_ge(dna.base_firmware_version, min_base):
        return False, "base_firmware_version %s < min %s" % (dna.base_firmware_version, min_base)
    return True, "ok"


def download_bundle(url, dest_path="bundle.zip"):
    if requests is None:
        return False, "no http client"
    try:
        resp = requests.get(url, timeout=20)
        try:
            if resp.status_code != 200:
                return False, "status %d" % resp.status_code
            with open(dest_path, "wb") as fh:
                fh.write(resp.content)
        finally:
            try:
                resp.close()
            except Exception:
                pass
        return True, dest_path
    except Exception as exc:
        return False, "download failed: %s" % exc


def stage_apply(bundle_path, manifest, dna):
    """Validate compatibility, then write a flag file. Actual swap happens
    at next reboot via ``main.py``'s startup hook."""
    ok, reason = check_compatibility(manifest, dna)
    if not ok:
        trace.add("ota_rejected", reason=reason)
        logger.warn("ota_client", "rejected", reason=reason)
        return False, reason
    try:
        with open("ota.staged", "w") as fh:
            fh.write(json.dumps({"bundle": bundle_path, "manifest": manifest}))
    except OSError as exc:
        return False, str(exc)
    trace.add("ota_staged", target=manifest.get("target_app_bundle_version"))
    return True, "staged"
