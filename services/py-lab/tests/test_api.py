"""HTTP behaviour: health, headers, CORS, upload limits, rate limit, compression, queue and no disk writes."""

from __future__ import annotations

import gzip
import tempfile
import threading
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

import py_lab.main as main_module
from py_lab.main import DOCS_CSP, create_app, display_name
from py_lab.settings import Settings

from .conftest import ERROR_SCHEMA, HEALTH_SCHEMA, PARITY, SITE, Poster, assert_valid, make_settings, workbook_bytes

SAMPLE = (PARITY / "inputs" / "clientes-ejemplo.csv").read_bytes()


def test_health_reports_the_limits(client: TestClient) -> None:
    response = client.get("/health")
    assert response.status_code == 200
    body = response.json()
    assert_valid(HEALTH_SCHEMA, body)
    assert body["limits"] == {
        "maxUploadBytes": 10 * 1024 * 1024,
        "maxRows": 50_000,
        "maxColumns": 50,
        "maxCells": 300_000,
        "formats": ["csv", "xls", "xlsx"],
    }


def test_every_answer_carries_the_security_headers(client: TestClient, post_file: Poster) -> None:
    for response in (client.get("/health"), client.get("/no-existe"), post_file("a.csv", b"a,b\n1,2\n")):
        assert response.headers["x-content-type-options"] == "nosniff"
        assert response.headers["x-frame-options"] == "DENY"
        assert response.headers["referrer-policy"] == "no-referrer"
        assert response.headers["cache-control"] == "no-store"
        assert response.headers["content-security-policy"].startswith("default-src 'none'")


def test_the_docs_page_loads_swagger_with_integrity_and_its_own_policy(client: TestClient) -> None:
    response = client.get("/docs")
    assert response.status_code == 200
    assert 'integrity="sha384-' in response.text
    assert "swagger-ui-dist@5.34.0" in response.text
    assert response.headers["content-security-policy"] == DOCS_CSP
    assert "'unsafe-eval'" not in DOCS_CSP
    spec = client.get("/openapi.json").json()
    body = spec["paths"]["/v1/migrations"]["post"]["requestBody"]["content"]["multipart/form-data"]["schema"]
    assert body["required"] == ["file"]
    assert set(body["properties"]) == {"file", "sheet"}


def test_unknown_routes_answer_with_the_api_error_shape(client: TestClient) -> None:
    response = client.get("/v2/nada")
    assert response.status_code == 404
    assert_valid(ERROR_SCHEMA, response.json())
    assert client.get("/v1/migrations").status_code == 405


def test_cors_allows_only_the_configured_site(client: TestClient) -> None:
    allowed = client.get("/health", headers={"Origin": SITE})
    assert allowed.headers["access-control-allow-origin"] == SITE
    other = client.get("/health", headers={"Origin": "https://otro.example"})
    assert "access-control-allow-origin" not in other.headers
    preflight = client.options("/v1/migrations", headers={"Origin": SITE, "Access-Control-Request-Method": "POST"})
    assert preflight.status_code == 200
    assert "POST" in preflight.headers["access-control-allow-methods"]
    exposed = client.post("/v1/migrations", headers={"Origin": SITE}, files={"file": ("a.csv", SAMPLE)})
    assert exposed.headers["access-control-allow-origin"] == SITE
    assert "Server-Timing" in exposed.headers["access-control-expose-headers"]


def test_a_successful_migration_reports_timings_and_the_engine(post_file: Poster) -> None:
    response = post_file("C:\\fakepath\\clientes.csv", SAMPLE)
    meta = response.json()["meta"]
    assert meta["source"]["name"] == "clientes.csv"
    assert meta["engine"]["name"] == "py-lab"
    assert meta["timings"]["totalMs"] >= meta["timings"]["processMs"]
    assert response.headers["server-timing"].startswith("read;dur=")
    assert response.headers["x-ratelimit-limit"] == "1000"


