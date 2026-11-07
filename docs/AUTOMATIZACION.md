# AUTOMATIZACION.md — Demo "Automatización en vivo" (Fase 4, DEC-021)

Un visitante llena un formulario de contacto de prueba y ve, paso a paso y en tiempo real, cómo un flujo de **n8n real** lo valida, lo califica, decide la ruta, redacta la respuesta y lo registra. El correo **no se envía**: se muestra como vista previa.

Este archivo es el **contrato entre las tres piezas**. Si cambia, cambian las tres (y `packages/contracts/src/automation.ts`).

```
Navegador ──POST /api/automation/runs──▶ Edge (Hono, Pages Functions)
   ▲            (respuesta SSE)               │ 1. despierta n8n (GET /healthz)
   │                                          │ 2. POST /webhook/<ruta> con runId + token
   │                                          ▼
   │                                    n8n en Render (sin estado)
   │                                          │ un POST por paso, con el token
   │                                          ▼
   └──── eventos SSE ◀── Edge lee la tabla ◀── POST /api/automation/runs/:runId/events
```

## Piezas y dueños

| Pieza | Dónde | Qué hace |
|---|---|---|
| Flujo n8n | `automations/` (JSON versionado, Dockerfile, arranque) | La lógica de negocio: validar, calificar, enrutar, redactar |
| API | `apps/edge/src/routes/automation.ts` | Turnstile, límites, despertar n8n, guardar pasos, SSE al navegador |
| Página | `apps/web/src/features/automation/`, `/lab/automatizacion-en-vivo/` | Formulario y visualización paso a paso |
| Contrato | `packages/contracts/src/automation.ts` | Formas de datos (Zod) de las tres llamadas |

n8n **no guarda secretos**: no conoce la base de datos ni llaves. Solo recibe un token por ejecución y lo devuelve en cada reporte; el edge es quien lo verifica.

## 1. Navegador → edge

`POST /api/automation/runs` (mismo origen; pasa por `sameOrigin`, límite por IP y cupo diario).

```json
{
  "turnstileToken": "…",
  "lead": {
    "name": "Laura Pérez",
    "company": "Café La Montaña",
    "email": "laura@cafelamontana.co",
    "service": "automation",
    "budget": "500-2000",
    "timeline": "month",
    "message": "Queremos que los pedidos de WhatsApp lleguen solos a una hoja y avisen al equipo."
  }
}
```

| Campo | Regla |
|---|---|
| `name` | 2–80 caracteres |
| `company` | opcional, hasta 80 |
| `email` | correo válido, hasta 120 |
| `service` | slug de un servicio de `apps/web/src/content/services/` |
| `budget` | `lt500` · `500-2000` · `2000-5000` · `gt5000` · `unknown` (USD) |
| `timeline` | `urgent` (menos de 2 semanas) · `month` (1–2 meses) · `flexible` |
| `message` | 10–1000 caracteres |

Errores antes del stream (JSON plano `{ error, message }`, como el resto de la API): `400 invalid_request`, `403 captcha_failed`, `413` (cuerpo de más de 16 KB), `429 rate_limited` (con `Retry-After` y cabeceras `RateLimit`), `503 captcha_unavailable` (Turnstile no responde), `503 automation_unavailable` (sin `AUTOMATION_N8N_URL`) y `503 daily_limit`.

El edge limpia los campos antes de enviarlos a n8n: quita espacios de sobra y caracteres de control, pasa el correo a minúsculas y **omite `company`** si llega vacío.

Si todo está bien, la respuesta es `text/event-stream`:

| Evento | Datos | Cuándo |
|---|---|---|
| `run` | `{ runId }` | Al crear la ejecución |
| `waking` | `{ elapsedMs }` | Mientras n8n despierta (Render Free se duerme); cada sondeo |
| `started` | `{}` | n8n aceptó el webhook |
| `step` | `{ step, data, atMs }` | Cada paso que reporta n8n; `atMs` = ms desde justo antes de enviar el webhook (nunca es negativo) |
| `done` | `{ outcome, totalMs }` | Tras el paso `done`; `totalMs` es el `atMs` de ese paso |
| `error` | `{ code, message }` | `n8n_unreachable`, `timeout`, `internal` |

