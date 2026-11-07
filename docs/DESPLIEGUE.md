# DESPLIEGUE.md — Publicar el sitio

El sitio es estático y vive en **Cloudflare Pages**, proyecto `aimweb`, en la cuenta personal de David (DEC-009).

- URL actual: https://aimweb-9hc.pages.dev (`aimweb.pages.dev` ya estaba tomado).
- Dominio elegido: **aimweb.dev** (pendiente de compra, DEC-007).

## Publicar una nueva versión

```bash
wrangler login            # solo la primera vez (o si la sesión venció)
PUBLIC_BASE_URL=https://aimweb-9hc.pages.dev pnpm deploy:web
```

`scripts/deploy-web.sh` compila en modo producción con esa URL (de ella salen canonical, sitemap, Open Graph y datos estructurados) y sube `apps/web/dist` a Pages. Antes de publicar, corre `bash scripts/ci/all.sh`.

Las cabeceras de seguridad salen de `apps/web/public/_headers` y la página 404 de `404.html`.

## API de contactos y panel (Fase 2)

La API (`apps/edge`) se publica junto con el sitio: es la Pages Function de `apps/web/functions/api/[[route]].ts`. La configuración no secreta está en `apps/web/wrangler.jsonc` (`vars`); los secretos se cargan una sola vez.

### Estado (2026-11-06)

| Pieza | Estado |
|---|---|
| Neon | Proyecto **AIM** (`aws-us-east-1`), rama `production`, base `neondb`, migraciones aplicadas |
| Turnstile | Widget `aimweb` (modo administrado, `aimweb-9hc.pages.dev`), site key pública `0x4AAAAAAF2jeRuzru0bOovf` |
| Secretos en Pages | `DATABASE_URL` (pooled), `JWT_SECRET`, `TURNSTILE_SECRET` cargados; **falta `RESEND_API_KEY`** (lo carga David) |

Los secretos se cargaron pasando la salida de `neon connection-string`, `cf turnstile widgets create` y `openssl` directo a `wrangler pages secret put`, sin mostrarlos. Ninguna llave se escribe a mano en un comando ni se pega en el chat: una key pegada en el chat se revoca y se crea otra.

### Lo que hace David (una vez)

Estos pasos crean cuentas o manejan llaves, así que los hace David en su navegador y su terminal:

1. **Neon:** en https://console.neon.tech crea el proyecto `aim` (región `AWS US East 1`, la más cercana a Colombia). Copia dos cadenas de conexión: la **pooled** (para la API) y la **directa** (para migraciones).
2. **Resend:** crea la cuenta con `dacty2003@gmail.com` en https://resend.com y genera una API key con permiso de solo envío. Mientras no haya dominio, Resend solo envía a ese mismo correo, que es el destinatario de los avisos y de los códigos de acceso.
3. **Turnstile:** en el panel de Cloudflare → Turnstile → Agregar widget `aimweb`, con modo administrado y hostname `aimweb-9hc.pages.dev` (y `aimweb.dev` cuando exista). Copia la **site key** (pública) y la **secret key**.
4. Carga los secretos en el proyecto de Pages (cada comando te pide el valor; pégalo tú):
   ```bash
   cd apps/web
   pnpm exec wrangler pages secret put DATABASE_URL --project-name aimweb      # cadena pooled de Neon
   pnpm exec wrangler pages secret put TURNSTILE_SECRET --project-name aimweb  # secret key de Turnstile
   pnpm exec wrangler pages secret put RESEND_API_KEY --project-name aimweb    # API key de Resend
   openssl rand -base64 48 | pnpm exec wrangler pages secret put JWT_SECRET --project-name aimweb
   ```
5. Aplica las migraciones a Neon con la cadena **directa**:
   ```bash
   DATABASE_URL='<cadena directa de Neon>' pnpm db:migrate
   ```

### Publicar con la API

