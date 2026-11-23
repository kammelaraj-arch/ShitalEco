"""Shared marketing helpers used by send paths and the campaigns UI.

The preference centre router (`api.routers.marketing_prefs`) owns the
schema and the signed URLs; this package carries pure-function helpers
every send path imports (compliance footer, opt-in gate wrappers).
"""