Comentarios `: ping` cada ~10 s para que la conexión no se corte.

### Despertar al abrir la página

Render Free duerme n8n sin tráfico y despertarlo tarda 1–2 minutos (0,1 CPU). Para que esa espera no la sufra el visitante, la página lo despierta **apenas se abre**:

- `GET /api/automation/status` → `{ state: "ready" | "waking" | "disabled" }`. Hace **una** consulta a `/healthz/readiness` con 3 s de tiempo (una petición basta para que Render empiece a arrancar el servicio, aunque se corte) o, sin `AUTOMATION_N8N_URL`, responde `disabled` sin llamar a nada. Sin base de datos ni Turnstile; sin límite por IP, porque la URL de n8n es pública de todas formas y limitar esta ruta no protegería las horas de Render.
- La página (`features/automation/wake.ts`) consulta al cargar y luego cada 5 s mientras diga `waking`; no consulta con la pestaña oculta; se detiene en `ready`, al primer error, a los 180 s o cuando empieza una ejecución. Muestra «Despertando n8n en el servidor gratuito… 0:23 — puedes ir llenando el formulario» y luego «n8n está listo: tu ejecución arrancará al instante».
- Los 180 s son una constante de la página (`WAKE_GIVE_UP_MS`); si cambias `AUTOMATION_WAKE_TIMEOUT_SECONDS`, cámbiala también.

## 2. Edge → n8n

`POST {AUTOMATION_N8N_URL}/webhook/{AUTOMATION_WEBHOOK_PATH}` con `Content-Type: application/json`:

```json
{
  "runId": "0b7c6a2e-…",
  "callbackToken": "<JWT>",
  "lead": { "…mismos campos…": "", "serviceTitle": "Automatizaciones" }
}
```

- n8n responde **de inmediato** con `202` (sin esperar el flujo). **Solo `202` cuenta**: mientras arranca, n8n puede responder `404` o un `200 "n8n is starting up"`.
- `callbackToken`: JWT HS256 firmado por el edge (clave derivada de `JWT_SECRET`), `aud: "aim-automation-callback"`, `sub: runId`, vence en 5 min.
- Antes del webhook el edge sondea `GET {AUTOMATION_N8N_URL}/healthz/readiness` (no `/healthz`, que responde ~15 s antes de que exista el webhook) hasta recibir un `200` que no sea HTML (la página de espera de Render no cuenta; no sigue redirecciones), con 5 s por intento, o hasta `AUTOMATION_WAKE_TIMEOUT_SECONDS`. Presupuesto: **≤ 40 subpeticiones por ejecución** (el plan gratis de Workers permite 50): como máximo 36 sondeos cada ~6 s; si el tiempo de espera pasa de ~210 s, los sondeos se espacian más.
- El webhook tiene 30 s para responder: la primera llamada tras despertar tardó 6–8 s en Render Free.

## 3. n8n → edge (un POST por paso)

`POST {AIM_SITE_ORIGIN}/api/automation/runs/{runId}/events` con `Authorization: Bearer {callbackToken}` y cuerpo `{ "step": "...", "data": { ... } }`.

Esta ruta es servidor a servidor: **no** exige `Origin` (no usa cookies) y se autentica solo con el token.

| Respuesta | Significado | n8n |
|---|---|---|
| `204` | Paso guardado | Sigue |
| `401` | Token inválido, vencido, de otra ejecución o de una ejecución ya borrada (con `WWW-Authenticate: Bearer error="invalid_token"`; el token se revisa antes que el cuerpo) | Se detiene |
| `400` | El cuerpo no cumple el contrato | Se detiene |
| `409` | Ese paso ya se reportó | Se detiene |

### Pasos, en orden

