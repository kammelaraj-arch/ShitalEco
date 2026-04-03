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

engine = create_async_engine(
    settings.async_database_url,
    echo=settings.APP_ENV == "development",
    pool_size=3,
    max_overflow=2,
    pool_pre_ping=True,
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