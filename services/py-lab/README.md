# py-lab

Demos de Python del Lab (FastAPI). Hoy tiene una: el **motor en Python del Migrador de datos**. Recibe un CSV o un libro de Excel, detecta el tipo de cada columna, normaliza correos, teléfonos (E.164), fechas (ISO 8601), montos y nombres, quita duplicados y separa las filas válidas de las que tienen errores, con el motivo en español.

Aplica **exactamente las mismas reglas** que el motor del navegador (`apps/web/src/features/migrator`, TypeScript) y devuelve el mismo `MigrationResult`, más lo que el navegador no puede saber: cómo leyó el archivo (codificación, hoja) y cuánto tardó. Además:

- Lee **Excel** (.xlsx, .xlsm y .xls de Excel 97-2003) con `python-calamine`, y deja elegir la hoja.
- **Detecta la codificación** de los CSV: UTF-8, UTF-16 con BOM, Windows-1252 (lo que guarda Excel en español), IBM 850 (sistemas contables de DOS) y Mac Roman.
- Acepta archivos **más grandes**: 10 MB y 50.000 filas (el navegador: 5 MB y 20.000).
- **No guarda nada**: el archivo vive en memoria mientras dura la petición. Ni disco, ni base de datos, ni registros de acceso.

## Correrlo en local

