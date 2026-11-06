# RENDIMIENTO.md — Auditoría Lighthouse

Meta (PLAN.md §5 y DISENO.md): **95 o más** en Rendimiento, Accesibilidad, Buenas prácticas y SEO, en móvil y en escritorio, para una página de cada tipo: `/`, `/servicios/`, `/proyectos/marea/`, `/cotizar/`, `/lab/`, `/lab/migrador-de-datos/`, `/sobre-mi/` y `/contacto/`.

## Cómo correrla

```bash
cd apps/web
pnpm exec astro build --outDir /tmp/aim-lh-build
node e2e/serve.mjs 4370 /tmp/aim-lh-build &      # sirve el build como Cloudflare (índices y 404)
cd ../..
pnpm run audit http://localhost:4370                # las 8 páginas, móvil y escritorio
pnpm run audit http://localhost:4370 --runs 3       # mediana de 3 corridas (más estable)
pnpm run audit https://aimweb-9hc.pages.dev --pages /,/contacto/ --devices mobile
```

- `pnpm audit` a secas es la auditoría de dependencias de pnpm: hay que escribir `pnpm run audit`.
- El script (`scripts/lighthouse.mjs`) usa Lighthouse 13 en Chrome sin ventana: `CHROME_PATH` si está definido o, si no, el Chromium que descargó Playwright. Móvil es la emulación por defecto de Lighthouse (Moto G Power, 4G lenta, CPU 4× más lenta); escritorio usa `--preset=desktop`.
- Opciones: `--pages` (lista separada por comas), `--devices mobile,desktop`, `--runs N`, `--reports <carpeta>` (JSON completos; por defecto, una carpeta temporal), `--out <archivo>` y `--strict` (termina con error si algo queda por debajo de 95, para CI).
- Reescribe solo el bloque entre `<!-- audit:start -->
_Generado por `scripts/lighthouse.mjs` el 2026-11-06 17:10 contra `https://aimweb-9hc.pages.dev`. Lighthouse 13.5.0, 1 corrida(s) por página y dispositivo (se toma la mediana por rendimiento). En negrita, lo que queda por debajo de 95._

| Página | Dispositivo | Rendimiento | Accesibilidad | Buenas prácticas | SEO | FCP | LCP | TBT | CLS |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| `/` | Móvil | 99 | 100 | 100 | 100 | 1,2 s | 1,9 s | 0 ms | 0,000 |
| `/` | Escritorio | 100 | 100 | 100 | 100 | 0,4 s | 0,5 s | 0 ms | 0,000 |
| `/servicios/` | Móvil | 99 | 100 | 100 | 100 | 1,2 s | 1,9 s | 0 ms | 0,000 |
| `/servicios/` | Escritorio | 100 | 100 | 100 | 100 | 0,3 s | 0,4 s | 0 ms | 0,000 |
| `/proyectos/marea/` | Móvil | 99 | 100 | 100 | 100 | 1,3 s | 2,0 s | 0 ms | 0,000 |
| `/proyectos/marea/` | Escritorio | 100 | 100 | 100 | 100 | 0,3 s | 0,4 s | 0 ms | 0,000 |
| `/cotizar/` | Móvil | 99 | 100 | 100 | 100 | 1,2 s | 2,0 s | 24 ms | 0,000 |
| `/cotizar/` | Escritorio | 100 | 100 | 100 | 100 | 0,4 s | 0,5 s | 0 ms | 0,000 |
| `/lab/` | Móvil | 99 | 100 | 100 | 100 | 1,2 s | 1,9 s | 0 ms | 0,000 |
| `/lab/` | Escritorio | 100 | 100 | 100 | 100 | 0,3 s | 0,4 s | 0 ms | 0,000 |
| `/lab/migrador-de-datos/` | Móvil | 99 | 100 | 100 | 100 | 1,4 s | 2,0 s | 14 ms | 0,000 |
| `/lab/migrador-de-datos/` | Escritorio | 100 | 100 | 100 | 100 | 0,4 s | 0,5 s | 0 ms | 0,000 |
| `/sobre-mi/` | Móvil | 99 | 100 | 100 | 100 | 1,2 s | 2,2 s | 0 ms | 0,000 |
| `/sobre-mi/` | Escritorio | 100 | 100 | 100 | 100 | 0,4 s | 0,5 s | 0 ms | 0,000 |
| `/contacto/` | Móvil | 98 | 100 | 100 | 100 | 1,5 s | 2,1 s | 65 ms | 0,000 |
| `/contacto/` | Escritorio | 100 | 100 | 100 | 100 | 0,4 s | 0,6 s | 0 ms | 0,000 |

