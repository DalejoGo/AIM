# py-lab (FastAPI) for Render's free plan: 512 MB of RAM and 0.1 CPU. Build with this folder as the context:
#   docker build -t aim-pylab services/py-lab
# Images pinned by digest (DEC-002: both pushed more than 14 days ago).
# python:3.12.15-slim-trixie, pushed 2026-10-21. uv 0.8.23, released 2025-10-04 (same version as CI).
# The official Docker Hub image through AWS's public mirror (same digest): Render's shared build IPs hit Docker Hub's
# anonymous pull limit.
ARG PYTHON_IMAGE=public.ecr.aws/docker/library/python:3.12.15-slim-trixie@sha256:a0f57064cbdcd6285fa45f51237ab0b35ea8ebaed06a1f5973e89e19dfb86704
ARG UV_IMAGE=ghcr.io/astral-sh/uv:0.8.23@sha256:94390f20a83e2de83f63b2dadcca2efab2e6798f772edab52bf545696c86bdb4

FROM ${UV_IMAGE} AS uv

# --- build: exact dependencies from uv.lock (no dev tools), bytecode compiled ahead of time ----------------
FROM ${PYTHON_IMAGE} AS build
COPY --from=uv /uv /usr/local/bin/uv
# Compiled .pyc files save the cold start from compiling every module on 0.1 CPU.
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never \
    UV_PROJECT_ENVIRONMENT=/app/.venv
WORKDIR /app
COPY pyproject.toml uv.lock .python-version ./
# --frozen: install exactly what uv.lock says (it fails instead of resolving again).
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev --no-install-project
COPY src ./src
RUN python -m compileall -q src

# --- runtime: the virtualenv and the code, no uv, unprivileged user ---------------------------------------
FROM ${PYTHON_IMAGE} AS runtime
# PYTHONMALLOC=malloc + malloc_trim after each answer (src/py_lab/main.py) keep the idle memory flat between
# large files (measured: Python's own allocator kept growing after each one), at about 25 % more CPU.
# MALLOC_ARENA_MAX=2: fewer per-thread heaps, less memory held by the thread pool.
ENV PATH=/app/.venv/bin:$PATH \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONMALLOC=malloc \
    MALLOC_ARENA_MAX=2
RUN useradd --system --uid 10001 --no-create-home --shell /usr/sbin/nologin pylab
WORKDIR /app
COPY --from=build /app/.venv /app/.venv
COPY --from=build /app/src /app/src
USER pylab
EXPOSE 8000
# Render sets PORT. --proxy-headers with '*' only makes the scheme right behind Render's TLS proxy; the rate
# limit reads X-Forwarded-For itself (PYLAB_TRUSTED_PROXY_HOPS, see src/py_lab/ratelimit.py). No access log:
# it would record visitors' IP addresses.
CMD ["sh", "-c", "exec uvicorn py_lab.main:app --app-dir src --host 0.0.0.0 --port \"${PORT:-8000}\" --proxy-headers --forwarded-allow-ips='*' --no-server-header --no-access-log --limit-concurrency 32 --timeout-graceful-shutdown 10"]
