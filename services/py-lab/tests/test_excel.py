"""Excel workbooks (.xlsx built with openpyxl, a committed .xls) and the ZIP bomb guard."""

from __future__ import annotations

import datetime as dt
import io
import struct
import zipfile
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from py_lab.main import create_app
from py_lab.migrator.papaparse import guess_line_endings, parse
from py_lab.migrator.pipeline import detect_delimiter

from .conftest import ERROR_SCHEMA, PARITY, Poster, assert_valid, make_settings, workbook_bytes

FIXTURES = Path(__file__).resolve().parent / "fixtures"
XLSX = "clientes.xlsx"


def records_of(name: str) -> list[list[str]]:
    text = (PARITY / "inputs" / name).read_bytes().decode()
    return parse(text, detect_delimiter(text), guess_line_endings(text)).data


@pytest.mark.parametrize("name", ["muchas-filas.csv", "comas-crlf.csv"])
def test_a_workbook_gives_the_same_result_as_its_csv(name: str, post_file: Poster) -> None:
    """Same cells as text in a sheet: same columns, values, messages and row numbers (only the separator of the
    clean CSV differs, since a workbook has none and the comma is used)."""
    source = PARITY / "inputs" / name
    from_csv = post_file(name, source.read_bytes()).json()["result"]
    from_excel = post_file(XLSX, workbook_bytes({"Datos": records_of(name)}))
    assert from_excel.status_code == 200, from_excel.json()
    body = from_excel.json()
    assert body["result"] == {**from_csv, "delimiter": ","}
    assert body["meta"]["source"] == {
        "name": XLSX,
        "bytes": body["meta"]["source"]["bytes"],
        "format": "xlsx",
        "encoding": None,
        "sheet": "Datos",
        "sheets": ["Datos"],
    }


def test_typed_cells_become_the_text_a_person_would_type(post_file: Poster) -> None:
    rows: list[list[Any]] = [
        ["Nombre", "Fecha", "Monto", "Celular", "Activo"],
        ["ana gómez", dt.date(2024, 4, 3), 1200000.5, 3005550101, True],
        ["luis ruiz", dt.datetime(2024, 4, 5, 10, 30), 850000, "300 555 0102", False],
    ]
    result = post_file(XLSX, workbook_bytes({"Clientes": rows})).json()["result"]
    first, second = result["valid"]
    assert first["raw"] == {
        "nombre": "ana gómez",
        "fecha": "2024-04-03",
        "monto": "1200000.5",
        "celular": "3005550101",
        "activo": "VERDADERO",
    }
    assert first["clean"] == {
        "nombre": "Ana Gómez",
        "fecha": "2024-04-03",
        "monto": 1200000.5,
        "celular": "+573005550101",
        "activo": "VERDADERO",
    }
    assert second["raw"]["fecha"] == "2024-04-05 10:30:00"
    assert second["clean"]["fecha"] == "2024-04-05"
    assert second["clean"]["monto"] == 850000


def test_row_numbers_are_the_sheets_own(post_file: Poster) -> None:
    rows: list[list[Any]] = [["correo"], ["ana@example.com"], [None], ["no-es-correo"]]
    result = post_file(XLSX, workbook_bytes({"Hoja1": rows}, start_row=3)).json()["result"]
    assert [row["rowNumber"] for row in result["valid"]] == [4]
    assert result["emptyRows"] == [5]
    assert [row["rowNumber"] for row in result["invalid"]] == [6]


def test_it_picks_the_first_sheet_with_data_and_lists_the_visible_ones(post_file: Poster) -> None:
    book = workbook_bytes(
        {
            "Portada": [["Informe de clientes"]],
            "Clientes": [["nombre", "correo"], ["Ana", "ana@example.com"]],
            "Proveedores": [["nombre", "nit"], ["Acme", "900.123.456"]],
            "Interna": [["x"], ["y"]],
        },
        hidden=("Interna",),
    )
    body = post_file(XLSX, book).json()
    assert body["meta"]["source"]["sheets"] == ["Portada", "Clientes", "Proveedores"]
    assert body["meta"]["source"]["sheet"] == "Clientes"

    chosen = post_file(XLSX, book, sheet="Proveedores").json()
    assert chosen["meta"]["source"]["sheet"] == "Proveedores"
    assert [column["key"] for column in chosen["result"]["columns"]] == ["nombre", "nit"]

    missing = post_file(XLSX, book, sheet="Interna")
    assert missing.status_code == 422
    assert missing.json() == {
        "error": "sheet_not_found",
        "message": "El libro no tiene una hoja «Interna». Hojas disponibles: «Portada», «Clientes», «Proveedores».",
    }


def test_an_empty_sheet_says_so(post_file: Poster) -> None:
    book = workbook_bytes({"Vacía": [], "Datos": [["a"], ["1"]]})
    response = post_file(XLSX, book, sheet="Vacía")
    assert response.status_code == 422
    assert response.json()["message"] == "La hoja «Vacía» está vacía. Elige otra hoja del libro."
    only_empty = post_file(XLSX, workbook_bytes({"Vacía": []}))
    assert only_empty.json() == {"error": "empty_file", "message": "El libro no tiene ninguna hoja con datos."}


