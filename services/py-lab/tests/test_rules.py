"""Unit tests of the ported rules, on the details where Python and JavaScript differ by default."""

from __future__ import annotations

import pytest

from py_lab.migrator.infer import infer_column, sample_values
from py_lab.migrator.jstext import clean_text, format_count, js_number_to_string, strip_accents
from py_lab.migrator.normalize import (
    date_parts,
    normalize_email,
    normalize_header,
    normalize_phone,
    parse_amount,
    parse_date,
    to_title_case,
    unique_keys,
)
from py_lab.migrator.papaparse import guess_delimiter, guess_line_endings, parse
from py_lab.migrator.pipeline import detect_delimiter
from py_lab.migrator.validate import validate_cell


@pytest.mark.parametrize(
    ("value", "text"),
    [
        (1200000.5, "1200000.5"),
        (1200000.0, "1200000"),
        (-0.0, "0"),
        (0.000001, "0.000001"),
        (1.5e-7, "1.5e-7"),
        (1e21, "1e+21"),
        (123456789012345680000.0, "123456789012345680000"),
        (0.1 + 0.2, "0.30000000000000004"),
        (-1500.0, "-1500"),
    ],
)
def test_numbers_print_as_javascript_prints_them(value: float, text: str) -> None:
    assert js_number_to_string(value) == text


def test_clean_text_uses_javascripts_whitespace() -> None:
    assert clean_text("  ana\u200b \u00a0 maría\t") == "ana maría"
    assert clean_text("\ufeffhola") == "hola"
    # U+001C..U+001F are whitespace for Python's str.isspace, not for JavaScript.
    assert clean_text("a\x1cb") == "a\x1cb"
    assert clean_text("sin cambios") == "sin cambios"


def test_headers_become_unique_snake_case_keys() -> None:
    assert normalize_header(" Correo Electrónico ", 0) == "correo_electronico"
    assert normalize_header("¿?", 3) == "columna_4"
    assert unique_keys(["a", "a", "a_2", "a"]) == ["a", "a_2", "a_2_2", "a_3"]
    assert strip_accents("Ñandú") == "Nandu"


def test_title_case_keeps_spanish_particles_and_initials() -> None:
    assert to_title_case("  ana maría  DE LA cruz ") == "Ana María de la Cruz"
    assert to_title_case("bogotá d.c.") == "Bogotá D.C."
    assert to_title_case("o'neil jean-pierre") == "O'Neil Jean-Pierre"
    assert to_title_case("de la rosa") == "De la Rosa"


def test_emails_and_phones() -> None:
    assert normalize_email("MAILTO:Ana @ Example .COM") == "ana@example.com"
    assert normalize_phone("300 555 0101") == "+573005550101"
    assert normalize_phone("0057 300 555 0101") == "+573005550101"
    assert normalize_phone("+1 (415) 555-0117") == "+14155550117"
    assert normalize_phone("601 555 0101") == "601 555 0101"
    # Arabic-Indic digits are not \d in JavaScript: the value stays as written.
    assert normalize_phone("٣٠٠ ٥٥٥ ٠١٠١") == "٣٠٠ ٥٥٥ ٠١٠١"


@pytest.mark.parametrize(
    ("value", "iso"),
    [
        ("03/04/2024", "2024-04-03"),
        ("2024/11/02", "2024-11-02"),
        ("3 de abril de 2024", "2024-04-03"),
        ("miércoles 9 de abril de 2025", "2025-04-09"),
        ("julio 1, 2025", "2025-07-01"),
        ("5/5/25", "2025-05-05"),
        ("1/1/99", "1999-01-01"),
        ("2024-11-02T08:15:00", "2024-11-02"),
        ("31/02/2024", None),
        ("1899-12-31", None),
        ("abril", None),
    ],
)
def test_dates_read_day_first(value: str, iso: str | None) -> None:
    assert parse_date(value) == iso


