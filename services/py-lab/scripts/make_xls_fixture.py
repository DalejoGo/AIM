"""Writes tests/fixtures/clientes.xls, a legacy Excel 97-2003 (BIFF8) workbook, for the .xls tests.

xlwt is only needed to create this file once, so it is not a project dependency:

    uvx --from xlwt==1.3.0 python scripts/make_xls_fixture.py
"""

from __future__ import annotations

import datetime as dt
from pathlib import Path

import xlwt

OUT = Path(__file__).resolve().parent.parent / "tests" / "fixtures" / "clientes.xls"


def main() -> None:
    book = xlwt.Workbook(encoding="utf-8")
    notes = book.add_sheet("Notas")
    notes.write(0, 0, "Exportado del sistema contable")
    sheet = book.add_sheet("Clientes")
    date_style = xlwt.easyxf(num_format_str="DD/MM/YYYY")
    rows: list[list[object]] = [
        ["Nombre", "Correo", "Teléfono", "Fecha de registro", "Saldo"],
        ["peña núñez", "Pena@Example.com", 3005550101, dt.date(2024, 4, 3), 1200000.5],
        ["ÁNGELA IBÁÑEZ", "angela@example", "310 555 0102", dt.date(2024, 2, 29), 850000],
    ]
    for r, row in enumerate(rows):
        for c, value in enumerate(row):
            if isinstance(value, dt.date):
                sheet.write(r, c, value, date_style)
            else:
                sheet.write(r, c, value)
    book.save(str(OUT))
    print(f"{OUT}: {OUT.stat().st_size} bytes")


if __name__ == "__main__":
    main()
