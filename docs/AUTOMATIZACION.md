# AUTOMATIZACION.md — Demo "Automatización en vivo" (Fase 4, DEC-023)

Un visitante llena un formulario de contacto de prueba y ve, paso a paso, cómo el flujo **"Contacto → lead calificado"** lo valida, lo califica, decide la ruta, redacta la respuesta y lo registra. El correo **no se envía**: se muestra como vista previa. Del clic al resultado tarda **menos de 2 segundos**.

El flujo se **diseña en n8n** y se exporta al repositorio. **El sitio lo ejecuta en Cloudflare** con las mismas reglas: n8n no corre en producción (DEC-023 reemplazó a DEC-021, que lo ejecutaba en Render y tardaba hasta 2 minutos en despertar).

Este archivo es el **contrato entre la página, la API y el flujo**. Si cambia, cambian las piezas y `packages/contracts/src/automation.ts`.

```
Navegador ──POST /api/automation/runs──▶ Edge (Hono, Pages Functions)
   ▲                                        │ 1. Turnstile (sin base de datos)
   │                                        │ 2. runLeadFlow(lead): el flujo, en memoria (< 1 ms)
   └────────── eventos SSE ◀────────────────┘

automations/workflows/lead-demo.json  ← exportado del editor de n8n (fuente de verdad)
   └─ el edge lee de ahí el nombre del flujo y el nodo «Reglas del flujo»
```

## Piezas y dueños

| Pieza | Dónde | Qué hace |
|---|---|---|
| Flujo en n8n | `automations/workflows/lead-demo.json` | El diseño: nodos, expresiones y el JSON de reglas. Se edita en el editor local de n8n |
| Motor | `automations/src/` (paquete `@aim/automations`) | Ejecuta el flujo nodo por nodo, igual que n8n. Sin E/S |
| Paridad | `automations/test/` | Compara el motor con lo que respondió n8n real para 11 contactos de prueba |
| API | `apps/edge/src/routes/automation.ts` | Turnstile y la respuesta SSE |
| Página | `apps/web/src/features/automation/`, `/lab/automatizacion-en-vivo/` | Formulario y visualización paso a paso |
| Contrato | `packages/contracts/src/automation.ts` | Formas de datos (Zod) |

## 1. Navegador → edge

`POST /api/automation/runs` (mismo origen; pasa por `sameOrigin`). No toca la base de datos: la única protección es Turnstile, con un token de un solo uso por ejecución (DEC-023).

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

Errores antes del stream (JSON plano `{ error, message }`, como el resto de la API): `400 invalid_request`, `403 captcha_failed`, `413` (cuerpo de más de 16 KB) y `503 captcha_unavailable` (Turnstile no responde).

El contrato limpia los campos antes del flujo: quita espacios de sobra y caracteres de control, pasa el correo a minúsculas y **omite `company`** si llega vacío. El edge le agrega `serviceTitle`, el nombre visible del servicio.

Si todo está bien, la respuesta es `text/event-stream`, toda de una vez:

| Evento | Datos | Cuándo |
|---|---|---|
| `run` | `{ runId }` | Al empezar (UUID nuevo, no se guarda) |
| `step` | `{ step, data, atMs }` | Cada paso del flujo; `atMs` = ms desde que empezó el flujo |
| `done` | `{ outcome, totalMs }` | Tras el paso `done` |
| `error` | `{ code: "internal", message }` | Si algo falla de nuestro lado |

En Cloudflare el reloj no avanza mientras el código calcula, así que `atMs` y `totalMs` suelen ser `0`: la página los muestra como «menos de 1 ms». El tiempo que sí mide la página es **del clic al resultado**, en el navegador.

## 2. El flujo

Cada paso tiene la forma del cuerpo que envía el nodo **Reportar** correspondiente del flujo de n8n.

