"""Smoke tests — basic sanity checks that don't require a database."""


def test_placeholder() -> None:
    """Placeholder — real integration tests require a running DB."""
    assert True


def test_python_version() -> None:
    import sys
    assert sys.version_info >= (3, 11)
