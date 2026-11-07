"""The migration pipeline (pipeline.ts): read, detect columns, normalise, drop duplicates, validate, split.

`read_csv` turns text into records exactly as the browser does; `read_records` accepts records from any
source (an Excel sheet), and `migrate` builds the same `MigrationResult` the browser builds, as plain dicts
ready for JSON.

Normalising and validating depend only on the column and the cell text, so each distinct value is worked
out once per column and reused: files repeat cities, dates and amounts a lot.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any, Literal

from .infer import ColumnType, infer_column, sample_values
from .jstext import clean_text, format_count, is_blank, js_number_to_string, js_trim
from .normalize import (
    amount_from_clean,
    date_from_clean,
    email_from_clean,
    normalize_header,
    phone_from_clean,
    to_title_case,
    unique_keys,
)
from .papaparse import guess_delimiter, guess_line_endings, parse
from .validate import CleanValue, validate_cell

Delimiter = Literal[",", ";"]
DELIMITERS: tuple[Delimiter, ...] = (",", ";")

EMPTY_FILE = "El archivo está vacío. Sube un CSV con una fila de encabezados y al menos una fila de datos."
HEADER_ONLY = "El archivo solo tiene la fila de encabezados. Agrega al menos una fila de datos."


class MigrationError(Exception):
    """A problem with the file itself, explained in Spanish. `code` is the API error code."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass(frozen=True)
class Limits:
    max_rows: int
    max_columns: int
    max_cells: int


@dataclass
class SourceRow:
    #: Row number as a spreadsheet shows it (the first line of the file is row 1).
    row_number: int
    fields: list[str]
    #: PapaParse found an unbalanced quote in this row.
    broken_quotes: bool = False


@dataclass
class ReadResult:
    delimiter: Delimiter
    header: list[str]
    header_row: int
    rows: list[SourceRow]


def detect_delimiter(text: str) -> Delimiter:
    """Comma or semicolon. PapaParse guesses from the first rows; when it cannot tell, the header decides:
    whichever separator it has more of, outside quotes. Ties go to comma."""
    guess = guess_delimiter(text, guess_line_endings(text), DELIMITERS)
    if guess == ";":
        return ";"
    if guess == ",":
        return ","
    header = next((line for line in re.split(r"\r?\n", text) if js_trim(line) != ""), "")
    header = re.sub(r'"[^"]*"', "", header)
    return ";" if header.count(";") > header.count(",") else ","


def is_empty_record(fields: list[str]) -> bool:
    return all(is_blank(value) for value in fields)


def read_csv(text: str, limits: Limits) -> ReadResult:
    """Step 1. Parses the text, comma or semicolon separated. The first non-empty row is the header."""
    source = text[1:] if text.startswith("\ufeff") else text
    delimiter = detect_delimiter(source)
    newline = guess_line_endings(source)
    # Cheap guards before building every record in memory (the exact checks come after parsing).
    lines = source.count(newline)
    if lines > limits.max_rows * 3:
        raise MigrationError(
            "too_many_rows",
            f"El archivo tiene más de {format_count(limits.max_rows * 3)} líneas y el límite de esta demo es "
            f"{format_count(limits.max_rows)} filas. Divídelo en partes y súbelas por separado.",
        )
    if source.count(delimiter) + lines > limits.max_cells * 3:
        raise _too_many_cells(limits)

    parsed = parse(source, delimiter, newline)
    broken = {error.row for error in parsed.errors}
    return read_records(parsed.data, delimiter, limits, broken_quotes=broken)