Necesitas [uv](https://docs.astral.sh/uv/) 0.8.23 o más nuevo. uv instala Python 3.12 si no lo tienes.

```bash
cd services/py-lab
uv sync                      # crea .venv con las versiones exactas de uv.lock
pnpm --filter @aim/py-lab serve   # o: uv run uvicorn py_lab.main:app --app-dir src --reload --port 8000
```

- Documentación interactiva (Swagger): http://localhost:8000/docs
- Estado y límites: http://localhost:8000/health

Para usarlo desde el sitio en local, en la raíz del repo:

```bash
PYLAB_CORS_ORIGINS=http://localhost:4321 pnpm --filter @aim/py-lab serve
PUBLIC_PYLAB_API_URL=http://localhost:8000 pnpm --filter @aim/web dev
```

En `/lab/migrador-de-datos/` aparece la opción «En el servidor (Python + FastAPI)». Si `PUBLIC_PYLAB_API_URL` está vacía, el sitio solo ofrece el motor del navegador.

Con Docker, igual que en Render:

```bash
docker build -t aim-pylab services/py-lab
docker run --rm -p 8000:8000 -e PYLAB_CORS_ORIGINS=http://localhost:4321 aim-pylab
```

## Pruebas y calidad

```bash
pnpm --filter @aim/py-lab lint        # ruff check + ruff format --check
pnpm --filter @aim/py-lab typecheck   # mypy --strict
pnpm --filter @aim/py-lab test        # pytest
```

Las tres corren en `bash scripts/ci/all.sh` (turbo las toma de `package.json`) y en GitHub Actions.

- **Paridad con el navegador** (`tests/test_parity.py`): el motor de TypeScript procesa cada CSV de `tests/parity/inputs` y su resultado queda en `tests/parity/expected` (lo escribe `apps/web/src/features/migrator/parity.test.ts`). pytest envía los mismos bytes a `POST /v1/migrations` y exige el mismo resultado, campo por campo: columnas, razones, valores normalizados, mensajes y números de fila. Si alguien cambia una regla en TypeScript, la prueba web falla hasta regenerar los esperados (`pnpm --filter @aim/web parity:update`), y entonces pytest falla hasta que Python haga lo mismo. Las entradas se generan con `pnpm --filter @aim/py-lab parity:inputs` (salvo `clientes-ejemplo.csv`, que la prueba web copia de `sample.ts`).
- **Contrato**: las formas de datos salen de `packages/contracts/src/migrator.ts` (Zod). `contract/*.schema.json` es su JSON Schema; si queda desactualizado, falla `pnpm --filter @aim/contracts test` (se regenera con `pnpm --filter @aim/contracts schemas:update`). En pytest **cada respuesta** se valida contra esos esquemas, y `tests/test_contract.py` comprueba que los modelos de Pydantic de `/docs` tengan los mismos campos.
- **Detalles de JavaScript reproducidos**: `\s`, `trim()`, `\d` y `\b` de JavaScript, `String(número)` y el decodificador Windows-1252 de los navegadores (`src/py_lab/migrator/jstext.py`). PapaParse está portado (`papaparse.py`) porque el módulo `csv` de Python no se comporta igual con comillas rotas.

## Endpoints

| Método y ruta | Qué hace |
| --- | --- |
| `GET /health` | `{ status, version, limits }`. El sitio la llama al elegir el motor del servidor para despertarlo y conocer los límites. |
| `POST /v1/migrations` | `multipart/form-data` con `file` y, para Excel, `sheet` (opcional). Responde `{ result, meta }` (`MigrationResponse`). |
| `GET /docs` | Swagger UI (swagger-ui-dist 5.34.0 desde jsDelivr, con Subresource Integrity). |

Los errores tienen la forma de las demás APIs de AIM (`ApiError`): `{ "error": "<código>", "message": "<explicación en español>" }`. Códigos: `invalid_request`, `unsupported_media_type`, `unsupported_file`, `file_too_large`, `empty_file`, `header_only`, `too_many_rows`, `too_many_columns`, `too_many_cells`, `sheet_not_found`, `protected_file`, `unreadable_file`, `excel_too_large`, `excel_too_slow`, `rate_limited`, `busy`, `internal`.

## Variables de entorno

| Variable | Por defecto | Para qué |
| --- | --- | --- |
| `PORT` | 8000 | Puerto (Render lo define). |
| `PYLAB_CORS_ORIGINS` | vacío | Orígenes que pueden llamarlo desde el navegador, separados por coma. Vacío: ninguno. |
| `PYLAB_RATE_LIMIT` | 20 | Migraciones por minuto por IP. |
| `PYLAB_TRUSTED_PROXY_HOPS` | 1 | Proxies delante que agregan su IP a `X-Forwarded-For` (Render: 1; sin proxy: 0). |
| `PYLAB_MAX_UPLOAD_MB` | 10 | Tamaño máximo del archivo. |
| `PYLAB_MAX_ROWS` | 50000 | Filas de datos. |
| `PYLAB_MAX_COLUMNS` | 50 | Columnas. |
| `PYLAB_MAX_CELLS` | 300000 | Filas × columnas. |
| `PYLAB_MAX_XLSX_UNCOMPRESSED_MB` | 100 | Lo que puede ocupar un .xlsx descomprimido. |
| `PYLAB_MAX_CONCURRENT` | 1 | Archivos procesados a la vez. |
| `PYLAB_QUEUE_WAIT_SECONDS` | 30 | Cuánto espera en fila el siguiente antes de un 503 `busy`. |
| `PYLAB_EXCEL_MEMORY_MB` | 256 | Memoria del subproceso que lee Excel. |
| `PYLAB_EXCEL_TIMEOUT_SECONDS` | 90 | Tiempo máximo de ese subproceso. |

## Límites y mediciones

Medido con la imagen de `Dockerfile` en `docker run --cpus=0.1 --memory=512m`, como el plan gratuito de Render (512 MB, 0,1 CPU), el 2026-11-06. Los archivos «peor caso» tienen casi todos los valores distintos (la caché por valor no ayuda) y muchos errores.

| Medición | Resultado |
| --- | --- |
| Arranque en frío (`docker run` → primer 200 en `/health`) | 8,1 a 9,0 s (Render suma lo que tarde en asignar la máquina: el sitio avisa que puede tardar hasta un minuto) |
| Memoria en reposo | ≈ 56 MB de RSS del proceso (≈ 39 MB en el cgroup) |
| Archivo de ejemplo (37 filas) | 0,1 s en el servidor |
| CSV de 4,3 MB, 50.000 × 6 (300.000 celdas) | 16 s en el servidor, 18 s en total; pico 258 MB de RSS |
| CSV de 9,9 MB, 30.000 × 10 (300.000 celdas, textos largos) | 17 s en el servidor, 19 s en total; pico 333 MB de RSS (cgroup 313 MB) |
| Excel de 2 MB, 50.000 × 6 (300.000 celdas) | 22 s en el servidor (5,6 s de lectura), 24 s en total; pico 309 MB de RSS del proceso, 287 MB en el cgroup con el subproceso |
| Después de cada archivo | vuelve a ≈ 40-60 MB |
| Archivo sobre el límite (500.000 celdas) | rechazado en ≈ 1 s con `too_many_cells` |

Por qué esos límites: con 500.000 celdas la memoria también cabía (pico ≈ 286 MB), pero el peor caso tardaba 30-40 s en 0,1 CPU. Con 300.000 se queda en ≈ 20 s, y un archivo típico (miles de filas) responde en 1 a 3 s. Se procesa un archivo a la vez (`PYLAB_MAX_CONCURRENT=1`), así el pico de un archivo grande nunca se suma a otro.

Decisiones de rendimiento que salieron de medir:

- Cada valor distinto de una columna se normaliza y valida una sola vez, y las filas se arman con `zip()` (en C).
- El recolector cíclico se apaga mientras se procesa: el resultado son cientos de miles de diccionarios sin ciclos y revisarlos costaba ≈ 20 %.
- `PYTHONMALLOC=malloc` y `malloc_trim` después de cada respuesta: con el asignador propio de Python la memoria en reposo crecía unos MB con cada archivo grande; así vuelve a la base (≈ 25 % más de CPU, aceptable en 512 MB).
- `orjson` escribe el JSON (≈ 6 veces más rápido que `json` con un resultado de 25 MB), y GZip va en nivel 3: un resultado de 36 MB queda en 4,3 MB con el 40 % de la CPU que gasta el nivel 6 (3,7 MB).

## Seguridad

- **Nada toca el disco.** `UploadFile` de FastAPI guarda en un archivo temporal todo lo que pase de 1 MB; aquí el multipart se lee con el parser incremental de python-multipart directo a memoria (`upload.py`). Una prueba bloquea los archivos temporales y verifica que todo funcione igual.
- **El límite de tamaño se aplica mientras llega**: se rechaza por `Content-Length` sin leer el cuerpo y, si no viene, apenas el flujo pasa del límite.
- **El tipo se decide por el contenido**, no por la extensión: ZIP con `xl/workbook.xml` es .xlsx, un documento OLE2 es .xls, PDF, imágenes o ejecutables se rechazan, y el texto con bytes nulos también. La extensión además debe ser .csv, .txt, .xlsx, .xlsm o .xls.
- **Bombas ZIP**: antes de que el lector de Excel vea el archivo se revisan los tamaños declarados, la proporción de compresión y el número de partes, y luego cada parte se descomprime en bloques de 64 KB contando lo que sale, para probar que mide lo que declara (un encabezado falso no engaña al lector).
- **Excel en un subproceso aislado** (`excel_worker.py`, `python -I`): limita su propia memoria (`RLIMIT_AS`), tiene tiempo máximo y, si el lector nativo falla o se queda sin memoria, el servidor responde un error en vez de caerse. Una prueba usa un libro con dos celdas muy separadas (calamine reservaría todo el rectángulo) y verifica que la API responda.
- **CORS** solo para `PYLAB_CORS_ORIGINS`, sin cookies ni credenciales.
- **Límite por IP** (`ratelimit.py`), con `X-RateLimit-*` y `Retry-After`. Detrás de Render la IP del visitante está en `X-Forwarded-For`, pero el cliente puede escribir entradas a la izquierda: se toma la que agregó el proxy de Render, la de más a la derecha (`PYLAB_TRUSTED_PROXY_HOPS=1`, como `trust proxy 1` de la API de NestJS). uvicorn corre con `--proxy-headers --forwarded-allow-ips='*'` solo para que el esquema sea `https` detrás del TLS de Render; su IP de cliente (la de más a la izquierda) no se usa para el límite.
- **Cabeceras**: `Content-Security-Policy: default-src 'none'` en las respuestas JSON (la página `/docs` tiene la suya, con el hash de su script), `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Strict-Transport-Security` y `Cache-Control: no-store`.
- **Sin registros de acceso** (guardarían las IP de los visitantes). Solo se registran los errores 500, con la traza del fallo.
- Corre como usuario sin privilegios en la imagen.

## Librerías

Versiones exactas en `pyproject.toml`; `uv.lock` fija también las transitivas. uv ignora todo lo publicado después de `exclude-newer` (DEC-002: nada con menos de 14 días).

| Librería | Versión | Publicada | Para qué |
| --- | --- | --- | --- |
| fastapi | 0.161.1 | 2026-10-22 | API y OpenAPI |
| starlette (vía FastAPI) | 1.9.0 | 2026-10-18 | CORS, GZip |
| uvicorn | 0.54.0 | 2026-09-25 | Servidor ASGI (sin extras: menos memoria y dependencias) |
| pydantic | 2.14.1 | 2026-10-11 | Modelos de la documentación |
| python-multipart | 0.0.32 | 2026-06-04 | Parser multipart incremental |
| python-calamine | 0.9.0 | 2026-10-16 | Excel (.xlsx y .xls) en Rust |
| charset-normalizer | 3.5.2 | 2026-09-30 | Codificación de los CSV |
| orjson | 3.13.0 | 2026-10-07 | JSON rápido |
| Desarrollo: pytest 9.1.1, httpx2 2.16.0, ruff 0.17.2, mypy 2.4.0, jsonschema 4.26.0, openpyxl 3.1.5 (crea libros de prueba), types-jsonschema, types-openpyxl | | | |

Descartadas, con motivo:

- **pandas y Polars**: el resultado debe ser idéntico al del navegador, y sus reglas son por valor (expresiones regulares de JavaScript, mensajes por celda), así que el trabajo pesado sería Python de todos modos. Medido al importarlas: Polars suma ≈ 53 MB de RSS y 0,5 s (≈ 5 s con 0,1 CPU), pandas ≈ 71 MB y 1,2 s. En 512 MB eso no compra nada; la caché por valor y `zip()` dan la velocidad.
- **openpyxl** para leer: solo .xlsx y bastante más lento y pesado que calamine. Se usa en las pruebas para crear libros.
- **phonenumbers, email-validator y python-dateutil**: validan distinto que el navegador (por ejemplo, dateutil lee 03/04 como 4 de marzo y email-validator acepta dominios internacionalizados que Zod rechaza). La paridad manda: se portaron las reglas del navegador.

### Subir la fecha de `exclude-newer`

```bash
# 1. En pyproject.toml, [tool.uv] exclude-newer = "<hoy menos 14 días>T00:00:00Z"
uv lock --upgrade            # resuelve otra vez con lo publicado hasta esa fecha
# 2. Si cambian las versiones directas, actualiza los "==" de pyproject.toml y vuelve a `uv lock`.
pnpm --filter @aim/py-lab lint && pnpm --filter @aim/py-lab typecheck && pnpm --filter @aim/py-lab test
```

Las imágenes del `Dockerfile` (Python y uv) van por digest; al cambiarlas, elige una etiqueta publicada hace más de 14 días.

## Despliegue (Render)

Servicio web Docker en el plan gratuito, con contexto `services/py-lab` (su `.dockerignore` deja entrar solo `pyproject.toml`, `uv.lock`, `.python-version` y `src/`). Render define `PORT`; el chequeo de salud es `GET /health`. El sitio lo encuentra con `PUBLIC_PYLAB_API_URL` (por defecto `https://aimweb-pylab.onrender.com` en `scripts/deploy-web.sh`), que además entra a `connect-src` de la CSP.