```bash
PUBLIC_BASE_URL=https://aimweb-9hc.pages.dev pnpm deploy:web
```

### Probar en local

```bash
docker compose up -d                      # Postgres :54321 y Mailpit :8026
cp apps/web/.dev.vars.example apps/web/.dev.vars
DATABASE_URL=postgres://aim:aim@127.0.0.1:54321/aim pnpm db:migrate
pnpm dev:full                             # sitio + /api en http://127.0.0.1:8789
```

En local, Turnstile usa las claves de prueba de Cloudflare (siempre pasan) y los correos llegan a Mailpit: http://localhost:8026.

## Asistente IA

La demo del Lab (DEC-011) responde con **Cloudflare Workers AI, modelo Gemma 4** (`@cf/google/gemma-4-26b-a4b-it`), gratis y sin API key: usa el binding `AI` del proyecto de Pages (DEC-018). Si algún día se carga `ANTHROPIC_API_KEY`, el asistente pasa a usar Claude sin cambiar código. Sin ningún modelo disponible, `/api/assistant/*` responde 503 y el resto de la API sigue igual.

### Cómo funciona

- `POST /api/assistant/session` con `{ turnstileToken }`: verifica Turnstile y deja una cookie de sesión de 30 minutos (`HttpOnly`, `Secure`, `SameSite=Strict`, solo para `/api/assistant`).
- `POST /api/assistant/messages` con `{ messages }` (forma y límites en `@aim/contracts`): responde en streaming SSE con `delta`, y al final `done` o `error` (mensaje en español para mostrar). Sin sesión: 401; límites agotados: 429 con `Retry-After`; cupo de Workers AI agotado o sin capacidad: evento `error` "ocupado".
- Lo que sabe sale de `apps/web/src/content`. Después de cambiar ese contenido: `pnpm knowledge` (las pruebas fallan si se olvida).
- Cada mensaje queda en `assistant_usage` (hash de la IP, modelo y tokens) para los límites.
- El **Revisor de código** (`POST /api/assistant/review` con `{ language, code }`, misma forma SSE) vive bajo `/api/assistant` para **compartir la cookie de sesión** (una sola verificación de Turnstile para los dos; la página consulta `GET /api/assistant/session` antes de pedirla), **los mismos límites** por IP y diario (cada revisión es una fila más de `assistant_usage`) y, por tanto, **el mismo cupo gratis** de Workers AI: la entrada de una revisión es más corta que la de un mensaje del chat (sus reglas y hasta 4000 caracteres de código, sin el conocimiento del sitio), aunque su tope de salida es mayor (`ASSISTANT_REVIEW_MAX_TOKENS`); falta medir sus neurons en vivo.

### Configuración

| Variable o binding | Valor | Para qué |
|---|---|---|
| `AI` (binding en `wrangler.jsonc`) | Workers AI | Modelo gratuito por defecto. |
| `ASSISTANT_MODEL` | Gemma 4 en Workers AI; `claude-haiku-5-5` con Anthropic | Cambia el modelo del proveedor activo (un id `@cf/…` para Workers AI). |
| `ASSISTANT_MAX_TOKENS` | `500` | Tope de cada respuesta. |
| `ASSISTANT_REVIEW_MAX_TOKENS` | `800` | Tope de cada revisión de código (cuatro secciones y quizá un arreglo corto). |
| `ASSISTANT_MESSAGES_PER_HOUR` | `15` | Mensajes por visitante (IP) en una hora. |
| `ASSISTANT_DAILY_LIMIT` | `120` (en `wrangler.jsonc`) | Mensajes de todos en 24 horas, para no pasar el cupo gratis. |
| `ANTHROPIC_API_KEY` | (secreto opcional) | Si existe, el asistente usa Claude. |

### Cupo gratuito

