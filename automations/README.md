# automations

El flujo **"Contacto → lead calificado"** de la demo **Automatización en vivo** del Lab (contrato en `docs/AUTOMATIZACION.md`). Un visitante llena un contacto de prueba y el flujo lo valida, lo califica, decide la ruta, redacta la respuesta (el correo nunca se envía) y lo registra.

El flujo se **diseña en n8n** y el **sitio lo ejecuta en Cloudflare** (DEC-023): n8n no corre en producción. Así la demo responde en menos de 2 segundos, sin un servidor que despertar.

| Archivo | Qué es |
|---|---|
| `workflows/lead-demo.json` | El flujo, exportado de n8n y versionado. **Es la fuente de verdad.** |
| `src/workflow.ts` | Lee del JSON el nombre del flujo y el nodo **Reglas del flujo** (validadas con Zod). |
| `src/lead-flow.ts` | El motor: ejecuta el flujo nodo por nodo, igual que n8n. Lo usa el edge (`@aim/automations`). |
| `test/parity.test.ts` | Compara el motor con lo que respondió **n8n real** (`test/fixtures/n8n-runs.json`) para los contactos de `test/fixtures/leads.json`. |
| `test/workflow.test.mjs` | Estructura del flujo: ruta del webhook, orden de los pasos, reglas documentadas, sin credenciales. |
| `scripts/record-n8n.mjs` | Graba las respuestas de n8n real: levanta la imagen en Docker y le pasa los contactos de prueba. |
| `scripts/fingerprint.mjs` | Huella del flujo (nodos y conexiones), para saber si la grabación está al día. |
| `Dockerfile`, `scripts/prepare-image.sh`, `scripts/entrypoint.sh` | La imagen de n8n 2.45.2 (fijada por digest) con el flujo ya importado. La usan el editor local y la grabación. |
| `scripts/editor-sync.sh` | Pasa el flujo entre el editor local y el repo (`export` / `import`). |
| `scripts/normalize-workflow.mjs` | Limpia el JSON exportado (sin ids de instancia, fechas ni datos de prueba). |

## Editar el flujo

1. Arranca el editor (necesita Docker):
   ```bash
   docker compose --profile n8n-editor up -d --build n8n-editor
   ```
2. Abre http://localhost:5679. La primera vez n8n pide crear una cuenta: es **solo local** (vive en el volumen `aim_n8n-editor`, nunca sale de tu máquina).
3. Edita **"Contacto → lead calificado"**. Las tablas de puntos, niveles, rutas y las plantillas del correo están juntas en el nodo **Reglas del flujo** (un JSON). Guarda.
4. Exporta al repo:
   ```bash
   bash automations/scripts/editor-sync.sh export
   ```
   Exporta el borrador guardado, lo limpia y lo formatea, **vuelve a grabar** lo que responde n8n real para los contactos de prueba (~1 minuto) y corre las pruebas.
   - Si cambiaste solo el nodo **Reglas del flujo**, las pruebas pasan: revisa el diff y haz commit. El sitio usará las reglas nuevas al publicarse.
   - Si cambiaste la lógica de otro nodo (una expresión, un nodo nuevo), la paridad falla hasta que ajustes `src/lead-flow.ts`. Si cambia la forma de un paso, cambia también `packages/contracts/src/automation.ts`, la página y `docs/AUTOMATIZACION.md`.
5. Si el repo cambió por otro lado, carga esa versión en el editor (reemplaza la del editor):
   ```bash
   bash automations/scripts/editor-sync.sh import
   ```
6. Para empezar de cero (borra tu cuenta local y el flujo del editor), **sin** `down -v`, que también borraría la base de Postgres del proyecto:
   ```bash
   docker compose --profile n8n-editor rm -sf n8n-editor && docker volume rm aim_n8n-editor
   ```

Para grabar sin pasar por el editor (por ejemplo, tras agregar un contacto a `test/fixtures/leads.json`):

```bash
pnpm --filter @aim/automations record:n8n
```

Usa los puertos 15679 (n8n) y 8790 (el sitio de mentira que recibe los pasos); cámbialos con `PARITY_N8N_PORT` y `PARITY_SITE_PORT`.

Reglas al editar:
- El origen del sitio sale **solo** de `$env.AIM_SITE_ORIGIN` (nodo *Preparar ejecución*). Nunca de la petición ni escrito en el flujo.
- Nada de credenciales en n8n.
- Evita el nodo **Code**: el motor tendría que replicar código arbitrario. Prefiere nodos *Set* e *IF* con expresiones cortas.

## Por qué n8n ya no corre en producción

Medido el 2026-11-07 con la misma imagen (`docker run --cpus=… --memory=512m`, flujo completo de un contacto):

| CPU | Arranque hasta estar listo | Primera ejecución | Ejecuciones siguientes |
|---|---|---|---|
| 0,1 (Render Free) | ~72 s en local; 112 s en Render | ~14 s | ~2 s |
| 0,5 (Render Starter) | ~14 s | ~2,1 s | 0,3–1 s |
| 1 | ~17 s | ~1,4 s | 0,2–0,5 s |

Render Free además duerme el servicio tras 15 minutos sin tráfico. Para bajar de 2 segundos haría falta un servidor siempre encendido con 0,5 de CPU o más; el motor en el edge tarda menos de 1 ms (DEC-023).

## La imagen de n8n

Sigue cerrada como cuando corría en Render: sin editor en modo `webhook` (el predeterminado), API interna en un prefijo aleatorio, dueño con un hash aleatorio, sin API pública, sin telemetría, sin ejecuciones guardadas, solo los 6 tipos de nodo del flujo y corre como `node`. Al construirla, `prepare-image.sh` corre el flujo completo contra un sitio de mentira y falla si los siete pasos no llegan en orden.

| Variable | Valor |
|---|---|
| `AIM_SITE_ORIGIN` | Origen al que el flujo reporta los pasos, sin ruta. **Obligatoria**: sin ella el contenedor no arranca. |
| `AIM_N8N_MODE` | `webhook` (por defecto) o `editor` (solo local). |
| `N8N_SSRF_PROTECTION_ENABLED` | `false` en local, porque `host.docker.internal` es una IP privada. |
