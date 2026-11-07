"""What the uploaded bytes are (by content, not by name), how text is decoded, and the ZIP bomb guard."""

from __future__ import annotations

import codecs
import copy
import io
import zipfile
from dataclasses import dataclass
from typing import Literal

from charset_normalizer import from_bytes

from .migrator.pipeline import MigrationError

SourceFormat = Literal["csv", "xlsx", "xls"]
EncodingName = Literal["utf-8", "utf-16le", "utf-16be", "windows-1252", "ibm850", "macintosh"]
DetectedBy = Literal["bom", "utf-8", "charset-normalizer", "fallback"]

#: Extensions accepted at all. The content decides how the file is read.
EXTENSIONS: dict[str, SourceFormat] = {".csv": "csv", ".txt": "csv", ".xlsx": "xlsx", ".xlsm": "xlsx", ".xls": "xls"}

_ZIP = (b"PK\x03\x04", b"PK\x05\x06")
_OLE2 = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"
#: Formats people upload by mistake; recognised so the message can say what the file is.
_OTHER_BINARIES = {
    b"%PDF": "un PDF",
    b"\x89PNG": "una imagen",
    b"\xff\xd8\xff": "una imagen",
    b"GIF8": "una imagen",
    b"\x1f\x8b": "un archivo comprimido",
    b"7z\xbc\xaf": "un archivo comprimido",
    b"Rar!": "un archivo comprimido",
    b"MZ": "un programa",
    b"\x7fELF": "un programa",
}

UNSUPPORTED_NAME = (
    "Sube un archivo .csv, .xlsx o .xls. Si viene de otro programa, ábrelo y guárdalo en uno de esos formatos."
)


def extension_of(filename: str) -> str:
    dot = filename.rfind(".")
    return filename[dot:].lower() if dot > 0 else ""


def check_name(filename: str) -> None:
    if extension_of(filename) not in EXTENSIONS:
        raise MigrationError("unsupported_file", UNSUPPORTED_NAME)


def sniff(data: bytes) -> SourceFormat:
    """The format by its first bytes: a ZIP that holds a workbook is .xlsx, an OLE2 compound file is .xls,
    and anything that is not a known binary is read as text."""
    if data.startswith(_ZIP):
        return "xlsx"
    if data.startswith(_OLE2):
        return "xls"
    for magic, what in _OTHER_BINARIES.items():
        if data.startswith(magic):
            raise MigrationError(
                "unsupported_file", f"El archivo parece {what}, no una hoja de cálculo. {UNSUPPORTED_NAME}"
            )
    return "csv"


# --- Text ------------------------------------------------------------------------------------------------


@dataclass(frozen=True)
class Decoded:
    text: str
    encoding: EncodingName
    detected_by: DetectedBy


def _whatwg_c1(error: UnicodeError) -> tuple[str, int]:
    """Bytes that Python's cp1252 leaves undefined (0x81, 0x8D, 0x8F, 0x90, 0x9D) decode to the same code
    point, as browsers do (WHATWG Encoding Standard), instead of failing."""
    if not isinstance(error, UnicodeDecodeError):
        raise error
    return "".join(chr(byte) for byte in error.object[error.start : error.end]), error.end


codecs.register_error("whatwg-c1", _whatwg_c1)

#: Single-byte code pages Spanish files come in: Excel and Windows (cp1252), DOS-era systems (cp850, common in
#: old accounting software) and old Macs. charset-normalizer picks among these only; left free it often says
#: cp1250 (Central European) for Spanish text, which gets ñ and accents wrong.
_CANDIDATES: dict[str, EncodingName] = {"cp1252": "windows-1252", "cp850": "ibm850", "mac_roman": "macintosh"}
_PYTHON_CODEC: dict[EncodingName, str] = {"windows-1252": "cp1252", "ibm850": "cp850", "macintosh": "mac_roman"}

NOT_TEXT = "El archivo no es texto plano. Si viene de Excel, súbelo como .xlsx o guárdalo como «CSV UTF-8»."


def decode_text(data: bytes) -> Decoded:
    """BOM first, then strict UTF-8 (as the browser does), then the most likely Spanish code page."""
    decoded = _decode(data)
    if "\x00" in decoded.text:
        raise MigrationError("unsupported_file", NOT_TEXT)
    return decoded


