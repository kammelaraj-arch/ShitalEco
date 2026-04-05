# ─── Python Backend — Multi-stage Docker build ───────────────────────────────
FROM python:3.12-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# ─── Dependencies ─────────────────────────────────────────────────────────────
FROM base AS deps
COPY pyproject.toml ./
RUN pip install hatch && hatch dep show requirements > requirements.txt && pip install -r requirements.txt

# ─── Production ───────────────────────────────────────────────────────────────
FROM base AS production

COPY --from=deps /usr/local/lib/python3.12/site-packages /usr/local/lib/python3.12/site-packages
COPY --from=deps /usr/local/bin /usr/local/bin
COPY . .

RUN pip install -e . --no-deps

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD curl -f http://localhost:8000/health || exit 1

# Run migrations then start server
CMD alembic upgrade head && \
    uvicorn shital.main:app --host 0.0.0.0 --port 8000 \
    --workers 4 --loop uvloop --http httptools
