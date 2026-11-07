"""Value normalisers (normalize.ts). Best effort: a value that cannot be converted comes back cleaned but
otherwise untouched, and validation (validate.py) explains what is wrong with it."""

from __future__ import annotations

import calendar
import math
import re
from typing import NamedTuple

from .jstext import WS, clean_text, is_letter, js_trim, strip_accents

_NON_ALNUM = re.compile(r"[^a-z0-9]+")


def normalize_header(label: str, index: int) -> str:
    """Turns a header into a snake_case key: " Correo Electrónico " becomes "correo_electronico"."""
    key = _NON_ALNUM.sub("_", strip_accents(clean_text(label)).lower()).strip("_")
    return key or f"columna_{index + 1}"


def unique_keys(keys: list[str]) -> list[str]:
    """Makes keys unique by numbering repeats: ["a", "a"] becomes ["a", "a_2"]."""
    seen: set[str] = set()
    result: list[str] = []
    for key in keys:
        candidate = key
        n = 2
        while candidate in seen:
            candidate = f"{key}_{n}"
            n += 1
        seen.add(candidate)
        result.append(candidate)
    return result


#: Words kept in lower case inside names, as Spanish writes them ("María de los Ángeles").
PARTICLES = frozenset({"de", "del", "la", "las", "los", "y", "e"})
_NAME_SEPARATORS = "-'’"


def _is_initials(word: str) -> bool:
    """`/^(?:\\p{L}\\.)+\\p{L}?$/u`: "d.c.", "a.b"."""
    if "." not in word:
        return False
    i = 0
    pairs = 0
    while i + 1 < len(word) and is_letter(word[i]) and word[i + 1] == ".":
        i += 2
        pairs += 1
    if pairs == 0:
        return False
    return i == len(word) or (i == len(word) - 1 and is_letter(word[i]))


def _capitalize(word: str) -> str:
    """`/(^|[-'’])(\\p{L})/gu` → upper case: the first letter and every letter after a hyphen or apostrophe."""
    if "-" not in word and "'" not in word and "’" not in word:
        first = word[:1]
        return first.upper() + word[1:] if is_letter(first) else word
    chars = list(word)
    for i, char in enumerate(chars):
        if is_letter(char) and (i == 0 or word[i - 1] in _NAME_SEPARATORS):
            chars[i] = char.upper()
    return "".join(chars)


def to_title_case(value: str) -> str:
    """Title case for names and places: "  ana maría  DE LA cruz " becomes "Ana María de la Cruz"."""
    words = clean_text(value).lower().split(" ")
    result: list[str] = []
    for i, word in enumerate(words):
        if i > 0 and word in PARTICLES:
            result.append(word)
        elif _is_initials(word):
            result.append(word.upper())
        else:
            result.append(_capitalize(word))
    return " ".join(result)


_MAILTO = re.compile(r"mailto:", re.IGNORECASE | re.ASCII)
_EMAIL_SPACES = re.compile(f"[{WS}]*([@.])[{WS}]*")


def normalize_email(value: str) -> str:
    """Lower case, no stray spaces around "@" or ".", no "mailto:". Inner spaces stay so validation flags them."""
    return email_from_clean(clean_text(value))


def email_from_clean(text: str) -> str:
    """normalize_email for text that already went through clean_text (the pipeline cleans each cell once)."""
    if _MAILTO.match(text):
        text = text[len("mailto:") :]
    return _EMAIL_SPACES.sub(r"\1", text).lower()


#: Country assumed for numbers written without one: Colombian mobiles have 10 digits and start with 3.
DEFAULT_COUNTRY_CODE = "57"
#: E.164: "+" and 8 to 15 digits; Colombian numbers (+57) carry exactly 10 digits after the code.
E164 = re.compile(rf"\+{DEFAULT_COUNTRY_CODE}[0-9]{{10}}|\+(?!{DEFAULT_COUNTRY_CODE})[1-9][0-9]{{7,14}}")
_PHONE_CHARS = re.compile(f"[+0-9{WS}().\\-/]+")
_NON_DIGITS = re.compile(r"[^0-9]")
_STARTS_WITH_PLUS = re.compile(r"\(?\+")


def digits_only(value: str) -> str:
    return _NON_DIGITS.sub("", value)


