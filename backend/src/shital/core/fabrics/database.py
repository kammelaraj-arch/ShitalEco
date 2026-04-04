"""
Database fabric — SQLAlchemy async engine and session management.
Provides a shared async session for all capability modules.
"""
from __future__ import annotations
import ssl
from typing import AsyncGenerator

from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase

from shital.core.fabrics.config import settings

# asyncpg requires an SSLContext, not the libpq string "require".
# Render's managed Postgres cert chain may not match the default CA bundle,
# so we disable hostname/cert verification.
_ssl_ctx = ssl.create_default_context()
_ssl_ctx.check_hostname = False
_ssl_ctx.verify_mode = ssl.CERT_NONE

engine = create_async_engine(
    settings.async_database_url,
    echo=settings.APP_ENV == "development",
    pool_size=3,
    max_overflow=2,
    pool_pre_ping=True,
    connect_args={"ssl": _ssl_ctx},
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