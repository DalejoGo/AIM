from __future__ import annotations

import io
import json
from collections.abc import Callable, Iterator
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from jsonschema import Draft202012Validator
from openpyxl import Workbook

from py_lab.main import create_app
from py_lab.settings import Settings, load_settings

ROOT = Path(__file__).resolve().parent.parent
CONTRACT = ROOT / "contract"
PARITY = Path(__file__).resolve().parent / "parity"
SITE = "https://aim.test"

#: Settings for tests: generous rate limit, the site's origin allowed, no queue wait.
TEST_ENV = {"PYLAB_CORS_ORIGINS": SITE, "PYLAB_RATE_LIMIT": "1000", "PYLAB_QUEUE_WAIT_SECONDS": "5"}


def validator(name: str) -> Draft202012Validator:
    schema = json.loads((CONTRACT / name).read_text(encoding="utf-8"))
    Draft202012Validator.check_schema(schema)
    return Draft202012Validator(schema)


RESPONSE_SCHEMA = validator("migration-response.schema.json")
RESULT_SCHEMA = validator("migration-result.schema.json")
ERROR_SCHEMA = validator("error.schema.json")
HEALTH_SCHEMA = validator("health.schema.json")


def assert_valid(schema: Draft202012Validator, body: Any) -> None:
    errors = sorted(schema.iter_errors(body), key=lambda error: list(error.path))
    assert not errors, "\n".join(f"{list(error.path)}: {error.message}" for error in errors[:5])


def make_settings(**env: str) -> Settings:
    return load_settings({**TEST_ENV, **env})


@pytest.fixture
def settings() -> Settings:
    return make_settings()


@pytest.fixture
def client(settings: Settings) -> Iterator[TestClient]:
    with TestClient(create_app(settings)) as test_client:
        yield test_client


Poster = Callable[..., Any]


@pytest.fixture
def post_file(client: TestClient) -> Poster:
    """POSTs one file to /v1/migrations and returns the response; every body is checked against the contract."""

    def post(name: str, data: bytes, sheet: str | None = None, **kwargs: Any) -> Any:
        fields = {"sheet": sheet} if sheet is not None else None
        response = client.post("/v1/migrations", files={"file": (name, data)}, data=fields, **kwargs)
        assert_valid(RESPONSE_SCHEMA if response.status_code == 200 else ERROR_SCHEMA, response.json())
        return response

    return post


def workbook_bytes(sheets: dict[str, list[list[Any]]], *, hidden: tuple[str, ...] = (), start_row: int = 1) -> bytes:
    """An .xlsx built with openpyxl: one sheet per entry, rows written from `start_row`."""
    book = Workbook()
    if book.active is not None:
        book.remove(book.active)
    for name, rows in sheets.items():
        sheet = book.create_sheet(name)
        for offset, row in enumerate(rows):
            for column, value in enumerate(row, start=1):
                if value is not None:
                    sheet.cell(row=start_row + offset, column=column, value=value)
        if name in hidden:
            sheet.sheet_state = "hidden"
    buffer = io.BytesIO()
    book.save(buffer)
    return buffer.getvalue()


def csv_rows(text: str, delimiter: str = ";") -> list[list[str]]:
    return [line.split(delimiter) for line in text.splitlines()]
