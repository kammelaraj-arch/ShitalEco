"""Validate that every shipped manifest passes the Stage 1 validator."""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path


def test_validate_manifests_strict(repo_root: Path):
    result = subprocess.run(
        [sys.executable, "tools/validate_manifests.py", "--root", ".", "--strict"],
        cwd=repo_root,
        capture_output=True,
        text=True,
        timeout=60,
    )
    assert result.returncode == 0, (
        f"validator failed:\nSTDOUT:\n{result.stdout}\nSTDERR:\n{result.stderr}"
    )
    assert "OK:" in result.stdout
    # Sanity: at least 22 stock manifests + 3 new-library seeds.
    assert "Manifests scanned: 25" in result.stdout, result.stdout