def test_large_answers_are_compressed(client: TestClient) -> None:
    response = client.post("/v1/migrations", files={"file": ("a.csv", SAMPLE)}, headers={"Accept-Encoding": "gzip"})
    assert response.headers["content-encoding"] == "gzip"
    assert len(gzip.compress(response.content)) < len(response.content)


@pytest.mark.parametrize(
    ("files", "data", "status", "code"),
    [
        ({"sheet": (None, b"Hoja1")}, None, 400, "invalid_request"),
        ({"otro": ("a.csv", b"a\n1")}, None, 400, "invalid_request"),
        ({"file": ("a.pdf", b"a\n1")}, None, 415, "unsupported_file"),
        ({"file": ("a.csv", b"\x89PNG\r\n")}, None, 415, "unsupported_file"),
        ({"file": ("a.csv", b"a,b\x00\x00\x00\n1,2")}, None, 415, "unsupported_file"),
        ({"file": ("a.csv", b"a\n1")}, {"sheet": "x" * 300}, 400, "invalid_request"),
        ({"file": ("a.csv", b"")}, None, 422, "empty_file"),
    ],
)
def test_bad_uploads_get_a_spanish_error(
    client: TestClient, files: dict[str, tuple[str, bytes]] | None, data: dict[str, str] | None, status: int, code: str
) -> None:
    response = client.post("/v1/migrations", files=files, data=data)
    assert response.status_code == status, response.json()
    assert_valid(ERROR_SCHEMA, response.json())
    assert response.json()["error"] == code


def test_a_json_body_is_not_an_upload(client: TestClient) -> None:
    response = client.post("/v1/migrations", json={"file": "a,b"})
    assert response.status_code == 415
    assert response.json()["error"] == "unsupported_media_type"


@contextmanager
def limited(**env: str) -> Iterator[TestClient]:
    with TestClient(create_app(make_settings(**env))) as client:
        yield client


@pytest.fixture
def small_client() -> Iterator[TestClient]:
    with limited(PYLAB_MAX_UPLOAD_MB="1") as client:
        yield client


def test_the_size_limit_is_checked_from_the_declared_length(small_client: TestClient) -> None:
    big = b"a,b\n" + b"1,2\n" * 300_000
    response = small_client.post("/v1/migrations", files={"file": ("a.csv", big)})
    assert response.status_code == 413
    assert response.json() == {
        "error": "file_too_large",
        "message": "El archivo supera el límite de 1 MB. Divídelo en partes más pequeñas o quita las columnas "
        "que no necesites.",
    }


def test_the_size_limit_is_enforced_while_streaming(small_client: TestClient) -> None:
    """Without Content-Length (chunked upload) the limit applies chunk by chunk."""
    boundary = "limite"
    head = f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="a.csv"\r\n\r\n'.encode()

    def body() -> Iterator[bytes]:
        yield head
        for _ in range(40):
            yield b"1,2\n" * 16_384  # 64 KB per chunk, 2.5 MB in all

    response = small_client.post(
        "/v1/migrations", content=body(), headers={"Content-Type": f"multipart/form-data; boundary={boundary}"}
    )
    assert response.status_code == 413
    assert response.json()["error"] == "file_too_large"


def test_row_and_column_limits_use_the_browsers_wording() -> None:
    with limited(PYLAB_MAX_ROWS="3", PYLAB_MAX_COLUMNS="2") as client:
        rows = client.post("/v1/migrations", files={"file": ("a.csv", b"a\n1\n2\n3\n4\n")})
        assert rows.json() == {
            "error": "too_many_rows",
            "message": "El archivo tiene 4 filas y el límite de esta demo es 3. "
            "Divídelo en partes y súbelas por separado.",
        }
        columns = client.post("/v1/migrations", files={"file": ("a.csv", b"a,b,c\n1,2,3\n")})
        assert columns.json()["error"] == "too_many_columns"


