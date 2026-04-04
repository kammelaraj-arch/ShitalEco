"""
Database fabric — SQLAlchemy async engine and session management.
Provides a shared async session for all capability modules.
"""
from __future__ import annotations
from typing import AsyncGenerator

import ssl

from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase

from shital.core.fabrics.config import settings


def _build_connect_args() -> dict:
    url = settings.async_database_url
    if "localhost" in url or "127.0.0.1" in url:
        return {}
    # Remote Postgres (Render): use SSL but skip cert verification (managed certs)
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    return {"ssl": ctx}


engine = create_async_engine(
    settings.async_database_url,
    echo=settings.APP_ENV == "development",
    pool_size=3,
    max_overflow=2,
    pool_pre_ping=True,
    connect_args=_build_connect_args(),
)

SessionLocal = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)


class Base(DeclarativeBase):
    pass


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """FastAPI dependency that yields an async database session."""
    async with SessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise