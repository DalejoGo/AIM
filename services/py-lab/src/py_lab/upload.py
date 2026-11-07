"""Reads the multipart upload as it streams in, in memory only.

FastAPI's `UploadFile` spools anything over 1 MB to a temporary file on disk; this service promises that no
file is ever written, so the body is parsed here with python-multipart's push parser into a `bytearray`, and
the size limit is enforced chunk by chunk: an oversized upload is refused as soon as it crosses the limit,
without reading the rest.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from dataclasses import dataclass, field

from python_multipart.exceptions import MultipartParseError
from python_multipart.multipart import MultipartParser, parse_options_header

from .errors import ApiError
from .migrator.jstext import format_count

#: Room for the multipart boundaries, part headers and the small text fields around the file.
ENVELOPE_BYTES = 16 * 1024
MAX_TEXT_FIELD = 1024
MAX_PARTS = 5
FILE_FIELD = "file"
SHEET_FIELD = "sheet"


def _megabytes(size: int) -> str:
    return f"{format_count(round(size / (1024 * 1024)))} MB"


def too_large(max_bytes: int) -> ApiError:
    return ApiError(
        413,
        "file_too_large",
        f"El archivo supera el límite de {_megabytes(max_bytes)}. Divídelo en partes más pequeñas o quita las "
        "columnas que no necesites.",
    )


@dataclass
class _Part:
    headers: dict[str, bytes] = field(default_factory=dict)
    name: str = ""
    filename: str | None = None
    data: bytearray = field(default_factory=bytearray)


@dataclass
class Upload:
    filename: str
    data: bytes
    fields: dict[str, str]


class _Collector:
    def __init__(self, max_bytes: int) -> None:
        self.max_bytes = max_bytes
        self.parts: list[_Part] = []
        self._part = _Part()
        self._header_field = bytearray()
        self._header_value = bytearray()

    def on_part_begin(self) -> None:
        if len(self.parts) >= MAX_PARTS:
            raise ApiError(400, "invalid_request", "La petición trae demasiados campos.")
        self._part = _Part()

    def on_header_field(self, data: bytes, start: int, end: int) -> None:
        self._header_field += data[start:end]

    def on_header_value(self, data: bytes, start: int, end: int) -> None:
        self._header_value += data[start:end]

    def on_header_end(self) -> None:
        self._part.headers[bytes(self._header_field).decode("latin-1").lower()] = bytes(self._header_value)
        self._header_field.clear()
        self._header_value.clear()

    def on_headers_finished(self) -> None:
        disposition, options = parse_options_header(self._part.headers.get("content-disposition", b""))
        if disposition != b"form-data" or b"name" not in options:
            raise ApiError(400, "invalid_request", "Cada campo del formulario necesita un nombre.")
        self._part.name = options[b"name"].decode("utf-8", errors="replace")
        if b"filename" in options:
            self._part.filename = options[b"filename"].decode("utf-8", errors="replace")

    def on_part_data(self, data: bytes, start: int, end: int) -> None:
        part = self._part
        part.data += data[start:end]
        if part.filename is not None:
            if len(part.data) > self.max_bytes:
                raise too_large(self.max_bytes)
        elif len(part.data) > MAX_TEXT_FIELD:
            raise ApiError(400, "invalid_request", f"El campo «{part.name}» es demasiado largo.")

    def on_part_end(self) -> None:
        self.parts.append(self._part)


async def read_upload(
    content_type: str, content_length: str | None, body: AsyncIterator[bytes], max_bytes: int
) -> Upload:
    """Parses `multipart/form-data` with one file in `file` and optional short text fields (`sheet`)."""
    media_type, params = parse_options_header(content_type)
    boundary = params.get(b"boundary")
    if media_type != b"multipart/form-data" or not boundary:
        raise ApiError(415, "unsupported_media_type", "Envía el archivo como multipart/form-data, en el campo «file».")
    if content_length is not None:
        try:
            declared = int(content_length)
        except ValueError as error:
            raise ApiError(400, "invalid_request", "La cabecera Content-Length no es válida.") from error
        if declared > max_bytes + ENVELOPE_BYTES:
            raise too_large(max_bytes)

    collector = _Collector(max_bytes)
    try:
        parser = MultipartParser(
            boundary,
            {
                "on_part_begin": collector.on_part_begin,
                "on_header_field": collector.on_header_field,
                "on_header_value": collector.on_header_value,
                "on_header_end": collector.on_header_end,
                "on_headers_finished": collector.on_headers_finished,
                "on_part_data": collector.on_part_data,
                "on_part_end": collector.on_part_end,
            },
        )
        received = 0
        async for chunk in body:
            received += len(chunk)
            if received > max_bytes + ENVELOPE_BYTES:
                raise too_large(max_bytes)
            parser.write(chunk)
        parser.finalize()
    except MultipartParseError as error:
        raise ApiError(
            400, "invalid_request", "El cuerpo de la petición no es un multipart/form-data válido."
        ) from error

    files = [part for part in collector.parts if part.filename is not None]
    file = next((part for part in files if part.name == FILE_FIELD), None)
    if file is None or len(files) > 1:
        raise ApiError(400, "invalid_request", "Envía exactamente un archivo, en el campo «file».")
    fields = {
        part.name: part.data.decode("utf-8", errors="replace") for part in collector.parts if part.filename is None
    }
    return Upload(filename=(file.filename or "").strip() or "archivo", data=bytes(file.data), fields=fields)
