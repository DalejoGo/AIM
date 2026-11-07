# CONTINUAR.md — Retomar el proyecto desde otro computador

Punto de partida para seguir trabajando en AIM desde otro equipo (por ejemplo, en casa), con o sin Claude. Resume qué está hecho, dónde vive cada cosa, cómo preparar el equipo y qué falta. Actualizado: **2026-11-06**.

## 1. Estado actual

| Pieza | Dónde | Estado |
|---|---|---|
| Sitio público | https://aimweb-9hc.pages.dev (Cloudflare Pages, proyecto `aimweb`) | En vivo |
| API del sitio (`/api/*`) | Misma URL: Pages Function con Hono (`apps/edge`) | En vivo: contactos, login del panel, asistente, revisor, demos, automatización |
| Panel privado | https://aimweb-9hc.pages.dev/admin/ | Validado por David: código por correo y lista de contactos |
| Base de datos | Neon, proyecto **AIM** (`aws-us-east-1`), base `neondb` | Migraciones 0000–0004 |
| API Playground (NestJS) | https://aimweb-api.onrender.com (Render, servicio `aimweb-api`, plan Free) | En vivo; se duerme sin uso |
| n8n de la automatización | https://aimweb-n8n.onrender.com (Render, servicio `aimweb-n8n`, plan Free) | En `render.yaml` (DEC-021); sin estado y sin secretos |
| Migrador en Python (FastAPI) | https://aimweb-pylab.onrender.com (Render, servicio `aimweb-pylab`, plan Free) | En `render.yaml` (DEC-022); no guarda archivos |
| Repositorio | https://github.com/DalejoGo/AIM (rama `main`, público) | CI en GitHub Actions: 1.258 pruebas unitarias (incluye 119 de Python y 14 del flujo de n8n) + 262 E2E |
| Calidad en producción | Lighthouse (`docs/RENDIMIENTO.md`) | Rendimiento 98–99 móvil / 100 escritorio; accesibilidad, buenas prácticas y SEO 100 |
| Seguridad | CSP estricta (DEC-019) + cabeceras en `_headers` | Sin `unsafe-inline` ni `unsafe-eval` |
| Visitas | Cloudflare Web Analytics, sin cookies (DEC-020) | Panel de Cloudflare → Analytics & Logs → Web Analytics → `aimweb-9hc.pages.dev` |
| Dominio propio | `aimweb.dev` | Pendiente de compra (DEC-007) |

### Lab

| Demo | Estado |
|---|---|
| Cotizador, Migrador de datos, Auth Lab | En vivo (corren en el navegador); el Migrador tiene además un motor en Python (FastAPI en Render) para Excel y archivos grandes |
| Asistente IA | En vivo con Gemma 4 en Workers AI, gratis (DEC-018) |
| Seguridad en acción | En vivo: 10 peticiones por minuto (la 11 da 429) + cabeceras explicadas |
| API Playground | En vivo: consola en el sitio llamando a la API de Render (verificado desde producción) |
| Automatización en vivo (n8n) | n8n real en Render: contacto → lead calificado, paso a paso por SSE; el correo es solo vista previa (`docs/AUTOMATIZACION.md`) |
| Revisor de código con IA | En vivo con Gemma 4 (comparte sesión, límites y cupo con el asistente) |

## 2. Servicios y cuentas (todas personales de David, DEC-009)

| Servicio | Para qué | Cómo se entra |
|---|---|---|
| GitHub `DalejoGo` | Código y CI | `gh auth login` |
| Cloudflare (dacty2003@gmail.com) | Sitio, `/api`, Turnstile, Workers AI | `pnpm exec wrangler login` (desde `apps/web`) |
| Neon | Postgres | `neon login` |
| Resend | Correos (avisos y códigos del panel) | https://resend.com |
| Render | API Playground | https://dashboard.render.com |

**Secretos:** ninguno está en el repositorio. Los de producción viven en Cloudflare Pages (`DATABASE_URL`, `JWT_SECRET`, `TURNSTILE_SECRET`, `RESEND_API_KEY`); se listan con `pnpm exec wrangler pages secret list --project-name aimweb`. Nunca pegues una llave en el chat: si pasa, revócala y crea otra.

**No uses URLs `*.workers.dev`:** el subdominio de la cuenta deja ver el nombre del cliente de la agencia (ver `docs/DESPLIEGUE.md`, historial).

## 3. Preparar el computador de casa (una vez)

