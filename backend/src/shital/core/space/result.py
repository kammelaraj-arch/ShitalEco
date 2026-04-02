"""Result monad for type-safe error handling across all capabilities."""
from __future__ import annotations
from dataclasses import dataclass
from typing import Generic, TypeVar, Callable, Awaitable

T = TypeVar("T")
E = TypeVar("E", bound=Exception)


@dataclass(frozen=True)
class Ok(Generic[T]):
    value: T
    ok: bool = True


@dataclass(frozen=True)
class Err(Generic[E]):
    error: E
    ok: bool = False


Result = Ok[T] | Err[E]


def ok(value: T) -> Ok[T]:
    return Ok(value=value)


def err(error: E) -> Err[E]:
    return Err(error=error)


async def try_async(fn: Callable[[], Awaitable[T]]) -> Result[T, Exception]:
    try:
        return ok(await fn())
    except Exception as e:
        return err(e)
