"""Parity with the browser engine.

apps/web's parity.test.ts runs the TypeScript pipeline on every CSV in parity/inputs and commits its outcome in
parity/expected. Here the same bytes go through the FastAPI endpoint, and the result must be identical: same
columns and reasons, same normalised values, same messages, same row numbers.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from .conftest import PARITY, RESULT_SCHEMA, Poster, assert_valid

INPUTS = sorted((PARITY / "inputs").glob("*.csv"))
#: What the browser says for these outcomes, and the code the API answers with.
ERROR_CODES = {
    "El archivo está vacío. Sube un CSV con una fila de encabezados y al menos una fila de datos.": "empty_file",
    "El archivo solo tiene la fila de encabezados. Agrega al menos una fila de datos.": "header_only",
}


def test_there_are_fixtures_and_the_sample_is_one_of_them() -> None:
    names = {path.name for path in INPUTS}
    assert len(names) > 5
    assert "clientes-ejemplo.csv" in names


@pytest.mark.parametrize("source", INPUTS, ids=lambda path: path.name)
def test_python_gives_the_browser_result(source: Path, post_file: Poster) -> None:
    expected = json.loads((PARITY / "expected" / f"{source.stem}.json").read_text(encoding="utf-8"))
    response = post_file(source.name, source.read_bytes())
    body = response.json()
    if expected["ok"]:
        assert response.status_code == 200, body
        assert_valid(RESULT_SCHEMA, expected["result"])
        assert body["result"] == expected["result"]
    else:
        assert response.status_code == 422
        assert body == {"error": ERROR_CODES[expected["error"]], "message": expected["error"]}


def test_the_sample_matches_its_documented_counts(post_file: Poster) -> None:
    """sample.ts promises 37 data rows: 20 valid, 11 with errors, 3 duplicates and 3 empty."""
    sample = PARITY / "inputs" / "clientes-ejemplo.csv"
    result = post_file(sample.name, sample.read_bytes()).json()["result"]
    assert result["totalRows"] == 37
    assert (len(result["valid"]), len(result["invalid"]), len(result["duplicates"]), len(result["emptyRows"])) == (
        20,
        11,
        3,
        3,
    )
