"""Configuration from environment variables (documented in the repo's .env.example and in README.md)."""

from __future__ import annotations

import os
from collections.abc import Mapping
from dataclasses import dataclass

from .files import ZipLimits
from .migrator.pipeline import Limits

MB = 1024 * 1024


@dataclass(frozen=True)
class Settings:
    #: Origins allowed by CORS (the site). Empty: no cross-origin access at all.
    cors_origins: tuple[str, ...]
    #: Migrations per minute per client IP.
    rate_limit: int
    #: How many reverse proxies sit in front and append to X-Forwarded-For (Render: 1).
    trusted_proxy_hops: int
    max_upload_bytes: int
    limits: Limits
    zip_limits: ZipLimits
    #: Migrations processed at the same time; the rest wait in line up to `queue_wait_s`.
    max_concurrent: int
    queue_wait_s: float
    #: Memory and time for the subprocess that parses Excel files.
    excel_memory_bytes: int
    excel_timeout_s: float


def _int(env: Mapping[str, str], name: str, default: int, minimum: int = 1) -> int:
    raw = env.get(name, "").strip()
    if not raw:
        return default
    try:
        value = int(raw)
    except ValueError as error:
        raise ValueError(f"{name} must be a whole number, got {raw!r}") from error
    if value < minimum:
        raise ValueError(f"{name} must be at least {minimum}, got {value}")
    return value


def load_settings(env: Mapping[str, str] | None = None) -> Settings:
    source = os.environ if env is None else env
    origins = tuple(
        origin.strip().rstrip("/") for origin in source.get("PYLAB_CORS_ORIGINS", "").split(",") if origin.strip()
    )
    max_upload_mb = _int(source, "PYLAB_MAX_UPLOAD_MB", 10)
    return Settings(
        cors_origins=origins,
        rate_limit=_int(source, "PYLAB_RATE_LIMIT", 20),
        trusted_proxy_hops=_int(source, "PYLAB_TRUSTED_PROXY_HOPS", 1, minimum=0),
        max_upload_bytes=max_upload_mb * MB,
        limits=Limits(
            max_rows=_int(source, "PYLAB_MAX_ROWS", 50_000),
            max_columns=_int(source, "PYLAB_MAX_COLUMNS", 50),
            max_cells=_int(source, "PYLAB_MAX_CELLS", 300_000),
        ),
        zip_limits=ZipLimits(
            max_total=_int(source, "PYLAB_MAX_XLSX_UNCOMPRESSED_MB", 100) * MB, max_entries=500, max_ratio=200
        ),
        max_concurrent=_int(source, "PYLAB_MAX_CONCURRENT", 1),
        queue_wait_s=float(_int(source, "PYLAB_QUEUE_WAIT_SECONDS", 30, minimum=0)),
        excel_memory_bytes=_int(source, "PYLAB_EXCEL_MEMORY_MB", 256) * MB,
        excel_timeout_s=float(_int(source, "PYLAB_EXCEL_TIMEOUT_SECONDS", 90)),
    )
