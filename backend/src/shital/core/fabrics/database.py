"""
Database fabric — SQLAlchemy async engine and session management.
Provides a shared async session for all capability modules.
"""
from __future__ import annotations

import re as _re
from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase

from shital.core.fabrics.config import settings

# Use SSL only when connecting to a remote/cloud database.
# Skip SSL for local or Docker connections (no dots in hostname = Docker service name).
_db_url = settings.async_database_url
_host_match = _re.search(r'@([^:/]+)', _db_url)
_host = _host_match.group(1) if _host_match else ''
_use_ssl = '.' in _host  # e.g. db.render.com → SSL; postgres/localhost → no SSL

engine = create_async_engine(
    _db_url,
    echo=settings.APP_ENV == "development",
    pool_size=10,
    max_overflow=5,
    pool_pre_ping=False,
    pool_recycle=1800,
    connect_args={"ssl": True} if _use_ssl else {},
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
