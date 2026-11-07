"""The parts of PapaParse 5.7.0 the browser migrator uses, ported to Python.

The browser reads CSV with PapaParse, and its exact behaviour decides the result: which separator wins,
where a row ends, which rows have broken quotes. Python's `csv` module disagrees with it on malformed input,
so this is a faithful port of PapaParse's `Parser`, `guessLineEndings` and `guessDelimiter` (only the options
the migrator sets: no header, no comments, no streaming, default quote and escape character).

Like PapaParse, when the text has no quote at all it splits lines and fields with `str.split`, which keeps
large clean files fast.
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass, field

from .jstext import js_trim

QUOTE = '"'
_ESCAPED_QUOTE = '""'
_QUOTED = re.compile(r'"[\s\S]*?"')
#: PapaParse looks at the first megabyte to guess line endings (JavaScript counts UTF-16 units).
_LINE_ENDING_SAMPLE = 1024 * 1024


@dataclass
class QuoteError:
    code: str  # "MissingQuotes" | "InvalidQuotes"
    row: int  # index in `data` of the record being read


@dataclass
class ParseResult:
    data: list[list[str]] = field(default_factory=list)
    errors: list[QuoteError] = field(default_factory=list)
    truncated: bool = False


def guess_line_endings(text: str) -> str:
    """`ParserHandle.guessLineEndings`: "\\n", "\\r\\n" or "\\r", ignoring line breaks inside quotes."""
    sample = _QUOTED.sub("", text[:_LINE_ENDING_SAMPLE])
    r = sample.split("\r")
    n = sample.split("\n")
    n_appears_first = len(n) > 1 and len(n[0]) < len(r[0])
    if len(r) == 1 or n_appears_first:
        return "\n"
    with_n = sum(1 for part in r if part[:1] == "\n")
    return "\r\n" if with_n >= len(r) / 2 else "\r"


def parse(text: str, delimiter: str, newline: str, preview: int = 0) -> ParseResult:
    """`Parser.parse` with a known delimiter and line ending. `preview` stops after that many records."""
    result = ParseResult()
    if not text:
        return result

    if QUOTE not in text:
        lines = text.split(newline)
        for i, line in enumerate(lines):
            result.data.append(line.split(delimiter))
            if preview and i >= preview:
                result.data = result.data[:preview]
                result.truncated = True
                return result
        return result

    data = result.data
    errors = result.errors
    input_len = len(text)
    delim_len = len(delimiter)
    newline_len = len(newline)
    row: list[str] = []
    cursor = 0
    next_delim = text.find(delimiter, cursor)
    next_newline = text.find(newline, cursor)
    quote_search = text.find(QUOTE, cursor)

    def extra_spaces(index: int) -> int:
        """Spaces between the closing quote and `index`, when there is nothing else in between."""
        if index == -1:
            return 0
        between = _js_substring(text, quote_search + 1, index)
        return len(between) if between and js_trim(between) == "" else 0

    def finish(value: str | None = None) -> ParseResult:
        row.append(text[cursor:] if value is None else value)
        data.append(row)
        return result

    while True:
        # Field has opening quote.
        if cursor < input_len and text[cursor] == QUOTE:
            quote_search = cursor
            cursor += 1
            while True:
                quote_search = text.find(QUOTE, quote_search + 1)
                if quote_search == -1:
                    # No closing quote: the rest of the file is this field.
                    errors.append(QuoteError("MissingQuotes", len(data)))
                    return finish()
                if quote_search == input_len - 1:
                    # Closing quote at EOF.
                    return finish(text[cursor:quote_search].replace(_ESCAPED_QUOTE, QUOTE))
                if text[quote_search + 1] == QUOTE:
                    # Escaped quote: part of the data.
                    quote_search += 1
                    continue
                if next_delim != -1 and next_delim < quote_search + 1:
                    next_delim = text.find(delimiter, quote_search + 1)
                if next_newline != -1 and next_newline < quote_search + 1:
                    next_newline = text.find(newline, quote_search + 1)
                check_up_to = next_delim if next_newline == -1 else min(next_delim, next_newline)
                spaces = extra_spaces(check_up_to)
                after = quote_search + 1 + spaces
                if text[after : after + delim_len] == delimiter:
                    # Closing quote followed by the delimiter (maybe after some spaces).
                    row.append(text[cursor:quote_search].replace(_ESCAPED_QUOTE, QUOTE))
                    cursor = after + delim_len
                    if cursor >= input_len or text[cursor] != QUOTE:
                        quote_search = text.find(QUOTE, cursor)
                    next_delim = text.find(delimiter, cursor)
                    next_newline = text.find(newline, cursor)
                    break
                spaces = extra_spaces(next_newline)
                after = quote_search + 1 + spaces
                if text[after : after + newline_len] == newline:
                    # Closing quote followed by a line break (maybe after some spaces).
                    row.append(text[cursor:quote_search].replace(_ESCAPED_QUOTE, QUOTE))
                    cursor = after + newline_len
                    data.append(row)
                    row = []
                    next_newline = text.find(newline, cursor)
                    next_delim = text.find(delimiter, cursor)
                    quote_search = text.find(QUOTE, cursor)
                    if preview and len(data) >= preview:
                        result.truncated = True
                        return result
                    break
                # A quote in the middle of a quoted field that does not close it.
                errors.append(QuoteError("InvalidQuotes", len(data)))
                quote_search += 1
            continue

        # Next delimiter comes before next newline: end of field.
        if next_delim != -1 and (next_delim < next_newline or next_newline == -1):
            row.append(text[cursor:next_delim])
            cursor = next_delim + delim_len
            next_delim = text.find(delimiter, cursor)
            continue

        # End of row.
        if next_newline != -1:
            row.append(text[cursor:next_newline])
            cursor = next_newline + newline_len
            data.append(row)
            row = []
            next_newline = text.find(newline, cursor)
            if preview and len(data) >= preview:
                result.truncated = True
                return result
            continue

        break

    return finish()


def _js_substring(text: str, start: int, end: int) -> str:
    """`String.prototype.substring`: clamps to the string and swaps the ends when start > end."""
    start = max(0, min(start, len(text)))
    end = max(0, min(end, len(text)))
    return text[min(start, end) : max(start, end)]


def guess_delimiter(text: str, newline: str, candidates: tuple[str, ...]) -> str | None:
    """`ParserHandle.guessDelimiter` with skipEmptyLines "greedy": the most consistent field count across the
    first 10 records wins, the larger average breaks ties; it needs about two fields per row to count."""
    best: str | None = None
    best_delta = 0
    max_field_count = 0.0
    for candidate in candidates:
        delta = 0
        total = 0
        empty = 0
        previous: int | None = None
        preview = parse(text, candidate, newline, preview=10).data
        for fields in preview:
            if js_trim("".join(fields)) == "":
                empty += 1
                continue
            count = len(fields)
            total += count
            if previous is None:
                previous = count
            elif count > 0:
                delta += abs(count - previous)
                previous = count
        average = (total / (len(preview) - empty) if len(preview) > empty else math.nan) if preview else 0.0
        if average > 1.99 and (
            best is None or delta < best_delta or (delta == best_delta and average > max_field_count)
        ):
            best = candidate
            best_delta = delta
            max_field_count = average
    return best