def _to_e164(text: str) -> str | None:
    digits = digits_only(text)
    if _STARTS_WITH_PLUS.match(text):
        return f"+{digits}"
    if digits.startswith("00"):
        return f"+{digits[2:]}"
    if len(digits) == 10 and digits.startswith("3"):
        return f"+{DEFAULT_COUNTRY_CODE}{digits}"
    if len(digits) == 12 and digits.startswith(f"{DEFAULT_COUNTRY_CODE}3"):
        return f"+{digits}"
    return None


def normalize_phone(value: str) -> str:
    """Phone to E.164 ("+573005550101"); anything that does not end up valid comes back cleaned, as written."""
    return phone_from_clean(clean_text(value))


def phone_from_clean(text: str) -> str:
    if not _PHONE_CHARS.fullmatch(text):
        return text
    e164 = _to_e164(text)
    return e164 if e164 is not None and E164.fullmatch(e164) else text


MONTHS: dict[str, int] = {
    "enero": 1,
    "ene": 1,
    "febrero": 2,
    "feb": 2,
    "marzo": 3,
    "mar": 3,
    "abril": 4,
    "abr": 4,
    "mayo": 5,
    "may": 5,
    "junio": 6,
    "jun": 6,
    "julio": 7,
    "jul": 7,
    "agosto": 8,
    "ago": 8,
    "septiembre": 9,
    "setiembre": 9,
    "sept": 9,
    "sep": 9,
    "set": 9,
    "octubre": 10,
    "oct": 10,
    "noviembre": 11,
    "nov": 11,
    "diciembre": 12,
    "dic": 12,
}

MIN_YEAR = 1900
MAX_YEAR = 2100

_TIME_SUFFIX = re.compile(f"(?:T|[{WS}]+)[0-9]{{1,2}}:[0-9]{{2}}.*\\Z", re.IGNORECASE | re.ASCII | re.DOTALL)
_WEEKDAY_PREFIX = re.compile(f"(?:lunes|martes|miercoles|jueves|viernes|sabado|domingo),?[{WS}]+")
_ISO_LIKE = re.compile(r"([0-9]{4})[-/.]([0-9]{1,2})[-/.]([0-9]{1,2})")
_DAY_FIRST = re.compile(r"([0-9]{1,2})[-/.]([0-9]{1,2})[-/.]([0-9]{4}|[0-9]{2})")
_DE = re.compile(r"\b(?:de|del)\b", re.ASCII)
_WORD_SPLIT = re.compile(f"[{WS}/-]+")
_YEAR_WORD = re.compile(r"[0-9]{2}(?:[0-9]{2})?")
_DAY_WORD = re.compile(r"[0-9]{1,2}")


class DateParts(NamedTuple):
    year: int
    month: int
    day: int


def days_in_month(year: int, month: int) -> int:
    return calendar.monthrange(year, month)[1]


def expand_year(year: str) -> int:
    """Two-digit years: 00 to 49 are 2000s, 50 to 99 are 1900s."""
    n = int(year)
    if len(year) != 2:
        return n
    return 2000 + n if n < 50 else 1900 + n


def _to_iso(year: int, month: int, day: int) -> str | None:
    if year < MIN_YEAR or year > MAX_YEAR or month < 1 or month > 12:
        return None
    if day < 1 or day > days_in_month(year, month):
        return None
    return f"{year}-{month:02d}-{day:02d}"


def date_parts(value: str) -> DateParts | None:
    """Splits a date into year, month and day, reading numeric dates day first. Does not check the calendar."""
    return _date_parts_from_clean(clean_text(value))


