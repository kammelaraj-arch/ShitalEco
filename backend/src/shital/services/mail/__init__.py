"""Pluggable mail dispatcher.

Picks a provider from settings / environment and hands every send
through one function (`dispatch_email`). Provider choice is per-call
override-able so transactional sends can stay on Office365 while
marketing / bulk goes through SES — which is Phase 1c's pattern.
"""
from .dispatcher import dispatch_email

__all__ = ["dispatch_email"]
