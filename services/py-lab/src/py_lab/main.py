"""FastAPI app of py-lab: `GET /health`, `POST /v1/migrations` and the OpenAPI docs at `/docs`.

Run locally with `uv run uvicorn py_lab.main:app --app-dir src --reload` (README.md). Nothing is stored: the
upload lives in memory for the duration of the request and is gone when the answer leaves.
"""

from __future__ import annotations

import asyncio
import base64
import ctypes
import ctypes.util
import gc
import hashlib
import logging
import platform
import re
from collections.abc import Iterator
from contextlib import contextmanager
from time import perf_counter
from typing import Any

import anyio.to_thread
import orjson
from fastapi import FastAPI, Request
from fastapi.middleware import Middleware
from starlette.background import BackgroundTask
from starlette.datastructures import MutableHeaders
from starlette.middleware.cors import CORSMiddleware
from starlette.middleware.gzip import GZipMiddleware
from starlette.responses import HTMLResponse, Response
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from . import __version__
from .errors import ApiError, error_response, from_migration_error, install_error_handlers
from .excel import read_workbook
from .files import EXTENSIONS, check_name, decode_text, sniff
from .migrator.pipeline import MigrationError, migrate, read_csv
from .models import ApiErrorBody, MigrationResponse, PyLabHealth
from .ratelimit import RateLimiter, client_ip
from .settings import Settings, load_settings
from .upload import FILE_FIELD, SHEET_FIELD, read_upload

logger = logging.getLogger("py_lab")

MIGRATIONS_PATH = "/v1/migrations"
MAX_SHEET_NAME = 255
FORMATS = sorted(set(EXTENSIONS.values()))

#: Headers on every answer. The API only returns JSON: nothing may run, frame or be cached on the way.
SECURITY_HEADERS = {
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Strict-Transport-Security": "max-age=31536000",
    "Cache-Control": "no-store",
}

# --- Swagger UI, pinned and checked by Subresource Integrity (swagger-ui-dist 5.34.0, as apps/api) ----------
_SWAGGER = "https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.34.0"
_SWAGGER_JS_SRI = "sha384-9Td7MKiIr2S83E1kZyyVi8KdJw/S8CpAvu0llLyMeg0xq/hDGiZJfVn0fV4llCmK"
_SWAGGER_CSS_SRI = "sha384-4c3vsE5f+trhFyHrFrLM1fFGUn531NIaC7dcqEWIJdoRQJ5CkJbSuSCwXLpaS1KF"
_DOCS_SCRIPT = "SwaggerUIBundle({url: '/openapi.json', dom_id: '#swagger-ui', deepLinking: true})"
_DOCS_SCRIPT_HASH = base64.b64encode(hashlib.sha256(_DOCS_SCRIPT.encode()).digest()).decode()
DOCS_HTML = f"""<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>py-lab · Migrador de datos (FastAPI)</title>
<link rel="stylesheet" href="{_SWAGGER}/swagger-ui.css" integrity="{_SWAGGER_CSS_SRI}" crossorigin="anonymous">
</head>
<body>
<div id="swagger-ui"></div>
<script src="{_SWAGGER}/swagger-ui-bundle.js" integrity="{_SWAGGER_JS_SRI}" crossorigin="anonymous"></script>
<script>{_DOCS_SCRIPT}</script>
</body>
</html>
"""
#: Swagger UI sets style attributes from JavaScript, so this page (and only this one) allows inline styles.
DOCS_CSP = (
    f"default-src 'none'; script-src https://cdn.jsdelivr.net 'sha256-{_DOCS_SCRIPT_HASH}'; "
    "style-src https://cdn.jsdelivr.net 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; "
    "frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
)

DESCRIPTION = """
Versión en Python del **Migrador de datos** del Lab de AIM. Recibe un CSV o un libro de Excel, detecta el
tipo de cada columna, normaliza correos, teléfonos (E.164), fechas (ISO 8601), montos y nombres, quita
duplicados y separa las filas válidas de las que tienen errores, con el motivo en español.

Aplica **las mismas reglas que la versión del navegador** (TypeScript), y una prueba de paridad lo verifica
en cada cambio. Además lee Excel (.xlsx y .xls), detecta la codificación de los CSV (UTF-8, Windows-1252,
CP850…) y acepta archivos más grandes.

**Nada se guarda**: el archivo vive en memoria mientras dura la petición. Los errores siguen la forma
`{ "error": "<código>", "message": "<explicación>" }`.
""".strip()


