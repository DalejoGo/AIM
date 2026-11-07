"""Reads one sheet of an Excel workbook (.xlsx or .xls) with python-calamine, in a separate process.

Run by excel.py as `python -I excel_worker.py '<json options>'`, with the workbook on stdin. It answers one
JSON object on stdout. Running apart from the server means a hostile or broken workbook can only hurt this
process: it caps its own memory (RLIMIT_AS) before touching the file, the parent kills it after a timeout,
and a crash in the native parser does not take the API down.

Self-contained on purpose (stdlib, orjson and python-calamine only): `-I` leaves the project off sys.path.
"""

from __future__ import annotations

import datetime as dt
import io
import resource
import sys
from typing import Any

import orjson
from python_calamine import (
    CalamineError,
    CalamineSheet,
    CalamineWorkbook,
    PasswordError,
    SheetTypeEnum,
    SheetVisibleEnum,
    WorksheetNotFound,
)

Cell = int | float | str | bool | dt.time | dt.date | dt.datetime | dt.timedelta | None


def cell_text(value: Cell) -> str:
    """A cell as the text a person would type: whole numbers without ".0", dates as ISO."""
    if value is None or value == "":
        return ""
    if isinstance(value, str):
        return value
    if isinstance(value, bool):
        return "VERDADERO" if value else "FALSO"
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float):
        if value.is_integer() and abs(value) < 1e15:
            return str(int(value))
        text = f"{value:.15g}"  # Excel shows 15 significant digits
        return text if "e" not in text else repr(value)
    if isinstance(value, dt.datetime):
        if value.time() == dt.time():
            return value.date().isoformat()
        return value.isoformat(sep=" ", timespec="seconds")
    if isinstance(value, dt.date):
        return value.isoformat()
    if isinstance(value, dt.time):
        return value.isoformat(timespec="seconds")
    return str(value)


def _limit_memory(budget: int) -> None:
    """Address space = what the interpreter already maps + `budget`. Linux only (Docker, Render)."""
    try:
        with open("/proc/self/status", encoding="ascii") as status:
            size_kb = next(int(line.split()[1]) for line in status if line.startswith("VmSize:"))
    except (OSError, StopIteration, ValueError):
        return
    limit = size_kb * 1024 + budget
    resource.setrlimit(resource.RLIMIT_AS, (limit, limit))


def _fail(code: str, sheets: list[str] | None = None, **detail: Any) -> dict[str, Any]:
    return {"ok": False, "code": code, "sheets": sheets or [], **detail}


def read(data: bytes, options: dict[str, Any]) -> dict[str, Any]:
    requested: str | None = options.get("sheet")
    try:
        workbook = CalamineWorkbook.from_filelike(io.BytesIO(data))
    except PasswordError:
        return _fail("protected_file")
    except (CalamineError, ValueError, OSError):
        return _fail("unreadable_file")
    with workbook:
        sheets = [
            meta.name
            for meta in workbook.sheets_metadata
            if meta.typ == SheetTypeEnum.WorkSheet and meta.visible == SheetVisibleEnum.Visible
        ]
        if requested is not None and requested not in sheets:
            return _fail("sheet_not_found", sheets, sheet=requested)
        if requested is not None:
            return _read_sheet(workbook, requested, sheets, options, explicit=True)
        # Default: the first sheet with a header and at least one row; else the first one with anything.
        fallback: str | None = None
        for name in sheets:
            try:
                sheet = workbook.get_sheet_by_name(name)
            except CalamineError:
                return _fail("unreadable_file", sheets)
            if sheet.start is None or sheet.height == 0:
                continue
            if sheet.height >= 2:
                return _read_sheet(workbook, name, sheets, options, explicit=False, loaded=sheet)
            fallback = fallback or name
        if fallback is not None:
            return _read_sheet(workbook, fallback, sheets, options, explicit=False)
        return _fail("empty_file", sheets)


def _read_sheet(
    workbook: CalamineWorkbook,
    name: str,
    sheets: list[str],
    options: dict[str, Any],
    *,
    explicit: bool,
    loaded: CalamineSheet | None = None,
) -> dict[str, Any]:
    try:
        sheet = loaded or workbook.get_sheet_by_name(name)
    except WorksheetNotFound:
        return _fail("sheet_not_found", sheets, sheet=name)
    except CalamineError:
        return _fail("unreadable_file", sheets)
    if sheet.start is None or sheet.height == 0:
        return _fail("empty_sheet" if explicit else "empty_file", sheets, sheet=name)
    height, width = sheet.height, sheet.width
    if height - 1 > options["maxRows"]:
        return _fail("too_many_rows", sheets, sheet=name, rows=height - 1)
    if width > options["maxColumns"]:
        return _fail("too_many_columns", sheets, sheet=name, columns=width)
    if (height - 1) * width > options["maxCells"]:
        return _fail("too_many_cells", sheets, sheet=name)
    rows = [[cell_text(value) for value in row] for row in sheet.to_python(skip_empty_area=True)]
    return {"ok": True, "sheets": sheets, "sheet": name, "firstRow": sheet.start[0] + 1, "rows": rows}


def main() -> None:
    options = orjson.loads(sys.argv[1])
    _limit_memory(int(options["memoryBytes"]))
    data = sys.stdin.buffer.read()
    try:
        answer = read(data, options)
    except MemoryError:
        answer = _fail("excel_too_large")
    sys.stdout.buffer.write(orjson.dumps(answer))


if __name__ == "__main__":
    main()