def _decode(data: bytes) -> Decoded:
    if data.startswith(codecs.BOM_UTF8):
        return Decoded(data[3:].decode("utf-8", errors="replace"), "utf-8", "bom")
    if data.startswith(codecs.BOM_UTF16_LE):
        return Decoded(data[2:].decode("utf-16-le", errors="replace"), "utf-16le", "bom")
    if data.startswith(codecs.BOM_UTF16_BE):
        return Decoded(data[2:].decode("utf-16-be", errors="replace"), "utf-16be", "bom")
    try:
        return Decoded(data.decode("utf-8"), "utf-8", "utf-8")
    except UnicodeDecodeError:
        pass
    best = from_bytes(data, cp_isolation=list(_CANDIDATES)).best()
    if best is not None and best.encoding in _CANDIDATES:
        name = _CANDIDATES[best.encoding]
        return Decoded(data.decode(_PYTHON_CODEC[name], errors="whatwg-c1"), name, "charset-normalizer")
    return Decoded(data.decode("cp1252", errors="whatwg-c1"), "windows-1252", "fallback")


# --- ZIP (xlsx) --------------------------------------------------------------------------------------------


@dataclass(frozen=True)
class ZipLimits:
    #: Uncompressed bytes of every part together.
    max_total: int
    max_entries: int
    #: Compression ratio above which a large part is refused (real workbooks stay well under 100:1).
    max_ratio: int


_RATIO_APPLIES_FROM = 1024 * 1024
_CHUNK = 64 * 1024

NOT_A_WORKBOOK = "El archivo no es un libro de Excel válido. Ábrelo en Excel y guárdalo de nuevo como .xlsx."
TOO_BIG_INSIDE = (
    "El libro de Excel ocupa demasiado al descomprimirlo para esta demo. "
    "Guarda solo la hoja que necesitas en un libro nuevo, o súbela como CSV."
)


def check_xlsx(data: bytes, limits: ZipLimits) -> None:
    """Refuses ZIP bombs before any Excel parser sees the file. Checks the declared sizes and ratios, then
    decompresses every part in 64 KB chunks (nothing is kept) to prove each one is exactly its declared size:
    a forged header cannot make the parser decompress more than the budget."""
    try:
        archive = zipfile.ZipFile(io.BytesIO(data))
    except (zipfile.BadZipFile, ValueError) as error:
        raise MigrationError("unreadable_file", NOT_A_WORKBOOK) from error
    with archive:
        entries = [info for info in archive.infolist() if not info.is_dir()]
        names = {info.filename for info in entries}
        if "[Content_Types].xml" not in names or "xl/workbook.xml" not in names:
            raise MigrationError(
                "unsupported_file",
                "El archivo es un ZIP, pero no un libro de Excel (.xlsx). Sube un .xlsx, .xls o .csv.",
            )
        if len(entries) > limits.max_entries:
            raise MigrationError("excel_too_large", TOO_BIG_INSIDE)
        if sum(info.file_size for info in entries) > limits.max_total:
            raise MigrationError("excel_too_large", TOO_BIG_INSIDE)
        for info in entries:
            if info.flag_bits & 0x1:
                raise MigrationError(
                    "protected_file", "El libro tiene contraseña. Quítasela en Excel y súbelo de nuevo."
                )
            ratio = info.file_size / max(info.compress_size, 1)
            if info.file_size > _RATIO_APPLIES_FROM and ratio > limits.max_ratio:
                raise MigrationError("excel_too_large", TOO_BIG_INSIDE)

        budget = limits.max_total
        for info in entries:
            probe = copy.copy(info)
            # One byte more than declared: a part that inflates past its header shows up as that extra byte.
            # The CRC check is left to the parser; here it would fire first and hide what really happened.
            probe.file_size = min(info.file_size, budget) + 1
            probe.CRC = None  # type: ignore[assignment]
            inflated = 0
            try:
                with archive.open(probe) as part:
                    while chunk := part.read(_CHUNK):
                        inflated += len(chunk)
                        if inflated > info.file_size or inflated > budget:
                            raise MigrationError("excel_too_large", TOO_BIG_INSIDE)
            except (zipfile.BadZipFile, EOFError, OSError, NotImplementedError) as error:
                raise MigrationError("unreadable_file", NOT_A_WORKBOOK) from error
            if inflated != info.file_size:
                raise MigrationError("unreadable_file", NOT_A_WORKBOOK)
            budget -= inflated