def test_legacy_xls_workbooks_are_read(post_file: Poster) -> None:
    body = post_file("clientes.xls", (FIXTURES / "clientes.xls").read_bytes()).json()
    source = body["meta"]["source"]
    assert (source["format"], source["sheets"], source["sheet"]) == ("xls", ["Notas", "Clientes"], "Clientes")
    result = body["result"]
    assert [column["type"] for column in result["columns"]] == ["text", "email", "phone", "date", "amount"]
    assert result["valid"][0]["clean"] == {
        "nombre": "Peña Núñez",
        "correo": "pena@example.com",
        "telefono": "+573005550101",
        "fecha_de_registro": "2024-04-03",
        "saldo": 1200000.5,
    }
    assert result["invalid"][0]["errors"][0]["key"] == "correo"


def test_the_content_decides_not_the_name(post_file: Poster) -> None:
    """A workbook renamed to .csv is still read as a workbook; CSV text named .xlsx is read as text."""
    book = workbook_bytes({"Hoja1": [["a"], ["1"]]})
    assert post_file("datos.csv", book).json()["meta"]["source"]["format"] == "xlsx"
    assert post_file("datos.xlsx", b"a;b\n1;2\n").json()["meta"]["source"]["format"] == "csv"


def test_sheet_limits_are_enforced_before_reading_the_cells() -> None:
    with TestClient(create_app(make_settings(PYLAB_MAX_ROWS="3", PYLAB_MAX_COLUMNS="2"))) as client:
        tall = workbook_bytes({"Hoja1": [["n"], *[[str(i)] for i in range(5)]]})
        response = client.post("/v1/migrations", files={"file": (XLSX, tall)})
        assert response.status_code == 422
        assert response.json() == {
            "error": "too_many_rows",
            "message": "La hoja «Hoja1» tiene 5 filas y el límite de esta demo es 3. "
            "Divídela en partes y súbelas por separado.",
        }
        wide = workbook_bytes({"Hoja1": [["a", "b", "c"], ["1", "2", "3"]]})
        assert client.post("/v1/migrations", files={"file": (XLSX, wide)}).json()["error"] == "too_many_columns"


# --- ZIP bombs and broken files -----------------------------------------------------------------------------


def _zip(parts: dict[str, bytes]) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for name, data in parts.items():
            archive.writestr(name, data)
    return buffer.getvalue()


def _workbook_parts(**extra: bytes) -> dict[str, bytes]:
    with zipfile.ZipFile(io.BytesIO(workbook_bytes({"Hoja1": [["a"], ["1"]]}))) as archive:
        parts = {name: archive.read(name) for name in archive.namelist()}
    return {**parts, **extra}


def test_a_zip_bomb_is_refused_before_parsing(post_file: Poster) -> None:
    bomb = _zip(_workbook_parts(**{"xl/media/bomba.xml": b"\0" * (120 * 1024 * 1024)}))
    assert len(bomb) < 1024 * 1024
    response = post_file(XLSX, bomb)
    assert response.status_code == 422
    assert response.json()["error"] == "excel_too_large"


def test_a_part_that_lies_about_its_size_is_refused(post_file: Poster) -> None:
    """The headers say 1 KB, the data inflates to 8 MB: the guard counts what really comes out."""
    real = 8 * 1024 * 1024
    data = bytearray(_zip(_workbook_parts(**{"xl/media/mentira.bin": b"A" * real})))
    with zipfile.ZipFile(io.BytesIO(bytes(data))) as archive:
        info = archive.getinfo("xl/media/mentira.bin")
    struct.pack_into("<I", data, info.header_offset + 22, 1024)  # local header: uncompressed size
    name = info.filename.encode()
    central = data.index(b"PK\x01\x02")
    while data[central + 46 : central + 46 + len(name)] != name:
        central = data.index(b"PK\x01\x02", central + 4)
    struct.pack_into("<I", data, central + 24, 1024)  # central directory: uncompressed size
    response = post_file(XLSX, bytes(data))
    assert response.status_code == 422
    assert response.json()["error"] == "excel_too_large"


def test_a_zip_that_is_not_a_workbook_is_unsupported(post_file: Poster) -> None:
    response = post_file("informe.xlsx", _zip({"word/document.xml": b"<w:document/>", "[Content_Types].xml": b"<x/>"}))
    assert response.status_code == 415
    assert response.json()["error"] == "unsupported_file"


def test_broken_workbooks_get_a_clear_message(post_file: Poster) -> None:
    response = post_file(XLSX, b"PK\x03\x04" + b"\x00" * 200)
    assert response.status_code == 422
    assert response.json()["error"] == "unreadable_file"
    ole = post_file("viejo.xls", b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1" + b"\x00" * 600)
    assert ole.status_code == 422
    assert ole.json()["error"] in {"unreadable_file", "excel_too_large"}


def test_a_sheet_whose_range_would_not_fit_in_memory_stops_in_the_worker() -> None:
    """Two cells far apart make calamine allocate the whole rectangle between them (here 26 x 1,000,000).
    The worker's memory cap stops it; the API answers instead of being killed for memory."""
    from openpyxl import Workbook

    book = Workbook()
    sheet = book.active
    assert sheet is not None
    sheet["A1"] = "a"
    sheet["Z1000000"] = "z"
    buffer = io.BytesIO()
    book.save(buffer)
    with TestClient(create_app(make_settings(PYLAB_EXCEL_MEMORY_MB="128"))) as client:
        response = client.post("/v1/migrations", files={"file": (XLSX, buffer.getvalue())})
    assert response.status_code == 422, response.json()
    assert_valid(ERROR_SCHEMA, response.json())
    assert response.json()["error"] == "excel_too_large"
