"""Every error leaves as the same body as the rest of AIM's APIs (@aim/contracts `ApiError`):
`{ "error": "<code>", "message": "<Spanish, safe to show>" }`. Details of 5xx are logged, never sent."""

from __future__ import annotations

import logging

import orjson
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.responses import Response

from .migrator.pipeline import MigrationError

logger = logging.getLogger("py_lab")

#: Status for each pipeline error code; anything else about the file is 422.
_STATUS = {
    "file_too_large": 413,
    "unsupported_file": 415,
    "unsupported_media_type": 415,
    "invalid_request": 400,
    "rate_limited": 429,
    "busy": 503,
}

_GENERIC = {
    400: ("invalid_request", "La petición no es válida."),
    404: ("not_found", "Esta ruta no existe. Mira la documentación en /docs."),
    405: ("method_not_allowed", "Este método no está permitido en esta ruta."),
    413: ("file_too_large", "El archivo es demasiado grande."),
    415: ("unsupported_media_type", "Envía el archivo como multipart/form-data, en el campo «file»."),
    429: ("rate_limited", "Hiciste demasiadas peticiones. Espera un momento."),
}
INTERNAL = ("internal", "Ocurrió un error inesperado procesando el archivo. Intenta de nuevo en un momento.")


class ApiError(Exception):
    def __init__(self, status: int, code: str, message: str, headers: dict[str, str] | None = None) -> None:
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message
        self.headers = headers or {}


def from_migration_error(error: MigrationError) -> ApiError:
    return ApiError(_STATUS.get(error.code, 422), error.code, error.message)


def error_response(status: int, code: str, message: str, headers: dict[str, str] | None = None) -> Response:
    return Response(
        orjson.dumps({"error": code, "message": message}),
        status_code=status,
        media_type="application/json",
        headers=headers,
    )


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(ApiError)
    async def _api_error(_: Request, error: ApiError) -> Response:
        return error_response(error.status, error.code, error.message, error.headers)

    @app.exception_handler(MigrationError)
    async def _migration_error(_: Request, error: MigrationError) -> Response:
        api = from_migration_error(error)
        return error_response(api.status, api.code, api.message)

    @app.exception_handler(StarletteHTTPException)
    async def _http_error(_: Request, error: StarletteHTTPException) -> Response:
        code, message = _GENERIC.get(error.status_code, ("http_error", "La petición no se pudo atender."))
        return error_response(error.status_code, code, message, dict(error.headers or {}))

    @app.exception_handler(RequestValidationError)
    async def _validation_error(_: Request, __: RequestValidationError) -> Response:
        return error_response(400, *_GENERIC[400])

    @app.exception_handler(Exception)
    async def _unexpected(request: Request, error: Exception) -> Response:
        logger.exception("%s %s failed", request.method, request.url.path, exc_info=error)
        return error_response(500, *INTERNAL)