def read_records(
    records: list[list[str]],
    delimiter: Delimiter,
    limits: Limits,
    *,
    broken_quotes: set[int] | None = None,
    first_row_number: int = 1,
) -> ReadResult:
    """Finds the header and the data rows. `first_row_number` is the spreadsheet row of `records[0]`."""
    # A final line break leaves one empty record behind; it is not a row of the file.
    if records and len(records[-1]) == 1 and records[-1][0] == "":
        records.pop()

    header_index = next((i for i, record in enumerate(records) if not is_empty_record(record)), -1)
    if header_index < 0:
        raise MigrationError("empty_file", EMPTY_FILE)
    header = records[header_index]
    data_count = len(records) - header_index - 1
    if data_count == 0:
        raise MigrationError("header_only", HEADER_ONLY)
    if data_count > limits.max_rows:
        raise MigrationError(
            "too_many_rows",
            f"El archivo tiene {format_count(data_count)} filas y el límite de esta demo es "
            f"{format_count(limits.max_rows)}. Divídelo en partes y súbelas por separado.",
        )
    if len(header) > limits.max_columns:
        raise MigrationError(
            "too_many_columns",
            f"El archivo tiene {format_count(len(header))} columnas y el límite de esta demo es "
            f"{format_count(limits.max_columns)}. Quita las columnas que no necesites.",
        )
    if data_count * len(header) > limits.max_cells:
        raise _too_many_cells(limits)

    broken = broken_quotes or set()
    offset = first_row_number - 1
    rows = [
        SourceRow(index + 1 + offset, records[index], index in broken)
        for index in range(header_index + 1, len(records))
    ]
    return ReadResult(delimiter, header, header_index + 1 + offset, rows)


def _too_many_cells(limits: Limits) -> MigrationError:
    return MigrationError(
        "too_many_cells",
        f"El archivo tiene más de {format_count(limits.max_cells)} celdas, el límite de esta demo. "
        "Divídelo en partes o quita las columnas que no necesites.",
    )


@dataclass
class Column:
    index: int
    label: str
    key: str
    type: ColumnType
    title_case: bool
    reason: str
    sampled: int
    matched: int

    def as_json(self) -> dict[str, Any]:
        return {
            "index": self.index,
            "label": self.label,
            "key": self.key,
            "type": self.type,
            "titleCase": self.title_case,
            "reason": self.reason,
            "sampled": self.sampled,
            "matched": self.matched,
        }


def detect_columns(header: list[str], rows: list[list[str]]) -> list[Column]:
    """Step 2. Normalises the headers into unique keys and infers each column's type from a sample."""
    keys = unique_keys([normalize_header(label, i) for i, label in enumerate(header)])
    columns: list[Column] = []
    for index, label in enumerate(header):
        # Only the sampled values need cleaning: which ones are sampled depends on how many are not blank.
        filled = [fields[index] for fields in rows if index < len(fields) and not is_blank(fields[index])]
        inference = infer_column(keys[index], [clean_text(value) for value in sample_values(filled)])
        columns.append(Column(index, clean_text(label), keys[index], *inference))
    return columns


def normalize_value(column: Column, raw: str) -> CleanValue:
    """Step 3, per cell. Empty cells become None."""
    text = clean_text(raw)
    if not text:
        return None
    if column.type == "email":
        return email_from_clean(text)
    if column.type == "phone":
        return phone_from_clean(text)
    if column.type == "date":
        return date_from_clean(text)
    if column.type == "amount":
        return amount_from_clean(text)
    return to_title_case(text) if column.title_case else text


def _as_string(value: CleanValue) -> str:
    """`String(value ?? '')` in JavaScript."""
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    return js_number_to_string(value)


def _as_json_number(value: CleanValue) -> CleanValue:
    """Whole amounts go out as JSON integers (1200000, not 1200000.0), as JavaScript writes them."""
    if isinstance(value, float) and value.is_integer() and abs(value) < 2**53:
        return int(value)
    return value


#: What one distinct raw value becomes in a column: clean value, whether it changed, validation message.
_Cell = tuple[CleanValue, bool, str | None]


def _work_out(column: Column, raw: str) -> _Cell:
    clean = normalize_value(column, raw)
    changed = _as_string(clean) != raw
    return _as_json_number(clean), changed, validate_cell(column.type, clean)


def structural_error(row: SourceRow, column_count: int) -> dict[str, str] | None:
    """Problems with the shape of the row itself: wrong number of fields or a quote left open."""
    label = "Fila"
    if row.broken_quotes:
        return {
            "key": "",
            "label": label,
            "message": "Hay comillas sin cerrar en esta fila. Revisa que cada comilla que abre tenga su pareja.",
        }
    fields = row.fields
    last_filled = next((i for i in range(len(fields) - 1, -1, -1) if not is_blank(fields[i])), -1)
    if last_filled >= column_count:
        return {
            "key": "",
            "label": label,
            "message": (
                f"La fila tiene {last_filled + 1} campos con datos y el encabezado tiene {column_count}. "
                "Revisa si sobra un separador, por ejemplo una coma dentro de un monto sin comillas."
            ),
        }
    if len(fields) < column_count:
        return {
            "key": "",
            "label": label,
            "message": (
                f"La fila tiene {len(fields)} campos y el encabezado tiene {column_count}. "
                "Revisa si falta un separador entre dos valores."
            ),
        }
    return None