def test_date_parts_without_calendar_checks() -> None:
    assert date_parts("10/31/2024") == (2024, 31, 10)


@pytest.mark.parametrize(
    ("value", "amount"),
    [
        ("$1.200.000,50", 1200000.5),
        ("1,200,000.50", 1200000.5),
        ("850.000", 850000.0),
        ("0.500", 0.5),
        ("1,5", 1.5),
        ("(1.500,00)", -1500.0),
        ("-$ 2.000", -2000.0),
        ("USD 1,250.00", 1250.0),
        ("45 pesos", 45.0),
        ("1.2.3", None),
        ("12,34,567", None),
        ("mil", None),
        ("1" * 400, None),
    ],
)
def test_amounts(value: str, amount: float | None) -> None:
    assert parse_amount(value) == amount


def test_inference_samples_like_the_browser() -> None:
    values = [str(i) for i in range(450)]
    sample = sample_values(values)
    assert len(sample) == 200
    assert sample[:3] == ["0", "2", "4"]
    assert sample[-1] == "447"
    inference = infer_column("correo", ["a@example.com", "b@example", "", "x"])
    assert (inference.type, inference.reason, inference.sampled, inference.matched) == ("email", "header", 3, 2)
    assert infer_column("cedula", ["1.020.304"]).reason == "identifier"


def test_validation_messages() -> None:
    assert validate_cell("email", "ana@example.com") is None
    assert validate_cell("email", "ana@example") == (
        "«ana@example» no tiene una extensión de dominio válida. Revisa el final, por ejemplo @dominio.com o "
        "@dominio.co."
    )
    assert validate_cell("date", "2024-02-29") is None
    assert validate_cell("date", "2023-02-29") is not None
    assert validate_cell("amount", 0) is None
    assert validate_cell("amount", "mil") == "«mil» tiene letras. Escríbelo solo con números, por ejemplo 1.200.000,50."
    assert validate_cell("text", "lo que sea") is None
    assert validate_cell("phone", None) is None


def test_papaparse_line_endings_and_delimiters() -> None:
    assert guess_line_endings("a\r\nb\r\n") == "\r\n"
    assert guess_line_endings("a\rb\r") == "\r"
    assert guess_line_endings('"x\r\ny"\nb\n') == "\n"
    # Same cases as apps/web pipeline.test.ts.
    assert detect_delimiter("a;b;c\n1;2,5;3\n4;5,5;6\n7;8;9") == ";"
    assert detect_delimiter('a,b,c\n1,"2;5",3\n4,5,6') == ","
    assert detect_delimiter("nombre;correo\n;\n\n") == ";"
    assert detect_delimiter('a;b\n1;2\n"3;4\n5;6') == ";"
    assert detect_delimiter('"nombre, apellido";correo\nAna') == ";"
    assert detect_delimiter("nombre\nAna\nLuis") == ","
    assert guess_delimiter("", "\n", (",", ";")) is None


def test_papaparse_quotes() -> None:
    parsed = parse('nombre;nota\r\n"Gómez; Ana";"línea 1\nlínea 2"\r\n', ";", "\r\n")
    assert parsed.data == [["nombre", "nota"], ["Gómez; Ana", "línea 1\nlínea 2"], [""]]
    unclosed = parse('a;b\n1;2\n"3;4\n5;6', ";", "\n")
    assert [error.code for error in unclosed.errors] == ["MissingQuotes"]
    assert unclosed.data[-1] == ["3;4\n5;6"]
    invalid = parse('"a"b",c\n', ",", "\n")
    assert [error.code for error in invalid.errors] == ["InvalidQuotes"]
    assert parse("a,b\n1,2\n3,4\n", ",", "\n", preview=2).data == [["a", "b"], ["1", "2"]]


def test_counts_are_written_as_in_colombia() -> None:
    assert [format_count(n) for n in (999, 1000, 20001, 1234567)] == ["999", "1.000", "20.001", "1.234.567"]