class SecurityHeadersMiddleware:
    """Adds SECURITY_HEADERS to every response that does not set them itself (the docs page sets its CSP)."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        async def send_with_headers(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = MutableHeaders(scope=message)
                for name, value in SECURITY_HEADERS.items():
                    headers.setdefault(name, value)
            await send(message)

        await self.app(scope, receive, send_with_headers)


_UNSAFE_NAME = re.compile(r"[\x00-\x1f\x7f]")


def display_name(filename: str) -> str:
    """The file name without any folder a browser or client may send ("C:\\fakepath\\x.csv"), trimmed."""
    base = re.split(r"[\\/]", filename)[-1]
    return _UNSAFE_NAME.sub("", base).strip()[:MAX_SHEET_NAME] or "archivo"


def _ms(seconds: float) -> float:
    return round(seconds * 1000, 1)


def _load_libc() -> ctypes.CDLL | None:
    name = ctypes.util.find_library("c")
    try:
        libc = ctypes.CDLL(name) if name else None
    except OSError:
        return None
    return libc if libc is not None and hasattr(libc, "malloc_trim") else None


_LIBC = _load_libc()


def release_memory() -> None:
    """Hands the memory of the last migration back to the system once its answer has left (glibc only).
    The image runs with PYTHONMALLOC=malloc, so Python's objects live in malloc's heap and this returns them;
    with Python's own allocator, a 512 MB instance kept growing by a few MB after every large file."""
    # A refused file leaves its rows in an exception's traceback (a reference cycle): collect them first.
    gc.collect()
    if _LIBC is not None:
        _LIBC.malloc_trim(0)


@contextmanager
def no_cyclic_gc() -> Iterator[None]:
    """The pipeline builds hundreds of thousands of small dicts and lists with no reference cycles; the cyclic
    collector would scan them over and over for nothing (about 20 % of the time). Reference counting still frees
    everything; the collector is back on as soon as the answer is ready."""
    enabled = gc.isenabled()
    gc.disable()
    try:
        yield
    finally:
        if enabled:
            gc.enable()


def process(
    data: bytes, filename: str, sheet: str | None, settings: Settings, received_at: float
) -> tuple[bytes, dict[str, float]]:
    """Reads, migrates and serialises. Runs in a worker thread so the event loop keeps answering /health."""
    with no_cyclic_gc():
        return _process(data, filename, sheet, settings, received_at)


def _process(
    data: bytes, filename: str, sheet: str | None, settings: Settings, received_at: float
) -> tuple[bytes, dict[str, float]]:
    source_format = sniff(data)
    encoding: dict[str, str] | None = None
    sheets: list[str] = []
    sheet_name: str | None = None
    if source_format == "csv":
        decoded = decode_text(data)
        encoding = {"name": decoded.encoding, "detectedBy": decoded.detected_by}
        read = read_csv(decoded.text, settings.limits)
    else:
        workbook = read_workbook(
            data,
            source_format,
            sheet,
            limits=settings.limits,
            zip_limits=settings.zip_limits,
            memory_bytes=settings.excel_memory_bytes,
            timeout_s=settings.excel_timeout_s,
        )
        read, sheets, sheet_name = workbook.read, workbook.sheets, workbook.sheet
    read_done = perf_counter()
    result = orjson.dumps(migrate(read))
    done = perf_counter()
    timings = {
        "readMs": _ms(read_done - received_at),
        "processMs": _ms(done - read_done),
        "totalMs": _ms(done - received_at),
    }
    meta: dict[str, Any] = {
        "source": {
            "name": filename,
            "bytes": len(data),
            "format": source_format,
            "encoding": encoding,
            "sheet": sheet_name,
            "sheets": sheets,
        },
        "timings": timings,
        "engine": {"name": "py-lab", "version": __version__, "python": platform.python_version()},
    }
    return b'{"result":' + result + b',"meta":' + orjson.dumps(meta) + b"}", timings


