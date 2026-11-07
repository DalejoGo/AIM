"""Pydantic models of the responses, for the OpenAPI document (/docs).

The source of truth is the Zod contract in packages/contracts/src/migrator.ts; its JSON Schema is generated
into contract/*.schema.json and tests/test_contract.py checks that these models have the same fields. The
endpoint does not serialise through them (orjson writes the dicts the pipeline builds, which is much faster
for large results); pytest validates real responses against the generated JSON Schema instead.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

ColumnType = Literal["email", "phone", "date", "amount", "text"]


class _Model(BaseModel):
    model_config = ConfigDict(extra="forbid")


class MigrationColumn(_Model):
    index: int = Field(ge=0, description="Posición en el archivo.")
    label: str = Field(description="Encabezado tal como venía, sin espacios de más.")
    key: str = Field(min_length=1, description="Nombre normalizado y único (snake_case).")
    type: ColumnType
    titleCase: bool = Field(description="Columnas de nombres o lugares, escritas en formato título.")
    reason: Literal["header", "values", "identifier", "default"] = Field(description="Por qué tiene ese tipo.")
    sampled: int = Field(ge=0, description="Valores no vacíos revisados (hasta 200).")
    matched: int = Field(ge=0, description="Cuántos de ellos coincidieron con el tipo elegido.")


class FieldError(_Model):
    key: str = Field(description="Columna, o vacío cuando el problema es la fila entera.")
    label: str
    message: str = Field(min_length=1, description="Qué está mal y cómo corregirlo, en español.")


class ProcessedRow(_Model):
    rowNumber: int = Field(ge=1, description="Número de fila como lo muestra una hoja de cálculo.")
    raw: dict[str, str]
    clean: dict[str, str | float | None]
    changed: list[str]
    errors: list[FieldError]


class DuplicateRow(_Model):
    rowNumber: int = Field(ge=1)
    duplicateOf: int = Field(ge=1)


class ChangesByType(_Model):
    email: int = Field(ge=0)
    phone: int = Field(ge=0)
    date: int = Field(ge=0)
    amount: int = Field(ge=0)
    text: int = Field(ge=0)


class MigrationResult(_Model):
    delimiter: Literal[",", ";"]
    totalRows: int = Field(ge=0)
    columns: list[MigrationColumn]
    emptyRows: list[int]
    duplicates: list[DuplicateRow]
    valid: list[ProcessedRow]
    invalid: list[ProcessedRow]
    changedCells: int = Field(ge=0)
    changesByType: ChangesByType


class SourceEncoding(_Model):
    name: Literal["utf-8", "utf-16le", "utf-16be", "windows-1252", "ibm850", "macintosh"]
    detectedBy: Literal["bom", "utf-8", "charset-normalizer", "fallback"]


class MigrationSource(_Model):
    name: str
    bytes: int = Field(ge=0)
    format: Literal["csv", "xlsx", "xls"]
    encoding: SourceEncoding | None = Field(description="Solo CSV: cómo se leyó el texto.")
    sheet: str | None = Field(description="Solo Excel: la hoja procesada.")
    sheets: list[str] = Field(description="Solo Excel: las hojas visibles del libro.")


class MigrationTimings(_Model):
    readMs: float = Field(ge=0)
    processMs: float = Field(ge=0)
    totalMs: float = Field(ge=0)


class MigrationEngine(_Model):
    name: Literal["py-lab"]
    version: str
    python: str


class MigrationMeta(_Model):
    source: MigrationSource
    timings: MigrationTimings
    engine: MigrationEngine


class MigrationResponse(_Model):
    result: MigrationResult
    meta: MigrationMeta


class PyLabLimits(_Model):
    maxUploadBytes: int = Field(gt=0)
    maxRows: int = Field(gt=0)
    maxColumns: int = Field(gt=0)
    maxCells: int = Field(gt=0)
    formats: list[Literal["csv", "xlsx", "xls"]]


class PyLabHealth(_Model):
    status: Literal["ok"]
    version: str
    limits: PyLabLimits


class ApiErrorBody(_Model):
    error: str = Field(min_length=1, description="Código estable del error.")
    message: str = Field(min_length=1, description="Explicación en español, segura para mostrar.")
    fields: dict[str, list[str]] | None = Field(default=None, description="Problemas por campo (no se usa aquí).")