Requisitos: Git, **Node 22** (con `fnm` o `nvm`), **pnpm 10** (`corepack enable`), **uv 0.8.23 o más nuevo** (Python del Migrador; `pnpm lint`, `pnpm typecheck` y `pnpm test` lo usan; instala Python 3.12 solo: https://docs.astral.sh/uv/getting-started/installation/), Docker y, en Windows, WSL con Ubuntu.

```bash
git clone https://github.com/DalejoGo/AIM.git repopage && cd repopage
```
```bash
fnm use            # o: nvm use (lee .nvmrc → 22)
corepack enable && pnpm install
```
```bash
pnpm --filter @aim/web exec playwright install --with-deps chromium-headless-shell
```
```bash
cp apps/web/.dev.vars.example apps/web/.dev.vars    # valores locales; nunca se versiona
docker compose up -d                                # Postgres :54321, Valkey :6381, Mailpit :8026
DATABASE_URL=postgres://aim:aim@127.0.0.1:54321/aim pnpm db:migrate
```

Sesiones (cada una abre el navegador; la inicias tú):

```bash
cd apps/web && pnpm exec wrangler login && cd ../..
```
```bash
npm install -g neon@8.11.0 && neon login
```
```bash
gh auth login
```

Comprueba que todo está bien:

```bash
bash scripts/ci/all.sh      # lint, tipos, pruebas, build y E2E con accesibilidad
pnpm dev:full               # sitio + /api en http://127.0.0.1:8789 (correos en http://localhost:8026)
```

## 4. Comandos del día a día

| Qué | Comando |
|---|---|
| Probar todo | `bash scripts/ci/all.sh` |
| Sitio + API en local | `pnpm dev:full` |
| n8n de la automatización en local | `docker compose --profile automations up -d --build n8n` (con `pnpm dev:full`; ver `automations/README.md`) |
| Editar el flujo de n8n | `docker compose --profile n8n-editor up -d --build n8n-editor` → http://localhost:5679, luego `bash automations/scripts/editor-sync.sh export` |
| Migrador en Python en local | `pnpm --filter @aim/py-lab serve` (ver `services/py-lab/README.md`) |
| Actualizar lo que sabe el asistente (tras editar contenido) | `pnpm knowledge` |
| Auditoría de rendimiento | `pnpm run audit <url>` (ver `docs/RENDIMIENTO.md`; `pnpm audit` a secas es otra cosa) |
| Migraciones en Neon | `DATABASE_URL="$(neon connection-string --project-id <id de AIM> --database-name neondb)" pnpm db:migrate` |
| Publicar en Cloudflare | `PUBLIC_BASE_URL=https://aimweb-9hc.pages.dev pnpm deploy:web` |
| API Playground, n8n, Migrador en Python | Se publican solos en Render cuando cambia su carpeta (`apps/api`, `automations`, `services/py-lab`) y pasa la CI |

El id del proyecto de Neon sale de `neon projects list`. Editar precios, textos, proyectos y demos sin tocar código: `docs/CONTENIDO.md`.

## 5. Qué falta

### Lo que hace David

- [ ] Comprar `aimweb.dev` cuando se pueda y conectarlo (pasos en `docs/DESPLIEGUE.md`).
- [ ] Revisión final de textos (lista en `docs/PLAN.md`, sección 8): precios, tiempos, preguntas frecuentes, privacidad y las reglas del flujo de n8n.
- [ ] Si Render no creó solos `aimweb-n8n` y `aimweb-pylab`: Blueprint `AIMWEB` → **Manual Sync** (pasos en `docs/DESPLIEGUE.md`).

### Desarrollo (siguiente fase)

- [x] **Fase 4:** Automatización en vivo (n8n en Render) y Migrador en Python (FastAPI en Render).
- [ ] **Fase 5:** blog, versión en inglés y testimonios reales (la analítica sin cookies ya está activa, DEC-020).

### Deuda técnica conocida

- n8n 2.45.2 es una versión del canal beta: pasar a la estable 2.45.4 o más nueva desde el 2026-11-09 (`automations/Dockerfile`, DEC-021).
- n8n en Render Free usa 340–400 MB de 512: si se queda sin memoria, revisar `--max-old-space-size` en `automations/Dockerfile`.
- Render Free da 750 horas al mes para todos los servicios (API, n8n y Python); alcanzan mientras duerman sin tráfico.
- `lab_hits`: las IP que no vuelven dejan hasta 10 filas; agregar una limpieza periódica si crece.
- Cada petición a `/api` abre una conexión nueva a Neon (~1 s desde Colombia). Si se nota lenta, evaluar Hyperdrive de Cloudflare o el driver HTTP de Neon.
- `/lab/asistente-ia/` y `/admin/` aún cargan Zod al inicio (no afecta los puntajes auditados).
- Medir en vivo cuántos neurons gasta una revisión de código (comparte el cupo diario con el asistente; si se agota seguido, bajar `ASSISTANT_REVIEW_MAX_TOKENS`).
- Opcional: que el asistente use `GET /api/assistant/session` para no pedir Turnstile si ya hay sesión del revisor.
- Límites del login: si falla la escritura de auditoría, los límites no cuentan (fallan abiertos).
- Render: tras más tráfico, confirmar que el límite por IP usa la IP del visitante (`trust proxy` en `apps/api/src/app.ts`).
- El token de acceso del panel sigue válido hasta 15 min después de cerrar sesión (diseño de JWT corto).

## 6. Retomar con Claude

La memoria de Claude es de cada computador; este archivo y los de `docs/` son la fuente de verdad. Para arrancar una sesión nueva en casa, abre Claude Code en la carpeta del repo y escribe algo como:

> Estoy retomando el proyecto AIM (repo DalejoGo/AIM). Lee `CLAUDE.md`, `docs/CONTINUAR.md`, `docs/PLAN.md` y `docs/DECISIONES.md`. Trabajo así: pregúntame en estilo entrevista cuando falte información, usa agentes en paralelo y librerías que faciliten la lógica, todo editable y escalable. Puedes hacer commit, push y publicar sin pedirme confirmación si la CI pasa (CLAUDE.md, regla 9). Sigue con: «la siguiente tarea de la sección 5».