Workers AI regala **10.000 neurons al día** en el plan gratuito. Medido en local (2026-11-06): un mensaje usa unos 5.400 tokens de entrada (reglas + conocimiento) y menos de 500 de salida, unos 50–65 neurons, es decir **unos 150–190 mensajes al día gratis**. Por eso el límite diario es 120. Si el cupo se agota, el asistente avisa que está ocupado hasta el día siguiente (UTC) y ofrece WhatsApp y `/contacto/`.

### Pasar a Claude (opcional, de pago)

1. En https://console.anthropic.com crea la cuenta, compra créditos, pon un límite de gasto (p. ej. USD 5) y crea una API key `aimweb-asistente`.
2. Cárgala tú: `cd apps/web && pnpm exec wrangler pages secret put ANTHROPIC_API_KEY --project-name aimweb` (nunca en el chat).
3. Republica (`pnpm deploy:web`): en Pages los secretos nuevos aplican desde la siguiente publicación.

## API Playground (NestJS en Render)

La API de ejemplo **Tareas** (`apps/api`) corre en un contenedor Docker en **Render, plan gratuito** (DEC-014). La consola del Lab (`/lab/api-playground/`) la llama desde el sitio, por eso usa CORS. Todo está descrito en `render.yaml` (Blueprint) y `apps/api/Dockerfile`.

- **URL:** https://aimweb-api.onrender.com (servicio `aimweb-api`, creado por David desde el Blueprint `AIMWEB` el 2026-11-06; verificado: health, `/docs`, CORS del sitio, límite de tasa y sandbox).
- **Documentación:** `<URL>/docs` (Swagger UI) y `<URL>/docs-json` (OpenAPI). **Salud:** `<URL>/api/v1/health`.
- **Plan gratuito:** el servicio se duerme tras unos 15 minutos sin tráfico y tarda alrededor de un minuto en despertar (aceptado en DEC-014). Al dormirse o redesplegarse se pierden los sandboxes, porque viven en memoria.

### Cómo funciona

- Endpoints: `GET` y `POST /api/v1/tasks`, `GET`, `PATCH` y `DELETE /api/v1/tasks/:id`, `GET /api/v1/tasks/stats`.
- Cada petición lleva la cabecera `X-Sandbox-Id` con un UUID que genera la consola. Cada sandbox arranca con 3 tareas de ejemplo, admite hasta 50 y se borra tras 30 minutos sin uso; el proceso guarda como máximo 500 (descarta el menos usado).
- Límite de 60 peticiones por minuto por IP (429 con `Retry-After`). Cada respuesta trae `X-Response-Time`. Todos los errores tienen la forma `ApiError` (`{ error, message, fields? }`).
- Registros en JSON, una línea por petición (método, ruta sin query, estado y ms): panel de Render → **Logs**.

### Configuración

No hay secretos. Las variables están en `render.yaml`:

| Variable | Por defecto | Para qué |
|---|---|---|
| `PORT` | La pone Render | Puerto. Si falta se usa `API_PORT` y, si tampoco está, 3000. |
| `API_CORS_ORIGINS` | `https://aimweb-9hc.pages.dev` | Orígenes que pueden llamar a la API desde el navegador, separados por comas. |
| `API_RATE_LIMIT` | `60` | Peticiones por minuto por IP. |

### Lo que hace David (una vez)

1. **Cuenta:** entra a https://render.com y regístrate con tu GitHub personal (`DalejoGo`, DEC-009). Cuando Render pida acceso a GitHub, dale acceso solo a este repositorio.
2. **Crear el servicio desde el Blueprint:** en el panel, **New → Blueprint**, elige el repositorio y la rama `main`. Render lee `render.yaml` y muestra el servicio `aimweb-api` (Docker, plan Free, región Virginia). Confirma con **Deploy Blueprint**.
3. **Comprobar:** el primer build tarda unos minutos. Cuando el servicio diga **Live**, abre `<URL>/api/v1/health` (debe responder `{"status":"ok",...}`) y `<URL>/docs`.
4. **Anotar la URL real** en este archivo: la consola del Lab la necesitará.