| `step` | `data` | Nota |
|---|---|---|
| `received` | `{ flow }` | El nombre del flujo en n8n: «Contacto → lead calificado» (en n8n era el número de ejecución) |
| `validated` | `{ valid: boolean, checks: { id (≤40), label (1–120), ok }[] }` (1–10 elementos) | Reglas de negocio (el formato ya lo validó el contrato). Si `valid` es `false`, el siguiente paso es `done` con `outcome: "rejected"` |
| `scored` | `{ score: entero 0–100, tier: "hot" \| "warm" \| "cold", factors: { label (1–120), points: entero −100..100 }[] }` (0–10 factores) | |
| `routed` | `{ route: "call" \| "proposal" \| "nurture", label (1–120), sla (1–120) }` | |
| `drafted` | `{ subject (1–160), body (1–2000) }` | Vista previa del correo; **no se envía** |
| `recorded` | `{ reference }` | `"AIM-"` + primeros 8 caracteres del `runId` en mayúsculas (`^AIM-[0-9A-F]{8}$`) |
| `done` | `{ outcome: "accepted" \| "rejected" }` | Último paso |

### Reglas del flujo (nodo «Reglas del flujo», editables en n8n)

- **Validar:** `checks` = correo corporativo (no gmail, hotmail, outlook, yahoo, icloud), mensaje con detalle (≥ 40 caracteres), empresa indicada, sin enlaces sospechosos (más de 2 URL en el mensaje). Solo el último hace `valid: false`.
- **Calificar** (tope 100): presupuesto `lt500` 5 · `500-2000` 15 · `2000-5000` 25 · `gt5000` 35 · `unknown` 10; plazo `urgent` 20 · `month` 15 · `flexible` 5; servicio `automation` o `app` 20, el resto (`web`, `chatbot`, `content`) 12; correo corporativo 10; mensaje de 80 caracteres o más 15.
- **Nivel:** `hot` ≥ 70 · `warm` 40–69 · `cold` < 40.
- **Ruta:** `hot` → `call` «Llamada en menos de 24 horas» (24 horas); `warm` → `proposal` «Propuesta por correo en 48 horas» (48 horas); `cold` → `nurture` «Secuencia de contenido útil» (primer envío en 7 días).
- **Redactar:** asunto y cuerpo en español con `{firstName}`, `{service}` y `{fromCompany}`.

El motor lee estas reglas del JSON exportado al construir el sitio: **cambiar una regla en n8n y exportarla cambia el sitio**, sin tocar código.

## 3. Paridad con n8n

- `automations/test/fixtures/leads.json`: 11 contactos de prueba (caliente, tibio, frío, rechazado por enlaces, sin empresa, correo personal con subdominio, emojis y saltos de línea, el límite exacto de 80 caracteres…).
- `automations/test/fixtures/n8n-runs.json`: lo que **n8n real** (la imagen Docker de `automations/`, n8n 2.45.2) reportó para cada uno. Lo graba `pnpm --filter @aim/automations record:n8n` (necesita Docker; ~1 minuto).
- `automations/test/parity.test.ts` (en la CI) exige que el motor devuelva **exactamente** los mismos pasos con los mismos datos, salvo `received`. También exige que la grabación sea de la versión actual del flujo: guarda una huella de los nodos y las conexiones (no de las notas ni de la posición de los nodos).

## 4. Cambiar el flujo

1. Edítalo en el editor local de n8n (`automations/README.md`).
2. `bash automations/scripts/editor-sync.sh export`: exporta, limpia, vuelve a grabar las respuestas de n8n y corre las pruebas.
3. Si cambiaste solo reglas (el nodo «Reglas del flujo»), las pruebas pasan y listo. Si cambiaste la lógica de otro nodo (una expresión, un nodo nuevo), ajusta `automations/src/lead-flow.ts` hasta que la paridad pase. Si cambia la forma de un paso, cambia también el contrato y la página.

## 5. Variables

Ninguna propia: la demo usa el secreto de Turnstile del sitio (`TURNSTILE_SECRET`), como el formulario de contacto.

## 6. Privacidad

- El formulario pide **datos de prueba** (la página lo dice).
- **Nada se guarda**: ni el contacto de prueba ni un conteo por IP. El flujo corre en memoria y la respuesta va directo al navegador.

## 7. Por qué no hay límites por IP

Antes (DEC-021) la API contaba cada ejecución en Neon para cuidar las horas gratis de n8n en Render. En producción, solo abrir esa conexión y contar tardaba ~1,25 s (2,1 s con Neon dormido): más que todo el resto de la demo. Hoy una ejecución no gasta nada que haya que cuidar: una verificación de Turnstile y menos de 1 ms de CPU, sin correos ni almacenamiento. Turnstile exige resolver un desafío por cada ejecución, así que un bot no gana nada repitiéndola.
