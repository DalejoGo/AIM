"""JavaScript semantics the browser rules depend on, reproduced in Python.

The browser migrator is TypeScript. A few details differ between the two languages and would change results:

- `\\s` and `String.prototype.trim` use a fixed set of whitespace characters; Python's `\\s` and `str.strip()`
  follow `str.isspace()`, which also includes the C0 separators (U+001C to U+001F) and U+0085, and leaves
  out U+FEFF. Patterns here spell the JavaScript set out (`WS`).
- `\\d` and `\\b` are ASCII in JavaScript. Python's are Unicode-aware unless `re.ASCII` is set, so digits
  are written `[0-9]` and word boundaries use `re.ASCII`.
- `$` in Python also matches before a final newline; anchored checks use `fullmatch` or `\\Z`.
- `String(number)` follows ECMAScript's Number::toString (`js_number_to_string`).
- `\\p{L}` (any letter) is `str.isalpha()` on one character.
"""

from __future__ import annotations

import math
import re
import unicodedata

# ECMAScript WhiteSpace and LineTerminator code points: what `\s` matches and what `trim()` removes.
JS_SPACES = (
    "\t\n\x0b\x0c\r \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a"
    "\u2028\u2029\u202f\u205f\u3000\ufeff"
)
#: The same set as the body of a regular expression character class.
WS = r"\t\n\x0b\x0c\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff"

_ZERO_WIDTH = re.compile("[\u200b-\u200d\u2060\ufeff]")
_SPACE_RUNS = re.compile(f"[{WS}]+")
# Anything clean_text would change: invisible characters, whitespace other than a single inner space.
_NEEDS_CLEANING = re.compile(f"[\u200b-\u200d\u2060\ufeff]|[{WS.replace(' ', '')}]|  |^ | $")
_COMBINING_MARKS = re.compile("[\u0300-\u036f]")


#: What clean_text removes entirely: whitespace and invisible characters. A value made only of these is empty.
_BLANK = JS_SPACES + "\u200b\u200c\u200d\u2060"


def is_blank(value: str) -> bool:
    """`clean_text(value) == ""`, without building the cleaned text."""
    return not value.strip(_BLANK)


def js_trim(value: str) -> str:
    """`String.prototype.trim`."""
    return value.strip(JS_SPACES)


def clean_text(value: str) -> str:
    """Removes invisible characters, collapses runs of whitespace and trims (normalize.ts `cleanText`)."""
    if not value or _NEEDS_CLEANING.search(value) is None:
        return value
    return js_trim(_SPACE_RUNS.sub(" ", _ZERO_WIDTH.sub("", value)))


def strip_accents(value: str) -> str:
    """NFD, then drops the combining diacritical marks: "Teléfono" becomes "Telefono"."""
    if value.isascii():
        return value
    return _COMBINING_MARKS.sub("", unicodedata.normalize("NFD", value))


def is_letter(char: str) -> bool:
    """`/\\p{L}/u` for one character: Unicode categories Lu, Ll, Lt, Lm and Lo."""
    return char.isalpha()


def js_number_to_string(value: float) -> str:
    """ECMAScript Number::toString(10). Both languages print the shortest digits that round-trip."""
    if math.isnan(value):
        return "NaN"
    if math.isinf(value):
        return "Infinity" if value > 0 else "-Infinity"
    if value == 0:
        return "0"  # -0 included, as in JavaScript
    if value < 0:
        return "-" + js_number_to_string(-value)
    shortest = repr(float(value))
    if "e" not in shortest:
        # Between 1e-4 and 1e16 both languages write plain digits; JavaScript drops a trailing ".0".
        return shortest[:-2] if shortest.endswith(".0") else shortest
    mantissa, _, exponent_text = shortest.partition("e")
    integer_part, _, fraction = mantissa.partition(".")
    if fraction == "0":
        fraction = ""
    digits = integer_part + fraction
    significant = digits.lstrip("0")
    leading_zeros = len(digits) - len(significant)
    s = significant.rstrip("0")
    k = len(s)
    # value = s × 10^(n − k), as in the specification.
    n = len(integer_part) - leading_zeros + (int(exponent_text) if exponent_text else 0)
    if k <= n <= 21:
        return s + "0" * (n - k)
    if 0 < n <= 21:
        return f"{s[:n]}.{s[n:]}"
    if -6 < n <= 0:
        return "0." + "0" * (-n) + s
    sign = "+" if n - 1 >= 0 else "-"
    head = s if k == 1 else f"{s[0]}.{s[1:]}"
    return f"{head}e{sign}{abs(n - 1)}"


def format_count(n: int) -> str:
    """`Intl.NumberFormat('es-CO')` for whole numbers: "20.001"."""
    return f"{n:,}".replace(",", ".")