Después, cada push a `main` que toque la API (`apps/api`, `packages/config`, el lockfile o la configuración de pnpm) se despliega solo, **después de que pase el CI** de GitHub (`autoDeployTrigger: checksPass`). Los cambios del sitio no reconstruyen la API (`buildFilter`).

Cuando se conecte `aimweb.dev`, agrega `https://aimweb.dev` a `API_CORS_ORIGINS` en `render.yaml` y haz push.

### Probar la imagen en local

```bash
docker build -f apps/api/Dockerfile -t aim-api .
docker run --rm -p 3000:10000 -e PORT=10000 -e API_CORS_ORIGINS=http://localhost:4321 aim-api
curl http://localhost:3000/api/v1/health          # y http://localhost:3000/docs en el navegador
```

La imagen usa `node:22.23.4-alpine3.24` fijada por digest, instala con `--frozen-lockfile` y corre como el usuario `node` (no root). Para subir de versión de Node, cambia la etiqueta y el digest del `ARG NODE_IMAGE` (respetando los 14 días de DEC-002).

**Si el límite por IP se agota para todos a la vez**, la API está tomando la IP del proxy y no la del visitante: revisa cuántos proxies hay delante y ajusta `trust proxy` en `apps/api/src/app.ts` (hoy es 1).

## Automatización en vivo (n8n en Render)

El n8n de la demo **Automatización en vivo** (DEC-021) corre en **Render, plan gratuito**, como el servicio `aimweb-n8n` de `render.yaml`. El protocolo entre el sitio y n8n está en `docs/AUTOMATIZACION.md`; cómo editar el flujo, en `automations/README.md`.

- **URL esperada:** https://aimweb-n8n.onrender.com (si Render agrega un sufijo, cambia `AUTOMATION_N8N_URL` en `apps/web/wrangler.jsonc` y vuelve a publicar el sitio).
- **Sin estado y sin secretos:** la imagen ya trae el flujo importado y publicado, y el webhook registrado (`automations/scripts/prepare-image.sh`). Al arrancar solo corre `n8n start`. El editor, el registro del dueño y la API pública quedan cerrados desde internet; solo responden `/healthz`, `/healthz/readiness` y `POST /webhook/aim-lead-demo`.
- **El build prueba el flujo:** al construir la imagen se ejecuta el flujo completo contra un sitio de mentira; si los siete pasos no llegan en orden, el build falla y Render no publica.
- **Única variable:** `AIM_SITE_ORIGIN` (a dónde reporta cada paso). Render pone `PORT` y `RENDER_EXTERNAL_URL`.
- **Medido con 0,1 CPU y 512 MB (como Render Free):** listo en 57–77 s tras despertar; la primera llamada tarda 6–8 s y el flujo completo 3–6 s; memoria de 340–400 MB. El sitio espera hasta `AUTOMATION_WAKE_TIMEOUT_SECONDS` (180 s) mostrando el tiempo.
- **Versión:** n8n 2.45.2 fijada por digest (publicada el 2026-10-22, canal beta en ese momento). Pasar a la estable 2.45.4 o más nueva cuando cumpla los 14 días de DEC-002 (desde el 2026-11-09): cambia la etiqueta y el digest en `automations/Dockerfile`; el build vuelve a probar el flujo.

Se publica solo en cada push a `main` que toque `automations/` y pase la CI (`autoDeployTrigger: checksPass` + `buildFilter`).

### Probar la imagen en local

```bash
pnpm dev:full                                             # sitio + API en http://127.0.0.1:8789
docker compose --profile automations up -d --build n8n    # n8n en http://127.0.0.1:5679
```

Con `AUTOMATION_N8N_URL=http://127.0.0.1:5679` en `apps/web/.dev.vars`, la demo de `/lab/automatizacion-en-vivo/` usa ese n8n. Apagarlo: `docker compose --profile automations rm -sf n8n` (**nunca** `down -v`: borra también el Postgres local).