def test_the_rate_limit_counts_the_visitor_not_the_proxy() -> None:
    with limited(PYLAB_RATE_LIMIT="2") as client:

        def send(forwarded_for: str) -> int:
            response = client.post(
                "/v1/migrations", files={"file": ("a.csv", b"a\n1\n")}, headers={"X-Forwarded-For": forwarded_for}
            )
            return response.status_code

        assert [send("203.0.113.7"), send("203.0.113.7")] == [200, 200]
        # A forged left-most entry does not give a new allowance: Render appends the real address on the right.
        refused = client.post(
            "/v1/migrations",
            files={"file": ("a.csv", b"a\n1\n")},
            headers={"X-Forwarded-For": "198.51.100.1, 203.0.113.7"},
        )
        assert refused.status_code == 429
        assert_valid(ERROR_SCHEMA, refused.json())
        assert refused.headers["x-ratelimit-remaining"] == "0"
        assert int(refused.headers["retry-after"]) > 0
        assert send("203.0.113.8") == 200


def test_a_second_file_waits_its_turn_and_gives_up_after_the_queue_wait(monkeypatch: pytest.MonkeyPatch) -> None:
    release = threading.Event()
    started = threading.Event()
    original = main_module.process

    def slow(*args: object, **kwargs: object) -> tuple[bytes, dict[str, float]]:
        started.set()
        release.wait(5)
        return original(*args, **kwargs)  # type: ignore[arg-type]

    monkeypatch.setattr(main_module, "process", slow)
    with limited(PYLAB_MAX_CONCURRENT="1", PYLAB_QUEUE_WAIT_SECONDS="0") as client:
        first: dict[str, int] = {}
        worker = threading.Thread(
            target=lambda: first.update(
                status=client.post("/v1/migrations", files={"file": ("a.csv", b"a\n1\n")}).status_code
            )
        )
        worker.start()
        assert started.wait(5)
        busy = client.post("/v1/migrations", files={"file": ("a.csv", b"a\n1\n")})
        release.set()
        worker.join(5)
        assert busy.status_code == 503
        assert busy.json()["error"] == "busy"
        assert busy.headers["retry-after"] == "10"
        assert first["status"] == 200


def test_nothing_is_written_to_disk(post_file: Poster, monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    """The upload, the decoded text and the workbook stay in memory: temporary files are off limits."""

    def forbidden(*_: object, **__: object) -> None:
        raise AssertionError("a temporary file was created")

    for name in ("SpooledTemporaryFile", "NamedTemporaryFile", "TemporaryFile", "mkstemp", "mkdtemp"):
        monkeypatch.setattr(tempfile, name, forbidden)
    monkeypatch.setenv("TMPDIR", str(tmp_path))
    big = b"nombre;correo\n" + b"Ana Maria;ana.maria.gomez@example.com\n" * 40_000  # 1.5 MB: over 1 MB spool
    assert post_file("grande.csv", big).status_code == 200
    assert post_file("libro.xlsx", workbook_bytes({"Hoja1": [["a"], ["1"]]})).status_code == 200
    assert list(tmp_path.iterdir()) == []


def test_display_name_drops_folders_and_control_characters() -> None:
    assert display_name("C:\\Users\\ana\\clientes.csv") == "clientes.csv"
    assert display_name("../../etc/passwd") == "passwd"
    assert display_name("a\x00b\r\n.csv") == "ab.csv"
    assert display_name("") == "archivo"


def test_settings_reject_nonsense() -> None:
    with pytest.raises(ValueError, match="PYLAB_RATE_LIMIT"):
        make_settings(PYLAB_RATE_LIMIT="muchas")
    with pytest.raises(ValueError, match="at least 1"):
        make_settings(PYLAB_MAX_ROWS="0")
    settings: Settings = make_settings(PYLAB_CORS_ORIGINS=" https://a.test/ , ,https://b.test")
    assert settings.cors_origins == ("https://a.test", "https://b.test")