| `step` | `data` | Nota |
|---|---|---|
| `received` | `{ execution: string }` (texto `^[A-Za-z0-9_-]{1,64}$`, no número) | `$execution.id` de n8n: prueba de que corre en n8n de verdad. **Es el primer reporte y sirve de autenticación**: si el edge responde 401, el flujo termina ahí |
| `validated` | `{ valid: boolean, checks: { id (≤40), label (1–120), ok }[] }` (1–10 elementos) | Reglas de negocio (el formato ya lo validó el edge). Si `valid` es `false`, el siguiente paso es `done` con `outcome: "rejected"` |
| `scored` | `{ score: entero 0–100, tier: "hot" \| "warm" \| "cold", factors: { label (1–120), points: entero −100..100 }[] }` (0–10 factores) | |
| `routed` | `{ route: "call" \| "proposal" \| "nurture", label (1–120), sla (1–120) }` | |
| `drafted` | `{ subject (1–160), body (1–2000) }` | Vista previa del correo; **no se envía** |
| `recorded` | `{ reference }` | `"AIM-"` + primeros 8 caracteres del `runId` en mayúsculas (`^AIM-[0-9A-F]{8}$`) |
| `done` | `{ outcome: "accepted" \| "rejected" }` | Último paso |

Las claves desconocidas se descartan sin error. El edge no exige el orden de los pasos; sí que cada paso llegue una sola vez.

### Reglas del flujo (editables en n8n)

- **Validar:** `checks` = correo corporativo (no gmail, hotmail, outlook, yahoo, icloud), mensaje con detalle (≥ 40 caracteres), empresa indicada, sin enlaces sospechosos (más de 2 URL en el mensaje). Solo el último hace `valid: false`.
- **Calificar** (tope 100): presupuesto `lt500` 5 · `500-2000` 15 · `2000-5000` 25 · `gt5000` 35 · `unknown` 10; plazo `urgent` 20 · `month` 15 · `flexible` 5; servicio `automation` o `app` 20, el resto (`web`, `chatbot`, `content`) 12; correo corporativo 10; mensaje de 80 caracteres o más 15.
- **Nivel:** `hot` ≥ 70 · `warm` 40–69 · `cold` < 40.
- **Ruta:** `hot` → `call` "Llamada en menos de 24 horas"; `warm` → `proposal` "Propuesta por correo en 48 horas"; `cold` → `nurture` "Secuencia de contenido útil".
- **Redactar:** asunto y cuerpo en español, con el nombre, el servicio y la ruta.

## 4. Variables

| Variable | Dónde | Ejemplo |
|---|---|---|
| `AUTOMATION_N8N_URL` | Edge (`wrangler.jsonc`, `.dev.vars`) | `https://aimweb-n8n.onrender.com` · local `http://127.0.0.1:5679` |
| `AUTOMATION_WEBHOOK_PATH` | Edge | `aim-lead-demo` |
| `AUTOMATION_DAILY_LIMIT` | Edge | `150` |
| `AUTOMATION_WAKE_TIMEOUT_SECONDS` | Edge | `180` |
| `AUTOMATION_BURST_LIMIT` | Edge | `3` ejecuciones por IP… |
| `AUTOMATION_BURST_WINDOW_SECONDS` | Edge | …cada `600` s |
| `AIM_SITE_ORIGIN` | n8n (Render, `docker-compose.yml`) | `https://aimweb-9hc.pages.dev` |

## 5. Privacidad

- El formulario pide **datos de prueba** (la página lo dice).
- El edge borra ejecuciones y pasos de más de 1 hora en cada ejecución nueva. La tabla de ejecuciones guarda solo el id y la hora; los pasos (incluido el correo redactado con el nombre de prueba) viven en `automation_events` hasta ese borrado.
- Para los límites se guarda una huella HMAC de la IP con la hora durante 24 horas (`automation_usage`), nunca la IP.
- n8n no guarda ejecuciones (`EXECUTIONS_DATA_SAVE_ON_SUCCESS=none`, `…_ON_ERROR=none`) y su disco se pierde al dormirse.
