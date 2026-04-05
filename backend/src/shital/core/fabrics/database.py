"""
Database fabric — SQLAlchemy async engine and session management.
Provides a shared async session for all capability modules.
"""
from __future__ import annotations
from typing import AsyncGenerator

from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase

from shital.core.fabrics.config import settings

# Use SSL only when connecting to a remote database (not local Docker Postgres)
_db_url = settings.async_database_url
_use_ssl = "@db:" not in _db_url and "localhost" not in _db_url and "127.0.0.1" not in _db_url

engine = create_async_engine(
    _db_url,
    echo=settings.APP_ENV == "development",
    pool_size=3,
    max_overflow=2,
    pool_pre_ping=True,
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