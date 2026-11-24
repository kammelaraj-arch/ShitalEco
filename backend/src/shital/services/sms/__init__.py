"""Pluggable SMS dispatcher. GOV.UK Notify is the default — it's free
for registered UK charities up to 250k messages/year. Twilio stays
available as a fallback for operators who prefer it."""
from .dispatcher import dispatch_sms

__all__ = ["dispatch_sms"]