Todas las categorías están en 95 o más.
<!-- audit:end -->` de este archivo; el resto se escribe a mano.
- En local no hay compresión ni caché (el servidor de `e2e/serve.mjs` no las aplica); Cloudflare sí comprime (Brotli) y `public/_headers` deja `/_astro/*` en caché inmutable. Por eso los avisos de Lighthouse sobre caché y latencia del documento son propios del entorno local, y en producción los tiempos deberían ser iguales o mejores.

## Último resultado

<!-- audit:start -->
_Generado por `scripts/lighthouse.mjs` el 2026-11-06 16:22 contra `http://localhost:4373`. Lighthouse 13.5.0, 3 corrida(s) por página y dispositivo (se toma la mediana por rendimiento). En negrita, lo que queda por debajo de 95._

| Página | Dispositivo | Rendimiento | Accesibilidad | Buenas prácticas | SEO | FCP | LCP | TBT | CLS |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| `/` | Móvil | 99 | 100 | 100 | 100 | 1,4 s | 2,1 s | 0 ms | 0,000 |
| `/` | Escritorio | 100 | 100 | 100 | 100 | 0,3 s | 0,5 s | 0 ms | 0,000 |
| `/servicios/` | Móvil | 99 | 100 | 100 | 100 | 1,2 s | 2,0 s | 0 ms | 0,000 |
| `/servicios/` | Escritorio | 100 | 100 | 100 | 100 | 0,3 s | 0,4 s | 0 ms | 0,000 |
| `/proyectos/marea/` | Móvil | 99 | 100 | 100 | 100 | 1,2 s | 2,0 s | 0 ms | 0,000 |
| `/proyectos/marea/` | Escritorio | 100 | 100 | 100 | 100 | 0,3 s | 0,4 s | 0 ms | 0,000 |
| `/cotizar/` | Móvil | 99 | 100 | 100 | 100 | 1,4 s | 2,0 s | 30 ms | 0,000 |
| `/cotizar/` | Escritorio | 100 | 100 | 100 | 100 | 0,4 s | 0,5 s | 0 ms | 0,000 |
| `/lab/` | Móvil | 99 | 100 | 100 | 100 | 1,2 s | 2,0 s | 0 ms | 0,000 |
| `/lab/` | Escritorio | 100 | 100 | 100 | 100 | 0,3 s | 0,4 s | 0 ms | 0,000 |
| `/lab/migrador-de-datos/` | Móvil | 99 | 100 | 100 | 100 | 1,4 s | 2,1 s | 0 ms | 0,000 |
| `/lab/migrador-de-datos/` | Escritorio | 100 | 100 | 100 | 100 | 0,4 s | 0,6 s | 0 ms | 0,000 |
| `/sobre-mi/` | Móvil | 99 | 100 | 100 | 100 | 1,2 s | 2,1 s | 0 ms | 0,000 |
| `/sobre-mi/` | Escritorio | 100 | 100 | 100 | 100 | 0,3 s | 0,5 s | 0 ms | 0,000 |
| `/contacto/` | Móvil | 98 | 100 | 100 | 100 | 1,5 s | 2,3 s | 0 ms | 0,000 |
| `/contacto/` | Escritorio | 100 | 100 | 100 | 100 | 0,4 s | 0,5 s | 0 ms | 0,000 |

Todas las categorías están en 95 o más.
<!-- audit:end -->

## Línea base (2026-11-06, antes de las mejoras)

Misma build local y mismo método, una corrida por página y dispositivo. Ya cumplía la meta, pero `/cotizar/` en móvil estaba en el límite (95).

| Página | Dispositivo | Rendimiento | Accesibilidad | Buenas prácticas | SEO | FCP | LCP | TBT | CLS |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| `/` | Móvil | 96 | 100 | 100 | 100 | 2,3 s | 2,3 s | 0 ms | 0,001 |
| `/` | Escritorio | 100 | 100 | 100 | 100 | 0,5 s | 0,6 s | 0 ms | 0,038 |
| `/servicios/` | Móvil | 97 | 100 | 100 | 100 | 1,8 s | 2,2 s | 0 ms | 0,005 |
| `/servicios/` | Escritorio | 100 | 100 | 100 | 100 | 0,4 s | 0,5 s | 0 ms | 0,002 |
| `/proyectos/marea/` | Móvil | 98 | 100 | 100 | 100 | 1,8 s | 2,0 s | 0 ms | 0,016 |
| `/proyectos/marea/` | Escritorio | 100 | 100 | 100 | 100 | 0,4 s | 0,5 s | 0 ms | 0,001 |
| `/cotizar/` | Móvil | 95 | 100 | 100 | 100 | 2,2 s | 2,4 s | 0 ms | 0,006 |
| `/cotizar/` | Escritorio | 100 | 100 | 100 | 100 | 0,5 s | 0,6 s | 0 ms | 0,021 |
| `/lab/` | Móvil | 98 | 100 | 100 | 100 | 1,8 s | 2,0 s | 0 ms | 0,016 |
| `/lab/` | Escritorio | 100 | 100 | 100 | 100 | 0,4 s | 0,5 s | 0 ms | 0,043 |
| `/lab/migrador-de-datos/` | Móvil | 97 | 100 | 100 | 100 | 2,1 s | 2,2 s | 25 ms | 0,009 |
| `/lab/migrador-de-datos/` | Escritorio | 100 | 100 | 100 | 100 | 0,5 s | 0,5 s | 0 ms | 0,023 |
| `/sobre-mi/` | Móvil | 98 | 100 | 100 | 100 | 1,8 s | 2,1 s | 0 ms | 0,006 |
| `/sobre-mi/` | Escritorio | 100 | 100 | 100 | 100 | 0,5 s | 0,5 s | 0 ms | 0,008 |
| `/contacto/` | Móvil | 97 | 100 | 100 | 100 | 1,8 s | 2,0 s | 104 ms | 0,000 |
| `/contacto/` | Escritorio | 100 | 100 | 100 | 100 | 0,5 s | 0,6 s | 0 ms | 0,021 |

Lo que restaba puntos en móvil: dos hojas de estilo bloqueantes en `/`, `/cotizar/` y el Lab (la de JetBrains Mono iba aparte), Zod (92 KB sin comprimir) en la carga inicial de `/contacto/` y del migrador, y el logo de 128 px mostrado a 29 × 32.

## Mejoras aplicadas (2026-11-06)

En conjunto: rendimiento móvil de 95–98 a 98–99, FCP móvil de 1,8–2,3 s a 1,2–1,5 s, TBT de `/contacto/` de 104 ms a 0 y CLS 0 en todas las páginas. Escritorio sigue en 100.

- **Una sola hoja de estilos.** Las `@font-face` de JetBrains Mono pasan a la hoja global (`Base.astro`) en lugar de una hoja aparte en `Hero.astro` y `LabShell.astro`. Una `@font-face` no descarga nada hasta que se dibuja un carácter con esa fuente, así que no pesa en las páginas sin código. Solo con este cambio, FCP móvil de `/` pasó de 2,3 a 2,0 s y el de `/cotizar/` y el migrador, de 2,2 y 2,1 a 1,8 s.
- **Precarga de las fuentes del titular y del texto** (`unbounded-latin` e `instrument-sans-latin`, con `crossorigin`). Fontsource ya usa `font-display: swap`. Sin la precarga, al acelerar la hoja de estilos la primera pintura salía con la fuente de respaldo y el texto se movía al cambiar (CLS 0,123 en `/cotizar/` móvil); con ella, CLS 0.
- **Logo a su tamaño.** `aim-logo-{light,dark}-64.webp` (64 px de alto, 2,8 y 3,3 KB) con `srcset`/`sizes`; el de 128 px queda para pantallas de más densidad. Antes se bajaban 7 y 9,6 KB para dibujar 29 × 32.
- **JavaScript que no hace falta al cargar:**
  - Migrador de datos: el procesamiento (PapaParse, Zod) y los paneles de resultado (`features/migrator/Results.tsx`) se cargan con el primer archivo. La carga inicial de la isla baja de ~150 KB a 16 KB sin comprimir.
  - Contacto: la validación (`lib/lead.ts`) y el cliente de la API (`lib/api.ts`), que traen Zod, se cargan al enfocar el formulario o al enviarlo. TBT móvil: de 104 ms a 0–10 ms.
- **Fuentes nunca en `data:`.** Vite incrustaba como `data:` las fuentes de menos de 4 KB (cirílico extendido); ahora siempre son archivos (`vite.build.assetsInlineLimit`), que es lo que permite `font-src 'self'`.
- **CSP sin costo de rendimiento**: es una `<meta>` con hashes que Astro escribe en cada página (`apps/web/astro.config.ts`, `apps/web/src/lib/csp.ts`); Zod corre en modo `jitless` (sin `new Function`), activado por el script inicial de `Base.astro` (`src/lib/boot.ts`).

Accesibilidad, Buenas prácticas y SEO ya estaban en 100 y siguen en 100: no hubo que tocar contraste, `meta description` ni textos de enlaces.

## Pendiente

- Medir contra producción después del próximo despliegue (`pnpm run audit https://aimweb-9hc.pages.dev`).
- `turbo.json`: agregar `PUBLIC_PLAYGROUND_API_URL` a `tasks.build.env`; cambia la CSP que sale en el build y, sin eso, Turbo podría reutilizar un build en caché con el `connect-src` anterior.
- Registrar en `docs/DECISIONES.md` la CSP por `<meta>` con hashes (sin `'unsafe-inline'` ni `'unsafe-eval'`, Zod en modo `jitless`).
- `scripts/brand-assets.mjs` todavía no genera los logos de 64 px: si cambia el logo, hay que regenerarlos (hoy se hicieron con `sharp` a partir de los de 512 px).
- El póster del video de `/sobre-mi/` (360 × 640) es más grande de lo que se muestra en escritorio (Lighthouse estima 13 KB de ahorro); no afecta el puntaje.
- `/lab/asistente-ia/` y `/admin/` también cargan Zod al inicio (no están en la lista auditada); podrían seguir el patrón del formulario de contacto.