### Lo que hace David (una vez) para los dos servicios nuevos

Los servicios `aimweb-n8n` y `aimweb-pylab` ya están en `render.yaml`. Si Render no los creó solo tras el push:

1. En https://dashboard.render.com → **Blueprints** → `AIMWEB`.
2. Si muestra cambios pendientes, pulsa **Manual Sync** (o **Sync**) y confirma la creación de `aimweb-n8n` y `aimweb-pylab` (Docker, plan Free, Virginia).
3. Cuando ambos digan **Live**, abre `https://aimweb-n8n.onrender.com/healthz/readiness` y `https://aimweb-pylab.onrender.com/health`: deben responder `{"status":"ok"...}`. Si Render les puso otro nombre, avísale a Claude la URL real.

## Migrador en Python (FastAPI en Render)

El motor de Python del Migrador de datos (`services/py-lab`, DEC-022) corre en **Render, plan gratuito**, como el API Playground. El sitio lo llama desde el navegador (CORS) solo cuando el visitante elige «En el servidor (Python + FastAPI)». Todo está en `render.yaml` (servicio `aimweb-pylab`) y `services/py-lab/Dockerfile`.

- **URL esperada:** https://aimweb-pylab.onrender.com (si Render agrega un sufijo al nombre, cambia `PUBLIC_PYLAB_API_URL` en `scripts/deploy-web.sh` y vuelve a publicar).
- **Documentación:** `<URL>/docs` (Swagger UI). **Salud y límites:** `<URL>/health`.
- **Sin secretos ni disco:** cada archivo se procesa en memoria y se descarta. Las variables (CORS, límite por IP, proxies) están en `render.yaml`; los demás límites tienen valores por defecto (`services/py-lab/README.md`).
- **Despierta en ~10 s** (la imagen es pequeña); la página muestra el tiempo mientras espera.
- **Sitio:** `PUBLIC_PYLAB_API_URL` (por defecto en `scripts/deploy-web.sh`) entra en `connect-src` de la CSP. Si está vacía, el sitio solo ofrece el motor del navegador.

Se publica solo en cada push a `main` que toque `services/py-lab` y pase la CI (`autoDeployTrigger: checksPass` + `buildFilter`).

### Probar la imagen en local

```bash
docker build -t aim-pylab services/py-lab
docker run --rm -p 8000:8000 -e PYLAB_CORS_ORIGINS=http://localhost:4321 aim-pylab
curl http://localhost:8000/health          # y http://localhost:8000/docs en el navegador
```

## Conectar aimweb.dev

1. **David compra el dominio** en Cloudflare: panel → Registro de dominios → Registrar dominios → `aimweb.dev`. Al comprarlo en Cloudflare, el DNS queda en la misma cuenta.
2. En el panel: Workers y Pages → `aimweb` → Dominios personalizados → Configurar un dominio → `aimweb.dev` (y, si se quiere, `www.aimweb.dev`). Cloudflare crea el DNS y el certificado. Los `.dev` exigen HTTPS, y Cloudflare lo da automáticamente.
3. Volver a publicar con la nueva URL para que canonical y sitemap apunten al dominio:
   ```bash
   PUBLIC_BASE_URL=https://aimweb.dev pnpm deploy:web
   ```
4. Actualizar este archivo, `.env.example`, el README y DEC-007.

## Historial

- 2026-11-06: primer despliegue. Wrangler 4.152 envía `pages project create` a Workers por defecto, y los Workers quedan bajo el subdominio de la cuenta (`subdominio-de-la-cuenta.workers.dev`), que deja ver el nombre del cliente de la agencia. Se borraron esos dos Workers y el proyecto se creó como Pages clásico (una sola vez con `--force`; las publicaciones siguientes no lo necesitan).
