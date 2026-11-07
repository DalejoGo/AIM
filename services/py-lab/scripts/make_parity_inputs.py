"""Writes the CSV inputs of the parity test (tests/parity/inputs). Deterministic: running it again gives the
same bytes. `clientes-ejemplo.csv` is not here: the web test copies it from apps/web's sample.ts.

    uv run python scripts/make_parity_inputs.py

Then regenerate the browser's expected results (apps/web, see README) and run pytest.
"""

from __future__ import annotations

from pathlib import Path

INPUTS = Path(__file__).resolve().parent.parent / "tests" / "parity" / "inputs"

TYPES_AND_EDGES = "\n".join(
    [
        "ID;Nombre;Apellidos;Email;Celular;Fecha nacimiento;Valor;2024;;Ciudad;Nombre;Código postal;Vacía",
        "001; o'neil  ;JEAN-PIERRE de la rosa;mailto:Ana @ Example .COM;0057 300 555 0101;"
        "lunes, 3 de abril de 2024;(1.500,00);uno;x;bogotá d.c.;  ana\u200b ;050001;",
        "002;MARÍA\u00a0JOSÉ;del valle;  luis.perez@example.co ;+1 (415) 555-0117;abril 3, 2024;"
        "-$ 2.000;dos;y;SAN JOSÉ DEL GUAVIARE;luis;110111;",
        "003;pedro;de los ríos;pedro@example;(+57) 300 555 0103;3-abr-24;+300;tres;z;cali;pedro;760001;",
        "004;\tcarlos\t;Y;carlos@@example.com;+57 300 555 01;2024/02/29;USD 1,250.00;cuatro;;cali;carlos;;",
        "005;ana;ruiz;@example.com;+44 20 7946 0958;29/02/2023;1,5;cinco;;medellín;ana;;",
        "006;luisa;díaz;luisa diaz@example.com;300-555-0106 ext 2;31/04/2024;0.500;seis;;pasto;luisa;;",
        "007;jorge;niño;jorge@example.c;555 0107;13/13/2024;0,500;siete;;cúcuta;jorge;;",
        "008;sofía;peña;sofía@example.com;601 555 0108;1899-12-31;1.234.567,89;ocho;;neiva;sofía;;",
        "009;mateo;ortiz;mateo@example.com;3005550109;sábado 05/10/2024;1,234,567.89;nueve;;ibagué;mateo;;",
        "010;eva;lópez;eva@example.com;573005550110;2024-02-30;1.2.3;diez;;tunja;eva;;",
        "011;raúl;gil;raul@example.com;3005550111;10/31/2024;12,34,567;once;;quibdó;raúl;;",
        "012;inés;paz;ines@example.com;3005550112;5 sept 2024 10:30;€ 45;doce;;leticia;inés;;",
        "013;ana;ruiz;ANA@EXAMPLE.COM;3005550113;2024-11-02T08:15:00;45 pesos;trece;;arauca;ana;;",
        "014;lía;mar;lia@example.com;3005550114;5/5/25;COP 1.000;catorce;;yopal;lía;;",
        "015;río;sol;rio@example.com;3005550115;1/1/99;-0;quince;;mocoa;río;;",
        "016;teo;luz;teo@example.com;3005550116;15.06.2025;007;dieciséis;;sincelejo;teo;;",
        "017;zoe;mar;zoe@example.com;3005550117;3 de abril de 2024;mil;diecisiete;;riohacha;zoe;;",
        "018;sara;sol;sara@example.com;3005550118;miércoles 9 de abril de 2025;$ 9.999.999.999;dieciocho;;"
        "florencia;sara;;",
        "019;iván;rey;ivan@example.com;3005550119;20 dic 2024;0;diecinueve;;mitú;iván;;",
        "020;ana;ruiz;ana@example.com;+57 300 555 0101;03/04/2024;-1500;veinte;;bogotá;ana;;",
        "",
    ]
)

QUOTES_AND_STRUCTURE = "\ufeff" + "\n".join(
    [
        "",
        "  ",
        '"Nombre, completo",correo,"Monto ""total""",nota',
        '"Gómez, Ana",ana@example.com,"1,200.50","línea 1',
        'línea 2"',
        '"Ruiz ""el mono"" Carlos",carlos@example.com,950,"sin problema"',
        '"Díaz Luisa"  ,luisa@example.com,  "300",ok',
        '"Pérez"Juan",juan@example.com,100,mal cerrada',
        "solo,dos",
        "Torres,torres@example.com,10,x,sobra",
        "Vargas,vargas@example.com,20,y,,,",
        ",,,",
        '"Mejía",mejia@example.com,30,"nota con ""comillas"""',
        '"Ríos",rios@example.com,40,"sin cierre',
        "esto queda dentro del campo",
    ]
)

