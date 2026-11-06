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

La demo del Lab (DEC-011) usa Claude desde la misma API (`apps/edge`, rutas `/api/assistant/*`). Sin la llave, esas rutas responden 503 `assistant_unavailable` con un mensaje amable y el resto de la API sigue igual.

### Cómo funciona

- `POST /api/assistant/session` con `{ turnstileToken }`: verifica Turnstile y deja una cookie de sesión de 30 minutos (`HttpOnly`, `Secure`, `SameSite=Strict`, solo para `/api/assistant`). El visitante resuelve Turnstile una vez, no por mensaje.
- `POST /api/assistant/messages` con `{ messages: [{ role: 'user' | 'assistant', content }] }` (hasta 10 mensajes de 1000 caracteres, el último del visitante): responde en streaming SSE con eventos `delta` (`{ text }`), y al final `done` (`{ reason }`) o `error` (`{ error, message }`, mensaje en español para mostrar). Sin sesión válida: 401; con límites agotados: 429 con `Retry-After`.
- Lo que sabe sale de `apps/web/src/content` (servicios, precios "desde", cotizador, preguntas frecuentes, proyectos públicos, Lab, certificados y perfil). Después de cambiar ese contenido hay que regenerarlo; las pruebas fallan si se olvida:
  ```bash
  node scripts/build-assistant-knowledge.mjs          # o --check para solo comprobar
  ```
- Cada mensaje queda en la tabla `assistant_usage` (hash de la IP, modelo y tokens reales) para los límites y el costo.

### Configuración

| Variable | Por defecto | Para qué |
|---|---|---|
| `ANTHROPIC_API_KEY` | (secreto, sin valor) | Llave de la API de Claude. Sin ella el asistente responde 503. |
| `ASSISTANT_MODEL` | `claude-haiku-5-5` | Modelo pequeño y barato: responde a partir de un texto corto. |
| `ASSISTANT_MAX_TOKENS` | `500` | Tope de cada respuesta (unas pocas frases). |
| `ASSISTANT_MESSAGES_PER_HOUR` | `15` | Mensajes por visitante (IP) en una hora. |
| `ASSISTANT_DAILY_LIMIT` | `300` | Mensajes de todos en 24 horas: el techo de la factura. |

Las cuatro últimas son opcionales; para cambiarlas se agregan a `vars` en `apps/web/wrangler.jsonc`.

### Lo que hace David (una vez)

1. **Crear la llave:** entra a https://console.anthropic.com con tu cuenta personal (DEC-009).
   - En **Settings → Billing** compra créditos prepagados (el mínimo alcanza para meses de uso de esta demo).
   - En **Settings → Limits** pon un límite de gasto mensual bajo, por ejemplo USD 5: es el freno final si algo se sale de control.
   - En **API Keys → Create Key** crea una llave llamada `aimweb-asistente` y cópiala; la consola la muestra una sola vez.
2. **Cargarla en Pages** (el comando te pide el valor; pégalo tú, nunca en el chat ni en un archivo):
   ```bash
   cd apps/web
   pnpm exec wrangler pages secret put ANTHROPIC_API_KEY --project-name aimweb
   ```
3. **Aplicar la migración** `0002_assistant_usage` a Neon con la cadena **directa**:
   ```bash
   DATABASE_URL='<cadena directa de Neon>' pnpm db:migrate
   ```
4. Publicar de nuevo (`pnpm deploy:web`). Para probar en local, agrega `ANTHROPIC_API_KEY=...` a tu `apps/web/.dev.vars` (no se versiona).

Si la llave se filtra, revócala en **API Keys** y carga una nueva con el mismo comando.

### Costo estimado

Precios de Claude Haiku 5.5: USD 0,10 por millón de tokens de entrada y USD 0,50 por millón de salida; lo que se lee de la caché cuesta la décima parte y escribirla, 1,25 veces la entrada. El prompt de sistema (reglas + conocimiento, unos 6.000 tokens) se guarda en caché y se reutiliza entre visitantes.

- Por mensaje: entre USD 0,0003 (caché caliente) y unos USD 0,0013 (caché fría, conversación larga y respuesta de 500 tokens).
- Techo con los límites por defecto (300 mensajes al día, todos en el peor caso): unos USD 0,40 al día, cerca de USD 12 al mes.
- Uso realista de un portafolio (decenas de mensajes al día): menos de USD 1 al mes.

El uso real queda en `assistant_usage` (`input_tokens`, `output_tokens`, `cache_read_tokens`, `cache_write_tokens`).

## API Playground (NestJS en Render)

La API de ejemplo **Tareas** (`apps/api`) corre en un contenedor Docker en **Render, plan gratuito** (DEC-014). La consola del Lab la llamará desde el sitio, por eso usa CORS. Todo está descrito en `render.yaml` (Blueprint) y `apps/api/Dockerfile`.

- **URL esperada:** https://aimweb-api.onrender.com. Render arma la URL con el nombre del servicio; si `aimweb-api` ya está tomado, le agrega un sufijo (por ejemplo `aimweb-api-x1y2.onrender.com`). La URL real aparece en el panel del servicio.
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
