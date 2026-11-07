# automations

El n8n de la demo **Automatización en vivo** del Lab (protocolo en `docs/AUTOMATIZACION.md`). Un visitante llena un contacto de prueba, el sitio llama a este n8n y el flujo **"Contacto → lead calificado"** reporta cada paso (validar, calificar, enrutar, redactar, registrar) de vuelta al sitio. El correo nunca se envía.

| Archivo | Qué es |
|---|---|
| `workflows/lead-demo.json` | El flujo, exportado de n8n y versionado. **Es la fuente de verdad.** |
| `Dockerfile` | La imagen: n8n 2.45.2 (fijado por digest) + el flujo ya importado y publicado. |
| `scripts/prepare-image.sh` | Corre una vez al construir la imagen: migra, importa, publica, hace una prueba de humo y calienta la caché. |
| `scripts/entrypoint.sh` | Arranque: modo `webhook` (Render, por defecto) o `editor` (local). Solo ejecuta `n8n start`. |
| `scripts/editor-sync.sh` | Pasa el flujo entre el editor local y el repo (`export` / `import`). |
| `scripts/normalize-workflow.mjs` | Limpia el JSON exportado (sin ids de instancia, fechas ni datos de prueba). |
| `workflow.test.mjs` | Prueba sin Docker: ruta del webhook, orden de los pasos, token, origen, reglas. |

## Dónde corre

- **Producción: Render, plan Free** (512 MB, 0,1 CPU, disco efímero, se duerme tras 15 min sin tráfico). Sin estado: cada arranque parte de la imagen, que ya trae la base SQLite migrada, el flujo publicado y el webhook registrado. Nada se guarda: ni ejecuciones, ni credenciales, ni llaves.
- **Local:** la misma imagen con `docker compose` (servicio `n8n`, perfil `automations`), apuntando al sitio de `pnpm dev:full`.

Al construir la imagen, `prepare-image.sh` arranca n8n tal como en producción contra una copia de la base, corre el flujo completo contra un sitio de mentira y **falla el build** si los siete pasos no llegan en orden. Si el flujo está roto, Render no lo publica.

## Correrlo en local

```bash
pnpm dev:full                                             # sitio + API en http://127.0.0.1:8789
docker compose --profile automations up -d --build n8n    # n8n en http://127.0.0.1:5679
```

El edge local usa `AUTOMATION_N8N_URL=http://127.0.0.1:5679`. Dentro del contenedor el sitio se alcanza como `http://host.docker.internal:8789` (Docker Desktop en WSL2 lo enruta al `127.0.0.1` de WSL; `extra_hosts: host-gateway` lo deja igual en Docker de Linux, donde el sitio tendría que escuchar en `0.0.0.0`). Para otro origen: `AIM_SITE_ORIGIN=http://host.docker.internal:XXXX docker compose ...`.

Apagarlo: `docker compose --profile automations rm -sf n8n`.

## Editar el flujo

1. Arranca el editor (mismo puerto, así que apaga antes el servicio `n8n`):
   ```bash
   docker compose --profile automations rm -sf n8n
   docker compose --profile n8n-editor up -d --build n8n-editor
   ```
2. Abre http://localhost:5679. La primera vez n8n pide crear una cuenta: es **solo local** (vive en el volumen `aim_n8n-editor`, nunca sale de tu máquina).
3. Edita **"Contacto → lead calificado"**. Las tablas de puntos, niveles, rutas y las plantillas del correo están juntas en el nodo **Reglas del flujo** (un JSON). Guarda. Para probar con el sitio, publica el flujo (botón *Publish*) y usa la demo en `pnpm dev:full`.
4. Exporta al repo y revisa el diff:
   ```bash
   bash automations/scripts/editor-sync.sh export
   ```
   Exporta el borrador guardado, lo limpia, lo formatea con Biome y corre `workflow.test.mjs`. Si cambiaste una regla documentada, actualiza `docs/AUTOMATIZACION.md` y el test en el mismo commit.
5. Si el repo cambió por otro lado, carga esa versión en el editor (reemplaza la del editor):
   ```bash
   bash automations/scripts/editor-sync.sh import
   ```
6. Para empezar de cero (borra tu cuenta local y el flujo del editor), **sin** `down -v`, que también borraría la base de Postgres del proyecto:
   ```bash
   docker compose --profile n8n-editor rm -sf n8n-editor && docker volume rm aim_n8n-editor
   ```

Reglas al editar:
- El origen del sitio sale **solo** de `$env.AIM_SITE_ORIGIN` (nodo *Preparar ejecución*). Nunca de la petición (sería SSRF) ni escrito en el flujo.
- Nada de credenciales en n8n: el único secreto es el `callbackToken` de cada ejecución.
- Evita el nodo **Code**: necesita el *task runner*, otro proceso de Node (más memoria y arranque más lento en 0,1 CPU). Si lo agregas, la imagen lo detecta y arranca el runner sola; mide la memoria (abajo) antes de publicar.
- Un tipo de nodo nuevo no requiere tocar nada: la imagen carga exactamente los tipos que usa el JSON.

## Variables

