"""Excel workbooks: ZIP bomb guard, then the sheet is read by excel_worker.py in a capped subprocess."""

from __future__ import annotations

import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import orjson

from .files import NOT_A_WORKBOOK, TOO_BIG_INSIDE, SourceFormat, ZipLimits, check_xlsx
from .migrator.jstext import format_count
from .migrator.pipeline import Limits, MigrationError, ReadResult, read_records

WORKER = Path(__file__).with_name("excel_worker.py")


@dataclass
class SheetRead:
    read: ReadResult
    sheets: list[str]
    sheet: str


def _error(answer: dict[str, Any], limits: Limits) -> MigrationError:
    code = str(answer.get("code"))
    sheet = answer.get("sheet")
    sheets = answer.get("sheets") or []
    if code == "protected_file":
        return MigrationError(code, "El libro tiene contraseña. Quítasela en Excel y súbelo de nuevo.")
    if code == "sheet_not_found":
        options = ", ".join(f"«{name}»" for name in sheets) or "ninguna"
        return MigrationError(code, f"El libro no tiene una hoja «{sheet}». Hojas disponibles: {options}.")
    if code == "empty_sheet":
        return MigrationError("empty_file", f"La hoja «{sheet}» está vacía. Elige otra hoja del libro.")
    if code == "empty_file":
        return MigrationError(code, "El libro no tiene ninguna hoja con datos.")
    if code == "too_many_rows":
        return MigrationError(
            code,
            f"La hoja «{sheet}» tiene {format_count(int(answer.get('rows', 0)))} filas y el límite de esta demo "
            f"es {format_count(limits.max_rows)}. Divídela en partes y súbelas por separado.",
        )
    if code == "too_many_columns":
        return MigrationError(
            code,
            f"La hoja «{sheet}» tiene {format_count(int(answer.get('columns', 0)))} columnas y el límite de esta "
            f"demo es {format_count(limits.max_columns)}. Quita las columnas que no necesites.",
        )
    if code == "too_many_cells":
        return MigrationError(
            code,
            f"La hoja «{sheet}» tiene más de {format_count(limits.max_cells)} celdas, el límite de esta demo. "
            "Divídela en partes o quita las columnas que no necesites.",
        )
    if code == "excel_too_large":
        return MigrationError(code, TOO_BIG_INSIDE)
    return MigrationError("unreadable_file", NOT_A_WORKBOOK)


def read_workbook(
    data: bytes,
    source_format: SourceFormat,
    sheet: str | None,
    *,
    limits: Limits,
    zip_limits: ZipLimits,
    memory_bytes: int,
    timeout_s: float,
) -> SheetRead:
    if source_format == "xlsx":
        check_xlsx(data, zip_limits)
    options = {
        "sheet": sheet,
        "maxRows": limits.max_rows,
        "maxColumns": limits.max_columns,
        "maxCells": limits.max_cells,
        "memoryBytes": memory_bytes,
    }
    try:
        done = subprocess.run(  # noqa: S603 - fixed interpreter and script, options as one JSON argument
            [sys.executable, "-I", str(WORKER), orjson.dumps(options).decode()],
            input=data,
            capture_output=True,
            timeout=timeout_s,
            check=False,
        )
    except subprocess.TimeoutExpired as error:
        raise MigrationError(
            "excel_too_slow",
            "El libro tardó demasiado en leerse. Guarda solo la hoja que necesitas en un libro nuevo, "
            "o súbela como CSV.",
        ) from error
    if done.returncode != 0 or not done.stdout:
        # Killed for memory (or a crash in the native parser): the file is too big or broken.
        raise MigrationError("excel_too_large", TOO_BIG_INSIDE)
    answer: dict[str, Any] = orjson.loads(done.stdout)
    if not answer.get("ok"):
        raise _error(answer, limits)
    rows: list[list[str]] = answer["rows"]
    read = read_records(rows, ",", limits, first_row_number=int(answer["firstRow"]))
    return SheetRead(read=read, sheets=list(answer["sheets"]), sheet=str(answer["sheet"]))
