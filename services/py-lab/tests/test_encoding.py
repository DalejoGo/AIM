"""CSV text in the encodings Spanish files come in. The browser only knows UTF-8 and Windows-1252."""

from __future__ import annotations

import codecs

import pytest

from py_lab.files import decode_text
from py_lab.migrator.pipeline import MigrationError

from .conftest import Poster

TEXT = (
    "Nombre;Teléfono;Año de ingreso;Ciudad\r\n"
    "Peña Núñez;300 555 0101;01/02/2020;Bogotá\r\n"
    "Ángela Ibáñez;3205550103;2019-07-30;Cúcuta\r\n"
)


@pytest.mark.parametrize(
    ("data", "name", "detected_by"),
    [
        (TEXT.encode(), "utf-8", "utf-8"),
        (codecs.BOM_UTF8 + TEXT.encode(), "utf-8", "bom"),
        (codecs.BOM_UTF16_LE + TEXT.encode("utf-16-le"), "utf-16le", "bom"),
        (codecs.BOM_UTF16_BE + TEXT.encode("utf-16-be"), "utf-16be", "bom"),
        (TEXT.encode("cp1252"), "windows-1252", "charset-normalizer"),
        # DOS-era accounting systems: the browser would show "Pe¤a N£¤ez"; Python reads it right.
        (TEXT.encode("cp850"), "ibm850", "charset-normalizer"),
        (TEXT.encode("mac_roman"), "macintosh", "charset-normalizer"),
    ],
)
def test_text_is_decoded_right(data: bytes, name: str, detected_by: str) -> None:
    decoded = decode_text(data)
    assert decoded.text.lstrip("\ufeff") == TEXT
    assert (decoded.encoding, decoded.detected_by) == (name, detected_by)


def test_windows_1252_bytes_python_leaves_undefined_decode_as_in_browsers() -> None:
    import py_lab.files  # noqa: F401  (registers the "whatwg-c1" error handler)

    assert ("€ Peña".encode("cp1252") + b" \x81\x8d").decode("cp1252", errors="whatwg-c1") == "€ Peña \x81\x8d"


def test_binary_is_not_text() -> None:
    with pytest.raises(MigrationError) as raised:
        decode_text(b"PK\x00\x00\x00binario")
    assert raised.value.code == "unsupported_file"


def test_the_api_reports_the_encoding_and_reads_accents(post_file: Poster) -> None:
    body = post_file("dos.csv", TEXT.encode("cp850")).json()
    assert body["meta"]["source"]["encoding"] == {"name": "ibm850", "detectedBy": "charset-normalizer"}
    assert body["result"]["columns"][1]["key"] == "telefono"
    assert body["result"]["valid"][0]["clean"]["nombre"] == "Peña Núñez"
