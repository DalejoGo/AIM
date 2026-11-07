"""Column type inference (infer.ts)."""

from __future__ import annotations

import re
from collections.abc import Callable
from typing import Literal, NamedTuple

from .jstext import WS
from .normalize import digits_only, parse_amount, parse_date

ColumnType = Literal["email", "phone", "date", "amount", "text"]
SpecialType = Literal["email", "phone", "date", "amount"]
InferenceReason = Literal["header", "values", "identifier", "default"]

#: Values looked at per column. Spread across the file so a messy start does not decide alone.
SAMPLE_SIZE = 200
#: Share of sampled values that must look like a type when the header gives no hint.
MIN_SHARE = 0.8
#: Lower bar when the header already names the type ("Correo", "Teléfono"...).
MIN_SHARE_WITH_HINT = 0.5

#: Ties go to the first type in this list.
PRIORITY: tuple[SpecialType, ...] = ("email", "date", "phone", "amount")

#: Words in a header (snake_case key, split on "_") that suggest a type.
HINTS: dict[SpecialType, tuple[str, ...]] = {
    "email": ("correo", "email", "mail"),
    "phone": ("telefono", "tel", "celular", "cel", "movil", "phone", "whatsapp"),
    "date": ("fecha", "date", "nacimiento", "creado", "creacion", "actualizado", "vencimiento"),
    "amount": (
        "monto",
        "valor",
        "total",
        "saldo",
        "precio",
        "importe",
        "pago",
        "amount",
        "price",
        "deuda",
        "salario",
    ),
}

#: Headers that hold identifiers: numbers that must stay exactly as written.
IDENTIFIER_WORDS = ("id", "codigo", "documento", "cedula", "nit", "identificacion", "cc", "sku", "referencia")

#: Text headers whose values are names or places, written in title case.
TITLE_WORDS = ("nombre", "nombres", "apellido", "apellidos", "name", "ciudad", "city", "municipio", "pais")

_LOOSE_PHONE = re.compile(f"\\(?\\+?[0-9{WS}().-]+")
_THOUSANDS_GROUPS = re.compile(r"[0-9]{1,3}(?:\.[0-9]{3})+")
_LOOSE_DATE = re.compile(r"[0-9]{1,4}[-/.][0-9]{1,2}[-/.][0-9]{1,4}")
#: A currency sign followed by digits, even if the number itself is malformed ("$1.2.3").
_LOOSE_MONEY = re.compile(f"\\(?-?[{WS}]*(?:us\\$|\\$|€|cop|usd)[{WS}]*[0-9]", re.IGNORECASE | re.ASCII)


def looks_like(kind: SpecialType, value: str) -> bool:
    """Loose shape checks: invalid values still count, so one bad email does not turn a column into text."""
    if kind == "email":
        return "@" in value
    if kind == "phone":
        if not _LOOSE_PHONE.fullmatch(value) or _THOUSANDS_GROUPS.fullmatch(value):
            return False
        return 7 <= len(digits_only(value)) <= 15
    if kind == "date":
        return _LOOSE_DATE.fullmatch(value) is not None or parse_date(value) is not None
    return parse_amount(value) is not None or _LOOSE_MONEY.match(value) is not None


def sample_values(values: list[str], size: int = SAMPLE_SIZE) -> list[str]:
    """Up to `size` values spread evenly across the list (same float steps as the browser)."""
    if len(values) <= size:
        return values
    step = len(values) / size
    return [values[int(i * step)] for i in range(size)]


def header_words(key: str) -> list[str]:
    return [word for word in key.split("_") if word]


class Inference(NamedTuple):
    type: ColumnType
    title_case: bool
    reason: InferenceReason
    sampled: int
    matched: int


def infer_column(key: str, cleaned_values: list[str]) -> Inference:
    """Decides a column's type from its key and its (already cleaned) values:

    1. Identifier headers (id, documento, cédula...) stay as text.
    2. A type named by the header wins if at least half the sample looks like it.
    3. Otherwise the type with the largest share wins if it reaches 80 %; ties follow PRIORITY.
    4. Anything else is text.
    """
    words = header_words(key)
    title_case = any(word in TITLE_WORDS for word in words)
    sample = sample_values([value for value in cleaned_values if value])
    sampled = len(sample)

    if any(word in IDENTIFIER_WORDS for word in words):
        return Inference("text", title_case, "identifier", sampled, sampled)
    if sampled == 0:
        return Inference("text", title_case, "default", 0, 0)

    matches = {kind: sum(1 for value in sample if looks_like(kind, value)) for kind in PRIORITY}

    def share(kind: SpecialType) -> float:
        return matches[kind] / sampled

    hinted = [kind for kind in PRIORITY if any(hint in words for hint in HINTS[kind])]
    by_hint = _best([kind for kind in hinted if share(kind) >= MIN_SHARE_WITH_HINT], share)
    if by_hint is not None:
        return Inference(by_hint, False, "header", sampled, matches[by_hint])

    by_values = _best([kind for kind in PRIORITY if share(kind) >= MIN_SHARE], share)
    if by_values is not None:
        return Inference(by_values, False, "values", sampled, matches[by_values])

    return Inference("text", title_case, "default", sampled, sampled)


def _best(kinds: list[SpecialType], share: Callable[[SpecialType], float]) -> SpecialType | None:
    """Highest share; the earliest wins ties because the list follows PRIORITY."""
    winner: SpecialType | None = None
    for kind in kinds:
        if winner is None or share(kind) > share(winner):
            winner = kind
    return winner