def _column_cells(column: Column, rows: list[SourceRow]) -> list[_Cell]:
    """Steps 3 and 4 for one column, every row. Each distinct raw value is worked out once."""
    index = column.index
    values = [row.fields[index] if index < len(row.fields) else "" for row in rows]
    cells = {value: _work_out(column, value) for value in dict.fromkeys(values)}
    return [cells[value] for value in values]


def migrate(read: ReadResult) -> dict[str, Any]:
    """Runs steps 2 to 5 on what was read and returns the MigrationResult (contract: @aim/contracts/migrator).

    Works column by column (normalise and validate each distinct value once), then puts each row together
    with zip(), so most of the per-cell work happens in C."""
    empty_rows: list[int] = []
    filled: list[SourceRow] = []
    for row in read.rows:
        if is_empty_record(row.fields):
            empty_rows.append(row.row_number)
        else:
            filled.append(row)

    columns = detect_columns(read.header, [row.fields for row in filled])
    column_count = len(columns)
    keys = [column.key for column in columns]
    labels = [column.label or column.key for column in columns]

    changes_by_type: dict[ColumnType, int] = {"email": 0, "phone": 0, "date": 0, "amount": 0, "text": 0}
    clean_columns: list[list[CleanValue]] = []
    changed_columns: list[list[bool]] = []
    error_columns: list[list[str | None]] = []
    for column in columns:
        cells = _column_cells(column, filled)
        clean_columns.append([cell[0] for cell in cells])
        changed_columns.append([cell[1] for cell in cells])
        error_columns.append([cell[2] for cell in cells])
        changes_by_type[column.type] += sum(changed_columns[-1])
    changed_cells = sum(changes_by_type.values())

    seen: dict[tuple[CleanValue, ...], int] = {}
    duplicates: list[dict[str, int]] = []
    valid: list[dict[str, Any]] = []
    invalid: list[dict[str, Any]] = []
    padding = [""] * column_count

    for source, clean_values, changed_flags, messages in zip(
        filled,
        zip(*clean_columns, strict=True),
        zip(*changed_columns, strict=True),
        zip(*error_columns, strict=True),
        strict=True,
    ):
        fields = source.fields
        raw = dict(zip(keys, fields if len(fields) >= column_count else [*fields, *padding], strict=False))
        processed: dict[str, Any] = {
            "rowNumber": source.row_number,
            "raw": raw,
            "clean": dict(zip(keys, clean_values, strict=True)),
            "changed": [key for key, flag in zip(keys, changed_flags, strict=True) if flag],
            "errors": [],
        }
        # A row with exactly one field per column and balanced quotes cannot have a structural problem.
        exact = len(fields) == column_count and not source.broken_quotes
        problem = None if exact else structural_error(source, column_count)
        if problem is not None:
            processed["errors"] = [problem]
            invalid.append(processed)
            continue
        first = seen.get(clean_values)
        if first is not None:
            duplicates.append({"rowNumber": source.row_number, "duplicateOf": first})
            continue
        seen[clean_values] = source.row_number
        if any(messages):
            processed["errors"] = [
                {"key": key, "label": label, "message": message}
                for key, label, message in zip(keys, labels, messages, strict=True)
                if message is not None
            ]
            invalid.append(processed)
        else:
            valid.append(processed)

    return {
        "delimiter": read.delimiter,
        "totalRows": len(read.rows),
        "columns": [column.as_json() for column in columns],
        "emptyRows": empty_rows,
        "duplicates": duplicates,
        "valid": valid,
        "invalid": invalid,
        "changedCells": changed_cells,
        "changesByType": changes_by_type,
    }


def run_migration(text: str, limits: Limits) -> dict[str, Any]:
    """The whole pipeline on CSV text. Raises MigrationError with the browser's message when the file is unusable."""
    return migrate(read_csv(text, limits))