def create_app(settings: Settings | None = None) -> FastAPI:
    config = settings or load_settings()
    limiter = RateLimiter(config.rate_limit)
    slots = asyncio.Semaphore(config.max_concurrent)

    app = FastAPI(
        title="py-lab · Migrador de datos",
        version=__version__,
        description=DESCRIPTION,
        docs_url=None,
        redoc_url=None,
        redirect_slashes=False,
        telemetry={"tracing": False, "metrics": False, "logs": False},
        middleware=[
            Middleware(SecurityHeadersMiddleware),
            Middleware(
                CORSMiddleware,
                allow_origins=list(config.cors_origins),
                allow_methods=["GET", "POST"],
                allow_headers=[],
                expose_headers=[
                    "Server-Timing",
                    "Retry-After",
                    "X-RateLimit-Limit",
                    "X-RateLimit-Remaining",
                    "X-RateLimit-Reset",
                ],
                max_age=3600,
            ),
            # Level 3: on 0.1 CPU it compresses a 36 MB answer to 4.3 MB in a third of the time level 6 takes.
            Middleware(GZipMiddleware, minimum_size=1024, compresslevel=3),
        ],
    )
    install_error_handlers(app)

    def limits() -> dict[str, Any]:
        return {
            "maxUploadBytes": config.max_upload_bytes,
            "maxRows": config.limits.max_rows,
            "maxColumns": config.limits.max_columns,
            "maxCells": config.limits.max_cells,
            "formats": FORMATS,
        }

    @app.get("/", include_in_schema=False)
    async def root() -> Response:
        return Response(
            orjson.dumps({"service": "py-lab", "docs": "/docs", "health": "/health"}), media_type="application/json"
        )

    @app.get("/docs", include_in_schema=False)
    async def docs() -> HTMLResponse:
        return HTMLResponse(DOCS_HTML, headers={"Content-Security-Policy": DOCS_CSP})

    @app.get(
        "/health",
        response_model=PyLabHealth,
        summary="Estado y límites",
        description="Responde en cuanto el servicio está arriba. El sitio la llama para despertarlo (Render lo "
        "duerme tras 15 minutos sin uso) y para conocer los límites antes de enviar un archivo.",
        tags=["servicio"],
    )
    async def health() -> Response:
        body = {"status": "ok", "version": __version__, "limits": limits()}
        return Response(orjson.dumps(body), media_type="application/json")

    error_responses: dict[int | str, dict[str, Any]] = {
        status: {"model": ApiErrorBody, "description": description}
        for status, description in {
            400: "Petición mal formada (sin archivo, multipart inválido).",
            413: "El archivo supera el tamaño máximo.",
            415: "No es un CSV ni un libro de Excel.",
            422: "El archivo no se puede migrar (vacío, demasiadas filas, hoja inexistente…).",
            429: "Demasiadas peticiones desde tu conexión; mira Retry-After.",
            503: "El servidor está ocupado con otro archivo; mira Retry-After.",
        }.items()
    }

    @app.post(
        MIGRATIONS_PATH,
        response_model=None,
        summary="Migrar un archivo",
        description=(
            "Envía el archivo como `multipart/form-data` en el campo `file` (.csv, .xlsx o .xls; el tipo se "
            "decide por el contenido). Para un libro con varias hojas, `sheet` elige cuál procesar; sin él se "
            "usa la primera hoja con datos y la respuesta lista todas en `meta.source.sheets`."
        ),
        tags=["migraciones"],
        responses={200: {"model": MigrationResponse, "description": "Resultado de la migración."}, **error_responses},
        openapi_extra={
            "requestBody": {
                "required": True,
                "content": {
                    "multipart/form-data": {
                        "schema": {
                            "type": "object",
                            "required": [FILE_FIELD],
                            "properties": {
                                FILE_FIELD: {"type": "string", "format": "binary", "description": "CSV o Excel."},
                                SHEET_FIELD: {
                                    "type": "string",
                                    "maxLength": MAX_SHEET_NAME,
                                    "description": "Solo Excel: nombre de la hoja.",
                                },
                            },
                        }
                    }
                },
            }
        },
    )
    async def create_migration(request: Request) -> Response:
        response = await migrate_upload(request)
        # Whatever the outcome, the memory the file used goes back to the system once the answer is out.
        response.background = BackgroundTask(release_memory)
        return response

    async def migrate_upload(request: Request) -> Response:
        decision = limiter.check(
            client_ip(
                request.client.host if request.client else None,
                request.headers.get("x-forwarded-for"),
                config.trusted_proxy_hops,
            )
        )
        rate_headers = decision.headers()
        if not decision.allowed:
            return error_response(
                429,
                "rate_limited",
                f"Hiciste demasiadas peticiones. Intenta de nuevo en {decision.reset_s} s.",
                rate_headers,
            )
        try:
            upload = await read_upload(
                request.headers.get("content-type", ""),
                request.headers.get("content-length"),
                request.stream(),
                config.max_upload_bytes,
            )
            filename = display_name(upload.filename)
            check_name(filename)
            sheet = upload.fields.get(SHEET_FIELD, "").strip() or None
            if sheet is not None and len(sheet) > MAX_SHEET_NAME:
                raise ApiError(400, "invalid_request", "El nombre de la hoja es demasiado largo.")
            try:
                # A free slot is taken at once; otherwise wait in line up to the configured time.
                await (
                    asyncio.wait_for(slots.acquire(), timeout=config.queue_wait_s)
                    if slots.locked()
                    else slots.acquire()
                )
            except TimeoutError as error:
                raise ApiError(
                    503,
                    "busy",
                    "El servidor está procesando otros archivos. Intenta de nuevo en unos segundos.",
                    {"Retry-After": "10"},
                ) from error
            try:
                body, timings = await anyio.to_thread.run_sync(
                    process, upload.data, filename, sheet, config, perf_counter()
                )
            finally:
                slots.release()
        except MigrationError as error:
            api = from_migration_error(error)
            return error_response(api.status, api.code, api.message, rate_headers)
        except ApiError as error:
            return error_response(error.status, error.code, error.message, {**rate_headers, **error.headers})
        except Exception:
            # Answered here, inside the CORS middleware, so the site can read it.
            logger.exception("POST %s failed", MIGRATIONS_PATH)
            return error_response(
                500,
                "internal",
                "Ocurrió un error inesperado procesando el archivo. Intenta de nuevo en un momento.",
                rate_headers,
            )
        server_timing = ", ".join(
            f"{name};dur={timings[key]}"
            for name, key in (("read", "readMs"), ("process", "processMs"), ("total", "totalMs"))
        )
        return Response(body, media_type="application/json", headers={**rate_headers, "Server-Timing": server_timing})

    return app


app = create_app()