COMMAS_CRLF = "\r\n".join(
    [
        "Cédula,Nombres,Correo electrónico,Teléfono fijo,Fecha de pago,Total pagado",
        '1.020.304,ana maría GÓMEZ,ana@example.com,601 555 0101,03/04/2024,"1.200.000"',
        "1020305,Carlos Ruiz,carlos@example.com,+57 601 555 0102,2024-04-05,850000",
        '1020306,  luisa   díaz ,LUISA@example.com,6045550103,05/04/2024,"$ 95.000"',
        ",,,,,",
        '1020305,carlos ruiz,CARLOS@EXAMPLE.COM ,+57 601 555 0102,05/04/2024,"850.000"',
        "   ,  ,,, , ",
        "1020307,Jorge,jorge@example.com,3105550104,7/4/2024,1500",
        '1020308,Sofía,sofia@example.com,(310) 555-0105,08-04-2024,"2,500.75"',
        "",
    ]
)

MAC_CR = "\r".join(
    [
        "nombre;correo;monto",
        "Ana;ana@example.com;1.000",
        "Luis;luis@example.com;2.000,5",
        "",
    ]
)

SINGLE_COLUMN = "\n".join(["correo", "ana@example.com", "LUIS@EXAMPLE.COM", "no-es-correo", "", "eva@example.co"])

UTF8_BOM = "\ufeffnombre,teléfono\nAna,300 555 0101\nLuis,+57 310 555 0102\n"

#: As Excel in Spanish saves "CSV (delimitado por comas)": Windows-1252, semicolons, CRLF.
EXCEL_LATIN1 = "\r\n".join(
    [
        "Nombre;Teléfono;Año de ingreso;Salario;Ciudad",
        "Peña Núñez;300 555 0101;01/02/2020;€ 1.250;Bogotá",
        "O’Brien Muñoz;310 555 0102;15/03/2021;2.300.000;Medellín",
        "Ángela Ibáñez;3205550103;2019-07-30;1.800.000,50;Cúcuta",
        "",
    ]
)

EMPTY = ""
HEADER_ONLY = "nombre;correo\n"


def many_rows(count: int = 450) -> str:
    """A bigger file, so the 200-value sample spreads across it; every 9th row has a typo."""
    seed = 20261106

    def rand(n: int) -> int:
        nonlocal seed
        seed = (seed * 1103515245 + 12345) % 2**31
        return seed % n

    names = ["ana", "luis", "MARÍA", "jorge", "sofía", "carlos", "eva", "raúl", "inés", "mateo"]
    surnames = ["gómez", "RUIZ", "díaz", "peña", "ortiz", "lópez", "de la cruz", "del valle"]
    cities = ["bogotá", "Medellín", "CALI", "barranquilla", "cartagena", "cúcuta"]
    lines = ["id;nombre;correo;telefono;fecha;monto;ciudad"]
    for i in range(1, count + 1):
        name = f"{names[rand(len(names))]} {surnames[rand(len(surnames))]}"
        email = f"user{i}@example.com" if i % 9 else f"user{i}example.com"
        phone = f"3{rand(10)}{rand(10)} 555 {i:04d}" if i % 13 else f"555 {i:04d}"
        date = f"{1 + rand(28):02d}/{1 + rand(12):02d}/{2020 + rand(6)}" if i % 17 else "31/02/2024"
        amount = f"$ {rand(900) + 100}.{rand(1000):03d}" if i % 11 else "mil"
        lines.append(f"{i};{name};{email};{phone};{date};{amount};{cities[rand(len(cities))]}")
        if i % 47 == 0:
            lines.append(";;;;;;")
        if i % 53 == 0:
            lines.append(f"{i};{name};{email};{phone};{date};{amount};{cities[0]}")
    return "\n".join(lines) + "\n"


FILES: dict[str, bytes] = {
    "tipos-y-bordes.csv": TYPES_AND_EDGES.encode(),
    "comillas-y-estructura.csv": QUOTES_AND_STRUCTURE.encode(),
    "comas-crlf.csv": COMMAS_CRLF.encode(),
    "mac-cr.csv": MAC_CR.encode(),
    "una-columna.csv": SINGLE_COLUMN.encode(),
    "bom-utf8.csv": UTF8_BOM.encode(),
    "excel-windows-1252.csv": EXCEL_LATIN1.encode("cp1252"),
    "muchas-filas.csv": many_rows().encode(),
    "vacio.csv": EMPTY.encode(),
    "solo-encabezados.csv": HEADER_ONLY.encode(),
}


def main() -> None:
    INPUTS.mkdir(parents=True, exist_ok=True)
    for name, data in FILES.items():
        (INPUTS / name).write_bytes(data)
        print(f"{name}: {len(data)} bytes")


if __name__ == "__main__":
    main()