def _date_parts_from_clean(cleaned: str) -> DateParts | None:
    text = strip_accents(cleaned.lower())
    text = _TIME_SUFFIX.sub("", text, count=1)
    text = _WEEKDAY_PREFIX.sub("", text, count=1)

    iso = _ISO_LIKE.fullmatch(text)
    if iso:
        return DateParts(int(iso[1]), int(iso[2]), int(iso[3]))

    day_first = _DAY_FIRST.fullmatch(text)
    if day_first:
        return DateParts(expand_year(day_first[3]), int(day_first[2]), int(day_first[1]))

    # Written months: "3 de abril de 2024", "3-abr-2024", "abril 3, 2024".
    spaced = _DE.sub(" ", text.replace(",", " "))
    words = [word for word in _WORD_SPLIT.split(spaced) if word]
    words = [word[:-1] if word.endswith(".") else word for word in words]
    if len(words) != 3:
        return None
    a, b, c = words
    if not _YEAR_WORD.fullmatch(c):
        return None
    month_after_day = MONTHS.get(b)
    if _DAY_WORD.fullmatch(a) and month_after_day:
        return DateParts(expand_year(c), month_after_day, int(a))
    month_before_day = MONTHS.get(a)
    if month_before_day and _DAY_WORD.fullmatch(b):
        return DateParts(expand_year(c), month_before_day, int(b))
    return None


def parse_date(value: str) -> str | None:
    """Date to ISO "YYYY-MM-DD", or None when it is not a real date between 1900 and 2100."""
    parts = date_parts(value)
    return _to_iso(*parts) if parts else None


def normalize_date(value: str) -> str:
    return date_from_clean(clean_text(value))


def date_from_clean(text: str) -> str:
    parts = _date_parts_from_clean(text)
    return (_to_iso(*parts) if parts else None) or text


_CURRENCY = re.compile(r"us\$|\$|€|\b(?:cop|usd|eur|pesos?)\b", re.IGNORECASE | re.ASCII)
_PARENTHESES = re.compile(r"\(.*\)", re.DOTALL)
_SIGN = re.compile(f"([-+])[{WS}]*")
_AMOUNT_SHAPE = re.compile(r"[0-9][0-9.,]*")
_DIGITS = re.compile(r"[0-9]+")
_GROUP_SEPARATOR = re.compile(r"[.,]")
_FIRST_GROUP = re.compile(r"[0-9]{1,3}")
_THOUSANDS_GROUP = re.compile(r"[0-9]{3}")


def parse_amount(value: str) -> float | None:
    """Amount to a number. Accepts "$1.200.000,50", "1,200,000.50" and "1200000.5". With both separators the
    last one is the decimal mark. With only one, repeated means thousands, and a single one followed by
    exactly three digits ("850.000") is read as thousands too, as Latin American files usually write it."""
    return _amount_from_clean(clean_text(value))


def _amount_from_clean(text: str) -> float | None:
    negative = False
    if _PARENTHESES.fullmatch(text):
        negative = True
        text = text[1:-1]
    text = js_trim(_CURRENCY.sub("", text))
    sign = _SIGN.match(text)
    if sign:
        negative = negative != (sign[1] == "-")
        text = text[sign.end() :]
    if not _AMOUNT_SHAPE.fullmatch(text):
        return None

    last_dot = text.rfind(".")
    last_comma = text.rfind(",")
    decimal_mark: str | None = None
    if last_dot >= 0 and last_comma >= 0:
        decimal_mark = "." if last_dot > last_comma else ","
    elif last_dot >= 0 or last_comma >= 0:
        mark = "." if last_dot >= 0 else ","
        at = text.find(mark)
        single = at == text.rfind(mark)
        head = text[:at]
        looks_like_thousands = len(text) - at - 1 == 3 and len(head) <= 3 and head != "0"
        if single and not looks_like_thousands:
            decimal_mark = mark

    parts = text.split(decimal_mark) if decimal_mark else [text]
    integer_part = parts[0]
    decimals = parts[1] if len(parts) > 1 else None
    if len(parts) > 2 or decimals == "" or (decimals is not None and not _DIGITS.fullmatch(decimals)):
        return None
    groups = _GROUP_SEPARATOR.split(integer_part)
    if len(groups) > 1:
        separators = set(integer_part) - set("0123456789")
        if len(separators) > 1:
            return None
        first, *rest = groups
        if not _FIRST_GROUP.fullmatch(first) or any(not _THOUSANDS_GROUP.fullmatch(group) for group in rest):
            return None

    amount = float("".join(groups) + (f".{decimals}" if decimals else ""))
    if not math.isfinite(amount):
        return None
    return -amount if negative else amount


def normalize_amount(value: str) -> float | str:
    return amount_from_clean(clean_text(value))


def amount_from_clean(text: str) -> float | str:
    amount = _amount_from_clean(text)
    return text if amount is None else amount
