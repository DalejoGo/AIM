"""Cell validation and its Spanish messages (validate.ts).

The browser validates with Zod; the checks below are the same ones Zod runs for each schema in
`fieldSchema`: `z.email()` and `z.iso.date()` use these exact regular expressions (zod/v4/core/regexes.js),
the phone column uses `E164`, and an amount must be a number. Messages are the browser's, word for word.
"""

from __future__ import annotations

import re

from .infer import ColumnType
from .jstext import WS, clean_text
from .normalize import DEFAULT_COUNTRY_CODE, E164, MAX_YEAR, MIN_YEAR, date_parts, days_in_month, digits_only

CleanValue = str | float | int | None

#: zod 4.6.7 `regexes.email`.
ZOD_EMAIL = re.compile(
    r"(?:[A-Za-z0-9_'+\-]+\.)*[A-Za-z0-9_'+\-]*[A-Za-z0-9_+-]@(?:[A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}"
)
#: zod 4.6.7 `regexes.date` (what `z.iso.date()` checks): a real calendar date, leap years included.
ZOD_ISO_DATE = re.compile(
    r"(?:(?:[0-9][0-9][2468][048]|[0-9][0-9][13579][26]|[0-9][0-9]0[48]|[02468][048]00|[13579][26]00)-02-29"
    r"|[0-9]{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12][0-9]|3[01])|(?:0[469]|11)-(?:0[1-9]|[12][0-9]|30)"
    r"|(?:02)-(?:0[1-9]|1[0-9]|2[0-8])))"
)

MONTH_NAMES = (
    "enero",
    "febrero",
    "marzo",
    "abril",
    "mayo",
    "junio",
    "julio",
    "agosto",
    "septiembre",
    "octubre",
    "noviembre",
    "diciembre",
)

_HAS_SPACE = re.compile(f"[{WS}]")
_TLD = re.compile(r"\.[a-z]{2,}\Z", re.IGNORECASE | re.ASCII)
_NOT_PHONE_CHAR = re.compile(f"[^+0-9{WS}().\\-/]")
_CURRENCY_WORDS = re.compile(r"\b(?:cop|usd|eur|us|pesos?)\b", re.IGNORECASE | re.ASCII)


def _show(value: object) -> str:
    return f"«{value}»"


def describe_email_problem(value: str) -> str:
    at = value.count("@")
    if at == 0:
        return f"{_show(value)} no es un correo: le falta la @. Escríbelo como nombre@dominio.com."
    if at > 1:
        return f"{_show(value)} tiene más de una @. Deja solo una, entre el usuario y el dominio."
    if _HAS_SPACE.search(value):
        return f"{_show(value)} tiene espacios. Quítalos: un correo va todo junto."
    user, domain = value.split("@")
    if not user:
        return f"{_show(value)} no tiene nada antes de la @. Agrega el usuario, por ejemplo ana@dominio.com."
    if not _TLD.search(domain):
        return (
            f"{_show(value)} no tiene una extensión de dominio válida. "
            "Revisa el final, por ejemplo @dominio.com o @dominio.co."
        )
    return f"{_show(value)} no es un correo válido. Revisa que no tenga tildes, comas ni símbolos raros."


def describe_phone_problem(value: str) -> str:
    digits = len(digits_only(value))
    if _NOT_PHONE_CHAR.search(value):
        return f"{_show(value)} tiene letras o símbolos. Deja solo números, espacios, guiones o paréntesis."
    if value.startswith(f"+{DEFAULT_COUNTRY_CODE}"):
        national = digits - len(DEFAULT_COUNTRY_CODE)
        return (
            f"Un número de Colombia (+57) lleva 10 dígitos después del indicativo y {_show(value)} tiene "
            f"{national}. Revisa que no falte ni sobre ninguno."
        )
    if value.startswith("+"):
        return (
            f"{_show(value)} tiene {digits} dígitos contando el indicativo. Un número internacional lleva entre 8 y 15."
        )
    if digits == 10:
        return (
            f"{_show(value)} no tiene indicativo de país y no es un celular de Colombia (empiezan por 3). "
            "Escríbelo con + y el indicativo, por ejemplo +57 601 555 0101."
        )
    return (
        f"{_show(value)} tiene {digits} dígitos. Un celular de Colombia lleva 10, por ejemplo 300 555 0101. "
        "Si es de otro país, agrega + y el indicativo."
    )


def describe_date_problem(value: str) -> str:
    parts = date_parts(value)
    formats = "Usa día/mes/año (03/04/2024), año-mes-día (2024-04-03) o «3 de abril de 2024»."
    if parts is None:
        return f"No se reconoce {_show(value)} como fecha. {formats}"
    year, month, day = parts
    if year < MIN_YEAR or year > MAX_YEAR:
        return (
            f"El año {year} de {_show(value)} está fuera del rango aceptado ({MIN_YEAR} a {MAX_YEAR}). "
            "Revisa que el año esté completo."
        )
    if month > 12 and day <= 12:
        return (
            f"{_show(value)} no existe si se lee como día/mes/año: no hay mes {month}. Si viene en formato "
            f"mes/día, escríbela como {month:02d}/{day:02d}/{year}."
        )
    if month < 1 or month > 12:
        return f"{_show(value)} tiene el mes {month}, que no existe. {formats}"
    days = days_in_month(year, month)
    if day < 1 or day > days:
        return f"{_show(value)} no existe: {MONTH_NAMES[month - 1]} de {year} tiene {days} días. Revisa el día."
    return f"No se reconoce {_show(value)} como fecha. {formats}"


def describe_amount_problem(raw: str) -> str:
    value = clean_text(raw)
    if any(char.isalpha() for char in _CURRENCY_WORDS.sub("", value)):
        return f"{_show(value)} tiene letras. Escríbelo solo con números, por ejemplo 1.200.000,50."
    return (
        f"No se entiende {_show(value)} como monto. Usa puntos para los miles y coma para los decimales "
        "(1.200.000,50), o solo el punto decimal (1200000.5)."
    )


def validate_cell(kind: ColumnType, value: CleanValue) -> str | None:
    """The problem with one normalised cell, or None. Empty cells (None) are always allowed."""
    if value is None or kind == "text":
        return None
    if kind == "amount":
        return None if isinstance(value, int | float) else describe_amount_problem(str(value))
    text = str(value)
    if kind == "email":
        return None if ZOD_EMAIL.fullmatch(text) else describe_email_problem(text)
    if kind == "phone":
        return None if E164.fullmatch(text) else describe_phone_problem(text)
    return None if ZOD_ISO_DATE.fullmatch(text) else describe_date_problem(text)