| Variable | Dónde | Valor |
|---|---|---|
| `AIM_SITE_ORIGIN` | Render y `docker-compose.yml` | Origen del sitio, sin ruta: `https://aimweb-9hc.pages.dev` · local `http://host.docker.internal:8789`. **Obligatoria**: sin ella el contenedor no arranca. |
| `PORT` | Render la pone sola | Puerto HTTP (por defecto 5678). |
| `RENDER_EXTERNAL_URL` | Render la pone sola | URL pública; solo aparece en logs. Local: `N8N_WEBHOOK_URL`. |
| `AIM_N8N_MODE` | Solo local | `webhook` (por defecto) o `editor`. El modo editor se niega a arrancar en Render. |
| `N8N_SSRF_PROTECTION_ENABLED` | Solo local (`false`) | En Render queda en `true`: n8n no puede llamar a redes privadas. En local hay que apagarla porque `host.docker.internal` es una IP privada. |

No hay secretos que configurar. La llave de cifrado de n8n se crea al azar en cada arranque (el disco es efímero y no se cifra nada que deba sobrevivir).

## Seguridad: qué queda expuesto

Desde internet solo sirven `GET /healthz`, `GET /healthz/readiness` y `POST /webhook/aim-lead-demo`. Todo lo demás responde 404 (o 401 en `/types/*.json`):

- **Sin editor:** `N8N_DISABLE_UI=true`.
- **Sin API REST interna, login ni alta de dueño:** en cada arranque la API interna, la API pública, los webhooks de prueba y de espera, los formularios y MCP se mueven a un prefijo aleatorio de 128 bits que nadie conoce. Además, el dueño existe desde el primer segundo (`N8N_INSTANCE_OWNER_MANAGED_BY_ENV`) con un hash bcrypt aleatorio que no corresponde a ninguna contraseña: aun conociendo la ruta, `owner/setup` responde 400 y `login` 401 (verificado).
- **API pública apagada** (`N8N_PUBLIC_API_DISABLED=true`) y escondida.
- **Mínimo cargado:** solo los 6 tipos de nodo del flujo (`NODES_INCLUDE`), ningún módulo opcional de n8n (IA, MCP, SSO, insights, etc.) y ningún task runner.
- **Sin telemetría** ni plantillas, avisos de versión, personalización o renovación de licencia.
- **Sin datos:** `EXECUTIONS_DATA_SAVE_ON_SUCCESS=none`, `…_ON_ERROR=none`, sin ejecuciones manuales; el disco se pierde al dormirse.
- **Sin secretos en la imagen ni en el entorno:** la base horneada no tiene llave, dueño ni credenciales. Por eso el flujo puede leer `$env` (`N8N_BLOCK_ENV_ACCESS_IN_NODE=false`): no hay nada sensible que leer.
- **Webhook público:** cualquiera puede llamarlo, pero sin un token válido el sitio responde 401 al primer reporte (`received`) y el flujo se detiene. Una petición sin `runId` (UUID) o sin un token con forma de JWT ni siquiera reporta. Cuerpo máximo 1 MB, 5 ejecuciones a la vez, 120 s por ejecución.
- **Corre como `node`**, nunca como root.

## Números medidos

Con `docker run --cpus=0.1 --memory=512m` (como Render Free), n8n 2.45.2, en WSL2 con Docker Desktop:

| Qué | Medido |
|---|---|
| Arranque en frío hasta `/healthz` = 200 | 43–46 s |
| Hasta `/healthz/readiness` = 200 **y** webhook = 202 (llegan juntos) | 57–77 s (varía con la carga de la máquina) |
| Primer webhook tras despertar: tiempo hasta el 202 | 6–8 s |
| Un flujo completo ya caliente (202 → paso `done`) | ~3–6 s |
| Memoria en reposo | ~340–360 MiB |
| Pico (6 ejecuciones seguidas, sobre 512 MiB) | ~385–400 MiB |
| Construir la imagen (en local) | ~20 s más la descarga de la base (1,8 GB) |

De dónde salen: la caché de compilación de Node (`NODE_COMPILE_CACHE`, 45 MB, se llena al construir) ahorra entre 13 y 35 s de arranque a cambio de ~30–60 MiB de memoria (sin ella: webhook listo a los ~76 s, reposo ~310 MiB, pico ~330 MiB); el tope de heap (`--max-old-space-size=320`) evita que el recolector de basura se coma la CPU (con 256 el webhook tardaba ~117 s en estar listo); y registrar el webhook al construir la imagen hace que esté listo en el mismo instante que `/healthz/readiness` (antes llegaba ~10 s después).

Para medir de nuevo:

```bash
docker build -t aim-n8n:test automations
docker run -d --name n8n-test --cpus=0.1 --memory=512m -p 127.0.0.1:15678:5678 \
  -e AIM_SITE_ORIGIN=https://aimweb-9hc.pages.dev aim-n8n:test
curl -s http://127.0.0.1:15678/healthz/readiness   # repetir hasta {"status":"ok"}
docker stats --no-stream n8n-test
docker rm -f n8n-test
```

## Render

Servicio web Docker en `render.yaml`: contexto `./automations`, `dockerfilePath: ./automations/Dockerfile`, `healthCheckPath: /healthz/readiness`, plan `free`, y `AIM_SITE_ORIGIN` como única variable. El edge despierta n8n sondeando `GET /healthz/readiness` (no `/healthz`, que responde 200 antes de que el webhook exista).
